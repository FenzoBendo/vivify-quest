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

const MAX_BODY = 5 * 1024 * 1024;
const MAX_TEXT = 4.5 * 1024 * 1024;
const MAX_FILES = 12;
const NAME = /^(VivifyCrash|VivifyReport|RecoveryMaps|PlayingLevel)\.txt$|^vivify_global(-p\d{1,3})?\.txt$/;
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
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
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

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return reply(405, "POST logs here");
    if (!env.GITHUB_TOKEN) return reply(500, "relay has no GITHUB_TOKEN");
    const declared = Number(request.headers.get("Content-Length") || 0);
    if (declared > MAX_BODY) return reply(413, "too large");
    const raw = await request.text();
    if (raw.length > MAX_BODY) return reply(413, "too large");

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return reply(400, "not JSON");
    }
    const version = String(body.version || "");
    const upload = String(body.upload || "");
    if (!VERSION.test(version) || !UPLOAD.test(upload)) return reply(400, "bad version or upload id");
    if (!Array.isArray(body.files) || body.files.length === 0 || body.files.length > MAX_FILES) {
      return reply(400, "bad file list");
    }
    let total = 0;
    for (const file of body.files) {
      if (!file || typeof file.name !== "string" || !NAME.test(file.name) || typeof file.text !== "string") {
        return reply(400, "bad file");
      }
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
    } catch (error) {
      return reply(502, `could not commit: ${error.message}`);
    }
  },
};
