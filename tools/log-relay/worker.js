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
// Trigger a full log sweep above this active-branch storage budget (override with MAX_LOG_STORAGE_BYTES).
const DEFAULT_MAX_LOG_STORAGE_BYTES = 450 * 1024 * 1024;
const RECENT_LOG_WINDOW_MS = 2 * 60 * 60 * 1000;
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

// Use a small, audited SHA3 implementation; Web Crypto does not expose SHA3.
import { sha3_256 } from "@noble/hashes/sha3";
export { sha3_256 };
function sha3Hex(bytes) { return [...sha3_256(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join(""); }
const DEDUPE_INDEX_PATH = ".vivify-sha3-index.json";
async function contentSha3(text) { return sha3Hex(new TextEncoder().encode(text)); }
function decodeBase64Text(content) {
  const raw = atob(content.replace(/\n/g, ""));
  return new TextDecoder().decode(Uint8Array.from(raw, ch => ch.charCodeAt(0)));
}
function uploadTimestamp(path) {
  const match = path.match(/^logs\/(\d{4}-\d{2}-\d{2})\/(\d{2})(\d{2})(\d{2})_/);
  return match ? Date.parse(match[1] + "T" + match[2] + ":" + match[3] + ":" + match[4] + "Z") : NaN;
}

// Each log file is a manifest of ordered, content-addressed lines.
// The same exact UTF-8 line is represented by one Git blob across all logs.
const LINE_PREFIX = ".vivify-lines/";
const LINE_MANIFEST = "vivify-line-manifest";
function splitLogLines(text) { return text.match(/[^\n]*\n|[^\n]+$/g) || []; }
function parseLineManifest(text) {
  try { const x = JSON.parse(text); return x?.format === LINE_MANIFEST && x.version === 1 && Array.isArray(x.lines) ? x : null; }
  catch { return null; }
}
async function readManifestText(env, manifest) {
  const parts = [];
  for (const line of manifest.lines) {
    const blob = await github(env, "GET", "/git/blobs/" + line.sha);
    if (blob.status !== 200 || typeof blob.data.content !== "string") throw new Error("shared log line unavailable");
    parts.push(decodeBase64Text(blob.data.content));
  }
  return parts.join("");
}
async function commit(env, entries, message) {
  const branch = env.BRANCH || "LOGS";
  for (let attempt = 0; attempt < 4; attempt++) {
    const ref = await github(env, "GET", "/git/ref/heads/" + branch);
    let parent = null, baseTree, items = [];
    let stats = { savedBytes: 0, savedFiles: 0, savedLines: 0 };
    if (ref.status === 200) {
      parent = ref.data.object.sha;
      const pc = await github(env, "GET", "/git/commits/" + parent);
      if (pc.status !== 200) throw githubFailure("reading branch head", pc);
      baseTree = pc.data.tree.sha;
      const tr = await github(env, "GET", "/git/trees/" + baseTree + "?recursive=1");
      if (tr.status !== 200) throw githubFailure("reading logs for line dedupe", tr);
      if (tr.data.truncated) throw new Error("line dedupe aborted: truncated Git tree");
      items = tr.data.tree || [];
      const ix = items.find(x => x.path === DEDUPE_INDEX_PATH && x.type === "blob");
      if (ix) {
        const ib = await github(env, "GET", "/git/blobs/" + ix.sha);
        if (ib.status !== 200 || typeof ib.data.content !== "string") throw new Error("reading line dedupe metrics failed");
        const parsed = JSON.parse(decodeBase64Text(ib.data.content));
        stats = { savedBytes: Number(parsed.stats?.savedBytes) || 0, savedFiles: Number(parsed.stats?.savedFiles) || 0, savedLines: Number(parsed.stats?.savedLines) || 0 };
      }
    } else if (ref.status !== 404) throw githubFailure("reading branch", ref);

    const changes = new Map(), known = new Set(items.map(x => x.path));
    let savedBytes = 0, savedLines = 0, savedFiles = 0;
    // Migrate older whole-file blobs once, without changing their public paths.
    for (const item of items.filter(x => x.type === "blob" && x.path.startsWith("logs/"))) {
      const blob = await github(env, "GET", "/git/blobs/" + item.sha);
      if (blob.status !== 200 || typeof blob.data.content !== "string") throw new Error("migrating old log failed: " + item.path);
      const oldText = decodeBase64Text(blob.data.content);
      if (parseLineManifest(oldText)) continue;
      const refs = [];
      for (const line of splitLogLines(oldText)) {
        const bytes = new TextEncoder().encode(line), hash = sha3Hex(bytes), path = LINE_PREFIX + hash;
        refs.push({ sha: hash, bytes: bytes.length });
        if (!known.has(path) && !changes.has(path)) {
          changes.set(path, { path, mode: "100644", type: "blob", content: line });
          known.add(path);
        }
      }
      changes.set(item.path, { path: item.path, mode: "100644", type: "blob", content: JSON.stringify({ format: LINE_MANIFEST, version: 1, lines: refs }) });
    }
    let duplicateFiles = 0;
    for (const entry of entries) {
      const refs = [];
      let duplicate = false;
      for (const line of splitLogLines(entry.text)) {
        const bytes = new TextEncoder().encode(line), hash = sha3Hex(bytes), path = LINE_PREFIX + hash;
        refs.push({ sha: hash, bytes: bytes.length });
        if (known.has(path) || changes.has(path)) {
          savedBytes += bytes.length; savedLines++; duplicate = true;
        } else {
          changes.set(path, { path, mode: "100644", type: "blob", content: line });
          known.add(path);
        }
      }
      if (duplicate) { duplicateFiles++; savedFiles++; }
      changes.set(entry.path, { path: entry.path, mode: "100644", type: "blob", content: JSON.stringify({ format: LINE_MANIFEST, version: 1, lines: refs }) });
    }
    stats.savedBytes += savedBytes; stats.savedLines += savedLines; stats.savedFiles += savedFiles;
    changes.set(DEDUPE_INDEX_PATH, { path: DEDUPE_INDEX_PATH, mode: "100644", type: "blob", content: JSON.stringify({ version: 2, algorithm: "sha3-256-lines", stats }) });
    const tree = await github(env, "POST", "/git/trees", { ...(baseTree ? { base_tree: baseTree } : {}), tree: [...changes.values()] });
    if (tree.status !== 201) throw githubFailure("writing shared log lines", tree);
    const made = await github(env, "POST", "/git/commits", { message, tree: tree.data.sha, parents: parent ? [parent] : [] });
    if (made.status !== 201) throw githubFailure("making log commit", made);
    const moved = parent
      ? await github(env, "PATCH", "/git/refs/heads/" + branch, { sha: made.data.sha, force: false })
      : await github(env, "POST", "/git/refs", { ref: "refs/heads/" + branch, sha: made.data.sha });
    if (moved.status === 200 || moved.status === 201) return { sha: made.data.sha, stored: entries.length, deduplicated: duplicateFiles, deduplicatedLines: savedLines, savedBytes: stats.savedBytes };
    if (moved.status !== 422) throw githubFailure("moving logs branch", moved);
  }
  throw new Error("logs branch kept moving; giving up");
}

async function readLogs(env) {
  const branch = env.BRANCH || "LOGS";
  const ref = await github(env, "GET", `/git/ref/heads/${branch}`);
  if (ref.status === 404) return { uploads: [], days: [], totalBytes: 0, dedupeSavedBytes: 0, dedupeSavedFiles: 0 };
  if (ref.status !== 200) throw githubFailure("reading the logs branch", ref);
  const commitResult = await github(env, "GET", `/git/commits/${ref.data.object.sha}`);
  if (commitResult.status !== 200) throw githubFailure("reading the logs commit", commitResult);
  const treeResult = await github(env, "GET", `/git/trees/${commitResult.data.tree.sha}?recursive=1`);
  if (treeResult.status !== 200) throw githubFailure("reading the logs tree", treeResult);
  const treeItems = treeResult.data.tree || [];
  const dedupeItem = treeItems.find(item => item.path === DEDUPE_INDEX_PATH && item.type === "blob");
  let dedupeStats = { savedBytes: 0, savedFiles: 0 };
  if (dedupeItem) {
    const blob = await github(env, "GET", `/git/blobs/${dedupeItem.sha}`);
    if (blob.status === 200 && typeof blob.data.content === "string") {
      try {
        const parsed = JSON.parse(decodeBase64Text(blob.data.content));
        dedupeStats = { savedBytes: Number(parsed.stats?.savedBytes) || 0, savedFiles: Number(parsed.stats?.savedFiles) || 0 };
      } catch { /* A malformed optional metric must not hide uploaded logs. */ }
    }
  }
  const groups = new Map();
  for (const item of treeItems) {
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
  return { uploads, days: [...daysMap.values()].sort((a, b) => a.date.localeCompare(b.date)), totalBytes: uploads.reduce((sum, item) => sum + item.bytes, 0), dedupeSavedBytes: dedupeStats.savedBytes, dedupeSavedFiles: dedupeStats.savedFiles };
}


async function pruneLogsWhenOversized(env, now = Date.now()) {
  const branch = env.BRANCH || "LOGS";
  const limit = Math.max(1, Number(env.MAX_LOG_STORAGE_BYTES) || DEFAULT_MAX_LOG_STORAGE_BYTES);
  for (let attempt = 0; attempt < 4; attempt++) {
    const ref = await github(env, "GET", "/git/ref/heads/" + branch);
    if (ref.status === 404) return { triggered: false, deletedFiles: 0, bytesBefore: 0 };
    if (ref.status !== 200) throw githubFailure("reading logs for size cleanup", ref);
    const headSha = ref.data.object.sha;
    const commitResult = await github(env, "GET", "/git/commits/" + headSha);
    if (commitResult.status !== 200) throw githubFailure("reading log commit for size cleanup", commitResult);
    const treeResult = await github(env, "GET", "/git/trees/" + commitResult.data.tree.sha + "?recursive=1");
    if (treeResult.status !== 200) throw githubFailure("reading log tree for size cleanup", treeResult);
    if (treeResult.data.truncated) throw new Error("size cleanup aborted: GitHub returned a truncated logs tree");
    const items = treeResult.data.tree || [];
    const logs = items.filter(item => item.type === "blob" && item.path.startsWith("logs/"));
    const bytesBefore = logs.reduce((sum, item) => sum + (Number(item.size) || 0), 0);
    if (bytesBefore <= limit) return { triggered: false, deletedFiles: 0, bytesBefore };
    const cutoff = now - RECENT_LOG_WINDOW_MS;
    const candidates = logs.filter(item => {
      const timestamp = uploadTimestamp(item.path);
      return !Number.isFinite(timestamp) || timestamp < cutoff;
    });
    const indexItem = items.find(item => item.path === DEDUPE_INDEX_PATH && item.type === "blob");
    let index = null;
    const protectedPaths = new Set();
    if (indexItem) {
      const indexBlob = await github(env, "GET", `/git/blobs/${indexItem.sha}`);
      if (indexBlob.status !== 200 || typeof indexBlob.data.content !== "string") throw new Error("reading SHA3 index during size cleanup failed");
      index = JSON.parse(decodeBase64Text(indexBlob.data.content));
      for (const [hash, storedPath] of Object.entries(index.hashes || {})) {
        if (Number(index.lastSeen?.[hash]) >= cutoff) protectedPaths.add(storedPath);
      }
    }
    // A recent duplicate can point at an older canonical blob; retain that blob
    // until its content has not been seen for the full two-hour window.
    const expired = candidates.filter(item => !protectedPaths.has(item.path));
    if (!expired.length) return { triggered: true, deletedFiles: 0, bytesBefore, protectedRecentBytes: bytesBefore };
    const expiredPaths = new Set(expired.map(item => item.path));
    const changes = expired.map(item => ({ path: item.path, sha: null }));
    if (index) {
      for (const [hash, storedPath] of Object.entries(index.hashes || {})) {
        if (expiredPaths.has(storedPath)) { delete index.hashes[hash]; delete index.lastSeen?.[hash]; }
      }
      changes.push({ path: DEDUPE_INDEX_PATH, mode: "100644", type: "blob", content: JSON.stringify(index) });
    }
    const tree = await github(env, "POST", "/git/trees", { base_tree: commitResult.data.tree.sha, tree: changes });
    if (tree.status !== 201) throw githubFailure("building size-cleanup tree", tree);
    const made = await github(env, "POST", "/git/commits", {
      message: `Automatic storage cleanup: remove ${expired.length} old log file(s), preserve two hours`,
      tree: tree.data.sha, parents: [headSha],
    });
    if (made.status !== 201) throw githubFailure("committing size cleanup", made);
    const moved = await github(env, "PATCH", "/git/refs/heads/" + branch, { sha: made.data.sha, force: false });
    if (moved.status === 200) {
      await invalidateLogIndexCache(env);
      return { triggered: true, deletedFiles: expired.length, bytesBefore, protectedRecentBytes: logs.filter(item => !expiredPaths.has(item.path)).reduce((sum, item) => sum + (Number(item.size) || 0), 0) };
    }
    if (moved.status !== 422) throw githubFailure("updating branch after size cleanup", moved);
  }
  throw new Error("logs branch kept moving during size cleanup; retry on the next run");
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
    const indexItem = (treeResult.data.tree || []).find(item => item.path === DEDUPE_INDEX_PATH && item.type === "blob");
    let index = null;
    const recentlySeenPaths = new Set();
    if (indexItem) {
      const indexBlob = await github(env, "GET", `/git/blobs/${indexItem.sha}`);
      if (indexBlob.status !== 200 || typeof indexBlob.data.content !== "string") throw new Error("reading SHA3 index during retention failed");
      index = JSON.parse(decodeBase64Text(indexBlob.data.content));
      for (const [hash, storedPath] of Object.entries(index.hashes || {})) {
        if (Number(index.lastSeen?.[hash]) >= now - RECENT_LOG_WINDOW_MS) recentlySeenPaths.add(storedPath);
      }
    }
    const expired = (treeResult.data.tree || []).filter(item => {
      const match = item.path.match(/^logs\/(\d{4}-\d{2}-\d{2})\/([^/]+)\/[^/]+$/);
      if (!match || recentlySeenPaths.has(item.path)) return false;
      const time = match[2].match(/^(\d{2})(\d{2})(\d{2})_/);
      const timestamp = time
        ? Date.parse(match[1] + "T" + time[1] + ":" + time[2] + ":" + time[3] + "Z")
        : Date.parse(match[1] + "T00:00:00Z");
      return timestamp < cutoff;
    });
    if (!expired.length) return { deletedFiles: 0, deletedUploads: 0 };
    const folders = new Set(expired.map(item => item.path.split("/").slice(0, 3).join("/")));
    const expiredPaths = new Set(expired.map(item => item.path));
    const changes = expired.map(item => ({ path: item.path, sha: null }));
    if (index) {
      for (const [hash, storedPath] of Object.entries(index.hashes || {})) {
        if (expiredPaths.has(storedPath)) { delete index.hashes[hash]; delete index.lastSeen?.[hash]; }
      }
      changes.push({ path: DEDUPE_INDEX_PATH, mode: "100644", type: "blob", content: JSON.stringify(index) });
    }
    const tree = await github(env, "POST", "/git/trees", {
      base_tree: commitResult.data.tree.sha,
      tree: changes,
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
    ctx.waitUntil((async () => {
      await pruneExpiredLogs(env);
      await pruneLogsWhenOversized(env);
    })().catch(error => console.error("scheduled log maintenance failed:", error)));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/health") {
      try {
        const data = await readLogsCached(env);
        // writeReady indicates that the upload secret is configured.
        return json(200, { ok: true, writeReady: Boolean(env.GITHUB_TOKEN), uploadCount: data.uploads.length, fileCount: data.uploads.reduce((n, u) => n + u.files.length, 0), totalBytes: data.totalBytes, dedupeSavedBytes: data.dedupeSavedBytes, dedupeSavedFiles: data.dedupeSavedFiles, dedupeSavedLines: data.dedupeSavedLines, updatedAt: new Date().toISOString() });
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
        const storedText = decodeBase64Text(blob.data.content);
        const manifest = parseLineManifest(storedText);
        const outputText = manifest ? await readManifestText(env, manifest) : storedText;
        const bytes = new TextEncoder().encode(outputText);
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
        await invalidateLogIndexCache(env);
        // Check the active LOGS branch after every accepted upload; scheduled maintenance
        // is a fallback for manual changes and storage growth between uploads.
        const cleanup = await pruneLogsWhenOversized(env).catch(error => {
          console.error("post-upload size cleanup failed:", error);
          return null;
        });
        return reply(200, result.stored === 0
          ? `stored ${result.stored} file(s); shared ${result.deduplicatedLines || 0} duplicate line(s); ${result.savedBytes || 0} bytes saved cumulatively`
          : `${folder} ${result.sha.slice(0, 7)}; stored ${result.stored} file(s); shared ${result.deduplicatedLines || 0} duplicate line(s); ${result.savedBytes || 0} bytes saved cumulatively${cleanup?.deletedFiles ? `; cleaned ${cleanup.deletedFiles} old file(s)` : ""}`);
      } catch (error) { return reply(502, `could not commit: ${error.message}`); }
    }
    if (request.method === "GET" && env.ASSETS) return env.ASSETS.fetch(request);
    return reply(404, "not found");
  },
};
