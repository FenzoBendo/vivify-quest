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
      // Use the configured token for reads as well as writes. This supports
      // private repositories and avoids anonymous-read 403s. Public repositories
      // still work without a token; never send a literal "Bearer undefined".
      ...(env.GITHUB_TOKEN ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}),
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "vivify-log-relay",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  return {
    status: response.status,
    data,
    rateLimitRemaining: response.headers.get("X-RateLimit-Remaining"),
    rateLimitReset: response.headers.get("X-RateLimit-Reset"),
    retryAfter: response.headers.get("Retry-After"),
  };
}

function githubFailure(label, result) {
  const message = typeof result.data?.message === "string" ? result.data.message : "no GitHub error message";
  const rate = result.rateLimitRemaining !== null ? `, rate-limit remaining: ${result.rateLimitRemaining}` : "";
  const retry = result.retryAfter ? `, retry after: ${result.retryAfter}s` : "";
  return new Error(`${label}: GitHub HTTP ${result.status} (${message})${rate}${retry}`);
}

// Cache the branch index briefly: the dashboard refreshes every 15 seconds,
// and without this each page view makes three GitHub API calls.
const LOG_INDEX_CACHE_SECONDS = 20;
function logIndexCacheKey(env) {
  const repo = encodeURIComponent(env.REPO || "trail-b1az3r/vivify-quest");
  const branch = encodeURIComponent(env.BRANCH || "LOGS");
  return new Request(`https://vivify-log-relay-cache.internal/api/logs?repo=${repo}&branch=${branch}`);
}
async function readLogsCached(env) {
  if (typeof caches === "undefined" || !caches.default) return readLogs(env);
  const cache = caches.default;
  const key = logIndexCacheKey(env);
  const cached = await cache.match(key);
  if (cached) return cached.json();
  const data = await readLogs(env);
  await cache.put(key, new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${LOG_INDEX_CACHE_SECONDS}` },
  }));
  return data;
}
async function invalidateLogIndexCache(env) {
  if (typeof caches === "undefined" || !caches.default) return;
  await caches.default.delete(logIndexCacheKey(env));
}

// SHA3-256 (FIPS 202); Workers Web Crypto currently lacks SHA3.
const MASK64=(1n<<64n)-1n;
const ROT=[0,1,62,28,27,36,44,6,55,20,3,10,43,25,39,41,45,15,21,8,18,2,61,56,14];
const RC=[1n,0x8082n,0x800000000000808an,0x8000000080008000n,0x808bn,0x80000001n,0x8000000080008081n,0x8000000000008009n,0x8an,0x88n,0x80008009n,0x8000000an,0x8000808bn,0x800000000000008bn,0x8000000000008089n,0x8000000000008003n,0x8000000000008002n,0x8000000000000080n,0x800an,0x800000008000000an,0x8000000080008081n,0x8000000000008080n,0x80000001n,0x8000000080008008n];
function rot64(v,n){if(!n)return v;const s=BigInt(n);return((v<<s)|(v>>(64n-s)))&MASK64;}
function sha3_256(input){const rate=136,size=Math.ceil((input.length+1)/rate)*rate,data=new Uint8Array(size);data.set(input);data[input.length]^=6;data[size-1]^=128;const st=new Array(25).fill(0n);for(let off=0;off<size;off+=rate){for(let i=0;i<rate;i++)st[i>>3]^=BigInt(data[off+i])<<BigInt((i&7)*8);for(const rc of RC){const c=new Array(5),d=new Array(5);for(let x=0;x<5;x++)c[x]=st[x]^st[x+5]^st[x+10]^st[x+15]^st[x+20];for(let x=0;x<5;x++)d[x]=c[(x+4)%5]^rot64(c[(x+1)%5],1);for(let y=0;y<5;y++)for(let x=0;x<5;x++)st[x+5*y]^=d[x];const q=new Array(25).fill(0n);for(let y=0;y<5;y++)for(let x=0;x<5;x++){const i=x+5*y;q[y+5*((2*x+3*y)%5)]=rot64(st[i],ROT[i]);}for(let y=0;y<5;y++)for(let x=0;x<5;x++)st[x+5*y]=q[x+5*y]^((~q[(x+1)%5+5*y])&q[(x+2)%5+5*y]);st[0]^=rc;}}const out=new Uint8Array(32);for(let i=0;i<32;i++)out[i]=Number((st[i>>3]>>BigInt((i&7)*8))&255n);return[...out].map(v=>v.toString(16).padStart(2,"0")).join("");}
const DEDUPE_INDEX_PATH=".vivify-sha3-index.json";
async function contentSha3(text){return sha3_256(new TextEncoder().encode(text));}

// One commit holding only new, content-unique blobs on the branch. Re-check
// after every branch race so concurrent identical uploads cannot both commit.
async function commit(env, entries, message) {
  const branch = env.BRANCH || "LOGS";
  for (let attempt = 0; attempt < 4; attempt++) {
    const ref = await github(env, "GET", `/git/ref/heads/${branch}`);
    let parent = null;
    let baseTree = undefined;
    let hashIndex = {};
    if (ref.status === 200) {
      parent = ref.data.object.sha;
      const parentCommit = await github(env, "GET", `/git/commits/${parent}`);
      if (parentCommit.status !== 200) throw new Error(`reading the branch head: ${parentCommit.status}`);
      baseTree = parentCommit.data.tree.sha;
      const currentTree = await github(env, "GET", `/git/trees/${baseTree}?recursive=1`);
      if (currentTree.status !== 200) throw githubFailure("reading existing log blobs for deduplication", currentTree);
      if (currentTree.data.truncated) throw new Error("deduplication aborted: GitHub returned a truncated logs tree");
      const items = currentTree.data.tree || [];
      const indexItem = items.find(item => item.path === DEDUPE_INDEX_PATH && item.type === "blob");
      if (indexItem) {
        const result = await github(env, "GET", `/git/blobs/${indexItem.sha}`);
        if (result.status !== 200 || typeof result.data.content !== "string") throw new Error("reading SHA3 index failed");
        const raw = atob(result.data.content.replace(/\\n/g, ""));
        const parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(raw, ch => ch.charCodeAt(0))));
        if (parsed.version !== 1 || !parsed.hashes || typeof parsed.hashes !== "object") throw new Error("invalid SHA3 index format");
        hashIndex = parsed.hashes;
      } else {
        // Backfill existing logs once when upgrading from the SHA-1 deduper.
        for (const item of items) {
          if (item.type !== "blob" || !item.path.startsWith("logs/")) continue;
          const blob = await github(env, "GET", `/git/blobs/${item.sha}`);
          if (blob.status !== 200 || typeof blob.data.content !== "string") throw new Error(`SHA3 migration failed for ${item.path}`);
          const raw = atob(blob.data.content.replace(/\\n/g, ""));
          hashIndex[sha3_256(Uint8Array.from(raw, ch => ch.charCodeAt(0)))] = item.path;
        }
      }
    } else if (ref.status !== 404) throw githubFailure("reading the branch", ref);
    const uniqueEntries = [], incoming = new Set();
    for (const entry of entries) {
      const hash = await contentSha3(entry.text);
      if (hashIndex[hash] || incoming.has(hash)) continue;
      incoming.add(hash); hashIndex[hash] = entry.path; uniqueEntries.push(entry);
    }
    const deduplicated = entries.length - uniqueEntries.length;
    if (!uniqueEntries.length) return { sha: null, stored: 0, deduplicated };
    const indexText = JSON.stringify({ version: 1, algorithm: "sha3-256", hashes: hashIndex });
    const tree = await github(env, "POST", "/git/trees", {
      ...(baseTree ? { base_tree: baseTree } : {}),
      tree: [...uniqueEntries.map(entry => ({ path: entry.path, mode: "100644", type: "blob", content: entry.text })),
        { path: DEDUPE_INDEX_PATH, mode: "100644", type: "blob", content: indexText }],
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
    if (moved.status === 200 || moved.status === 201) return { sha: made.data.sha, stored: uniqueEntries.length, deduplicated };
    // Another upload moved the branch first: build on top of it and try again.
    if (moved.status !== 422) throw new Error(`moving the branch: ${moved.status}`);
  }
  throw new Error("the branch kept moving; giving up");
}

async function readLogs(env) {
  const branch = env.BRANCH || "LOGS";
  const ref = await github(env, "GET", `/git/ref/heads/${branch}`);
  if (ref.status === 404) return { uploads: [], days: [], totalBytes: 0 };
  if (ref.status !== 200) throw githubFailure("reading the logs branch", ref);
  const commitResult = await github(env, "GET", `/git/commits/${ref.data.object.sha}`);
  if (commitResult.status !== 200) throw githubFailure("reading the logs commit", commitResult);
  const treeResult = await github(env, "GET", `/git/trees/${commitResult.data.tree.sha}?recursive=1`);
  if (treeResult.status !== 200) throw githubFailure("reading the logs tree", treeResult);
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


async function pruneExpiredLogs(env, now = Date.now()) {
  const branch = env.BRANCH || "LOGS";
  const cutoff = now - 30 * 24 * 60 * 60 * 1000;
  for (let attempt = 0; attempt < 4; attempt++) {
    const ref = await github(env, "GET", "/git/ref/heads/" + branch);
    if (ref.status === 404) return { deletedFiles: 0, deletedUploads: 0 };
    if (ref.status !== 200) throw githubFailure("reading the logs branch for retention", ref);
    const headSha = ref.data.object.sha;
    const commitResult = await github(env, "GET", "/git/commits/" + headSha);
    if (commitResult.status !== 200) throw githubFailure("reading the logs commit for retention", commitResult);
    const treeResult = await github(env, "GET", "/git/trees/" + commitResult.data.tree.sha + "?recursive=1");
    if (treeResult.status !== 200) throw githubFailure("reading the logs tree for retention", treeResult);
    if (treeResult.data.truncated) throw new Error("retention aborted: GitHub returned a truncated logs tree");
    const expired = (treeResult.data.tree || []).filter(item => {
      const match = item.path.match(/^logs\/(\d{4}-\d{2}-\d{2})\/([^/]+)\/[^/]+$/);
      if (!match) return false;
      const time = match[2].match(/^(\d{2})(\d{2})(\d{2})_/);
      const timestamp = time
        ? Date.parse(match[1] + "T" + time[1] + ":" + time[2] + ":" + time[3] + "Z")
        : Date.parse(match[1] + "T00:00:00Z");
      return timestamp < cutoff;
    });
    if (!expired.length) return { deletedFiles: 0, deletedUploads: 0 };
    const folders = new Set(expired.map(item => item.path.split("/").slice(0, 3).join("/")));
    const tree = await github(env, "POST", "/git/trees", {
      base_tree: commitResult.data.tree.sha,
      tree: expired.map(item => ({ path: item.path, sha: null })),
    });
    if (tree.status !== 201) throw githubFailure("building the retention tree", tree);
    const made = await github(env, "POST", "/git/commits", {
      message: "Expire " + expired.length + " diagnostic log file(s) older than 30 days",
      tree: tree.data.sha,
      parents: [headSha],
    });
    if (made.status !== 201) throw githubFailure("committing log retention", made);
    const moved = await github(env, "PATCH", "/git/refs/heads/" + branch, { sha: made.data.sha, force: false });
    if (moved.status === 200) {
      await invalidateLogIndexCache(env);
      return { deletedFiles: expired.length, deletedUploads: folders.size };
    }
    if (moved.status !== 422) throw githubFailure("updating the branch after retention", moved);
  }
  throw new Error("the logs branch kept moving during retention; retry on the next scheduled run");
}

function json(status, data) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(pruneExpiredLogs(env).catch(error => console.error("log retention failed:", error)));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/health") {
      try {
        const data = await readLogsCached(env);
        // writeReady indicates that the upload secret is configured.
        return json(200, { ok: true, writeReady: Boolean(env.GITHUB_TOKEN), uploadCount: data.uploads.length, fileCount: data.uploads.reduce((n, u) => n + u.files.length, 0), totalBytes: data.totalBytes, updatedAt: new Date().toISOString() });
      } catch (error) { return json(502, { error: error.message }); }
    }
    if (request.method === "GET" && url.pathname === "/api/logs") {
      try {
        const index = await readLogsCached(env);
        const date = url.searchParams.get("date");
        const uploadId = url.searchParams.get("upload");
        if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(400, { error: "Invalid date filter" });
        const uploads = index.uploads.filter(item => (!date || item.date === date) && (!uploadId || item.id === uploadId));
        return json(200, { ...index, uploads, totalBytes: uploads.reduce((sum, item) => sum + item.bytes, 0) });
      } catch (error) { return json(502, { error: error.message }); }
    }
    if (request.method === "GET" && url.pathname === "/api/log") {
      const path = url.searchParams.get("path") || "";
      if (!/^logs\/\d{4}-\d{2}-\d{2}\/[^/]+\/(?:VivifyCrash|VivifyReport|RecoveryMaps|PlayingLevel|VivifySession)(?:-part\d{3})?\.txt$|^logs\/\d{4}-\d{2}-\d{2}\/[^/]+\/vivify_global(?:-p\d{1,3})?(?:-part\d{3})?\.txt$/.test(path)) return json(400, { error: "Invalid log path" });
      try {
        const index = await readLogsCached(env);
        const file = index.uploads.flatMap((upload) => upload.files).find((entry) => entry.path === path);
        if (!file) return json(404, { error: "Log file unavailable" });
        // Use the Git blob endpoint: the Contents endpoint stops returning JSON
        // content for files larger than 1 MB, while Vivify permits larger logs.
        const blob = await github(env, "GET", `/git/blobs/${file.sha}`);
        if (blob.status !== 200 || typeof blob.data.content !== "string") return json(502, { error: "Log file unavailable" });
        const content = atob(blob.data.content.replace(/\n/g, ""));
        const bytes = Uint8Array.from(content, (c) => c.charCodeAt(0));
        const filename = path.split("/").pop();
        const headers = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
        if (url.searchParams.get("download") === "1") headers["Content-Disposition"] = `attachment; filename="${filename}"`;
        return new Response(new TextDecoder().decode(bytes), { headers });
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
      try { body = JSON.parse(raw); } catch (error) { return reply(400, "not JSON: " + String(error.message).slice(0, 120)); }
      const version = String(body.version || "");
      const upload = String(body.upload || "");
      if (!VERSION.test(version) || !UPLOAD.test(upload)) return reply(400, "bad version or upload id");
      if (!Array.isArray(body.files) || body.files.length === 0 || body.files.length > MAX_FILES) return reply(400, "bad file list");
      let total = 0;
      for (const file of body.files) {
        if (!file || typeof file.name !== "string") return reply(400, "bad file: no name");
        if (!NAME.test(file.name)) return reply(400, "bad file name: " + file.name.slice(0, 80));
        if (typeof file.text !== "string") return reply(400, "bad file: no text for " + file.name);
        total += file.text.length;
      }
      if (total > MAX_TEXT) return reply(413, "too much text");
      const now = new Date();
      const date = now.toISOString().slice(0, 10);
      const time = now.toISOString().slice(11, 19).replace(/:/g, "");
      const folder = `logs/${date}/${time}_${version.replace(/ /g, "-")}${body.lite ? "-lite" : ""}_${upload}`;
      const entries = body.files.map((file) => ({ path: `${folder}/${file.name}`, text: file.text }));
      try {
        const result = await commit(env, entries, `Logs from Vivify ${version} (${upload})`);
        if (result.stored > 0) await invalidateLogIndexCache(env);
        return reply(200, result.stored === 0
          ? `deduplicated ${result.deduplicated} file(s); no new data stored`
          : `${folder} ${result.sha.slice(0, 7)}; stored ${result.stored}, deduplicated ${result.deduplicated}`);
      } catch (error) { return reply(502, `could not commit: ${error.message}`); }
    }
    if (request.method === "GET" && env.ASSETS) return env.ASSETS.fetch(request);
    return reply(404, "not found");
  },
};
