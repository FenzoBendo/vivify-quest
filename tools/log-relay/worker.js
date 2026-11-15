// Vivify Quest log relay (Send Logs, 0.15.20).
//
// The mod POSTs what Vivify logged since its last upload here; this worker
// commits it to the repository's LOGS branch. The GitHub token lives only in
// this worker's secrets (GITHUB_TOKEN), never in the mod, so a copy of the mod
// cannot be used to write to the repository.
//
// Accepted: JSON { version, lite, upload, files: [{ name, from, text }] } with
// known log file names only, at most 12 files and 4.5 MB of text. Each upload
// becomes one commit, under logs/<date>/<time>_<version>_<upload>/.
//
// Settings (wrangler.toml [vars] / secrets):
//   GITHUB_TOKEN  secret: fine-grained token, this repository, Contents: write
//   REPO          "owner/name"           (default trail-b1az3r/vivify-quest)
//   BRANCH        branch to commit to    (default LOGS; created as an orphan)

const MAX_BODY = 20 * 1024 * 1024;
const MAX_TEXT = 4.5 * 1024 * 1024;
const MAX_FILES = 12;
const NAME = /^(?:VivifyCrash|VivifyReport|RecoveryMaps|PlayingLevel|VivifySession)(?:-part\d{3})?\.txt$|^vivify_global(?:-p\d{1,3})?(?:-part\d{3})?\.txt$/;
const VERSION = /^[0-9A-Za-z.\- ]{1,32}$/;
const UPLOAD = /^[0-9a-f]{16}$/;

function reply(status, text) {
  return new Response(text + "\n", { status, headers: { "Content-Type": "text/plain" } });
}

async function github(env, method, path, body) {
  const repo = env.REPO || "trail-b1az3r/vivify-quest";
  const response = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    method,
    headers: {
      // Public LOGS-branch reads must work without the optional write secret.
      // Do not send `Bearer undefined`: GitHub treats it as invalid credentials.
      ...(env.GITHUB_TOKEN ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}),
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "vivify-log-relay",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  return { status: response.status, data };
}

// One commit holding `entries` on top of the branch (or as its first commit).
async function commit(env, entries, message) {
  const branch = env.BRANCH || "LOGS";
  for (let attempt = 0; attempt < 4; attempt++) {
    const ref = await github(env, "GET", `/git/ref/heads/${branch}`);
    let parent = null;
    let baseTree = undefined;
    if (ref.status === 200) {
      parent = ref.data.object.sha;
      const parentCommit = await github(env, "GET", `/git/commits/${parent}`);
      if (parentCommit.status !== 200) throw new Error(`reading the branch head: ${parentCommit.status}`);
      baseTree = parentCommit.data.tree.sha;
    } else if (ref.status !== 404) {
      throw new Error(`reading the branch: ${ref.status}`);
    }
    const tree = await github(env, "POST", "/git/trees", {
      ...(baseTree ? { base_tree: baseTree } : {}),
      tree: entries.map((entry) => ({ path: entry.path, mode: "100644", type: "blob", content: entry.text })),
    });
    if (tree.status !== 201) throw new Error(`writing the files: ${tree.status}`);
    const made = await github(env, "POST", "/git/commits", {
      message,
      tree: tree.data.sha,
      parents: parent ? [parent] : [],
    });
    if (made.status !== 201) throw new Error(`making the commit: ${made.status}`);
    const moved = parent
      ? await github(env, "PATCH", `/git/refs/heads/${branch}`, { sha: made.data.sha, force: false })
      : await github(env, "POST", "/git/refs", { ref: `refs/heads/${branch}`, sha: made.data.sha });
    if (moved.status === 200 || moved.status === 201) return made.data.sha;
    // Another upload moved the branch first: build on top of it and try again.
    if (moved.status !== 422) throw new Error(`moving the branch: ${moved.status}`);
  }
  throw new Error("the branch kept moving; giving up");
}

async function readLogs(env) {
  const branch = env.BRANCH || "LOGS";
  const ref = await github(env, "GET", `/git/ref/heads/${branch}`);
  if (ref.status === 404) return { uploads: [], days: [], totalBytes: 0 };
  if (ref.status !== 200) throw new Error(`reading the logs branch: ${ref.status}`);
  const commitResult = await github(env, "GET", `/git/commits/${ref.data.object.sha}`);
  if (commitResult.status !== 200) throw new Error(`reading the logs commit: ${commitResult.status}`);
  const treeResult = await github(env, "GET", `/git/trees/${commitResult.data.tree.sha}?recursive=1`);
  if (treeResult.status !== 200) throw new Error(`reading the logs tree: ${treeResult.status}`);
  const groups = new Map();
  for (const item of treeResult.data.tree || []) {
    const match = item.path.match(/^(logs\/\d{4}-\d{2}-\d{2}\/[^/]+)\/([^/]+)$/);
    if (!match || item.type !== "blob") continue;
    const [folder, file] = [match[1], match[2]];
    if (!groups.has(folder)) groups.set(folder, { id: folder.split("/").pop(), date: folder.split("/")[1], path: folder, files: [], bytes: 0 });
    const group = groups.get(folder);
    group.files.push({ name: file, path: item.path, size: item.size || 0, sha: item.sha });
    group.bytes += item.size || 0;
  }
  const uploads = [...groups.values()].sort((a, b) => b.path.localeCompare(a.path));
  const daysMap = new Map();
  for (const upload of uploads) {
    if (!daysMap.has(upload.date)) daysMap.set(upload.date, { date: upload.date, uploads: 0, bytes: 0 });
    const day = daysMap.get(upload.date); day.uploads++; day.bytes += upload.bytes;
  }
  return { uploads, days: [...daysMap.values()].sort((a, b) => a.date.localeCompare(b.date)), totalBytes: uploads.reduce((sum, item) => sum + item.bytes, 0) };
}

function json(status, data) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/health") {
      try {
        const data = await readLogs(env);
        // writeReady: whether uploads can be saved. Reads work without the
        // token (public repository), so "ok" alone did not say that.
        return json(200, { ok: true, writeReady: Boolean(env.GITHUB_TOKEN), uploadCount: data.uploads.length, fileCount: data.uploads.reduce((n, u) => n + u.files.length, 0), totalBytes: data.totalBytes, updatedAt: new Date().toISOString() });
      } catch (error) { return json(502, { error: error.message }); }
    }
    if (request.method === "GET" && url.pathname === "/api/logs") {
      try { return json(200, await readLogs(env)); }
      catch (error) { return json(502, { error: error.message }); }
    }
    if (request.method === "GET" && url.pathname === "/api/log") {
      const path = url.searchParams.get("path") || "";
      if (!/^logs\/\d{4}-\d{2}-\d{2}\/[^/]+\/(?:VivifyCrash|VivifyReport|RecoveryMaps|PlayingLevel|VivifySession)(?:-part\d{3})?\.txt$|^logs\/\d{4}-\d{2}-\d{2}\/[^/]+\/vivify_global(?:-p\d{1,3})?(?:-part\d{3})?\.txt$/.test(path)) return json(400, { error: "Invalid log path" });
      try {
        const index = await readLogs(env);
        const file = index.uploads.flatMap((upload) => upload.files).find((entry) => entry.path === path);
        if (!file) return json(404, { error: "Log file unavailable" });
        // Use the Git blob endpoint: the Contents endpoint stops returning JSON
        // content for files larger than 1 MB, while Vivify permits larger logs.
        const blob = await github(env, "GET", `/git/blobs/${file.sha}`);
        if (blob.status !== 200 || typeof blob.data.content !== "string") return json(502, { error: "Log file unavailable" });
        const content = atob(blob.data.content.replace(/\n/g, ""));
        const bytes = Uint8Array.from(content, (c) => c.charCodeAt(0));
        return new Response(new TextDecoder().decode(bytes), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
      } catch (error) { return json(502, { error: error.message }); }
    }
    // Uploads: POST /api/upload. The root serves the dashboard's static
    // files and refuses POST (405); only /api/* reaches this worker.
    if (request.method === "POST" && url.pathname !== "/api/upload" && !url.pathname.startsWith("/api/")) {
      return reply(404, "POST logs to /api/upload");
    }
    if (request.method === "POST") {
      if (!env.GITHUB_TOKEN) return reply(500, "relay has no GITHUB_TOKEN");
      const declared = Number(request.headers.get("Content-Length") || 0);
      if (declared > MAX_BODY) return reply(413, "too large");
      const raw = await request.text();
      if (raw.length > MAX_BODY) return reply(413, "too large");
      let body;
      try { body = JSON.parse(raw); } catch { return reply(400, "not JSON"); }
      const version = String(body.version || "");
      const upload = String(body.upload || "");
      if (!VERSION.test(version) || !UPLOAD.test(upload)) return reply(400, "bad version or upload id");
      if (!Array.isArray(body.files) || body.files.length === 0 || body.files.length > MAX_FILES) return reply(400, "bad file list");
      let total = 0;
      for (const file of body.files) {
        if (!file || typeof file.name !== "string" || !NAME.test(file.name) || typeof file.text !== "string") return reply(400, "bad file");
        total += file.text.length;
      }
      if (total > MAX_TEXT) return reply(413, "too much text");
      const now = new Date();
      const date = now.toISOString().slice(0, 10);
      const time = now.toISOString().slice(11, 19).replace(/:/g, "");
      const folder = `logs/${date}/${time}_${version.replace(/ /g, "-")}${body.lite ? "-lite" : ""}_${upload}`;
      const entries = body.files.map((file) => ({ path: `${folder}/${file.name}`, text: file.text }));
      try {
        const sha = await commit(env, entries, `Logs from Vivify ${version} (${upload})`);
        return reply(200, `${folder} ${sha.slice(0, 7)}`);
      } catch (error) { return reply(502, `could not commit: ${error.message}`); }
    }
    if (request.method === "GET" && env.ASSETS) return env.ASSETS.fetch(request);
    return reply(404, "not found");
  },
};
