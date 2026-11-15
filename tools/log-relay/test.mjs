// Tests worker.js against a fake GitHub API: node test.mjs
import worker from "./worker.js";
let refSha = null, commits = {}, trees = {}, blobs = {}, n = 0, raceOnce = false, calls = [];
globalThis.fetch = async (url, init) => {
  const path = url.replace("https://api.github.com/repos/trail-b1az3r/vivify-quest", "");
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push(init.method + " " + path);
  const json = (status, data) => new Response(data ? JSON.stringify(data) : null, { status });
  if (init.method === "GET" && path === "/git/ref/heads/LOGS") return refSha ? json(200, { object: { sha: refSha } }) : json(404, { message: "Not Found" });
  if (init.method === "GET" && path.startsWith("/git/commits/")) return json(200, commits[path.split("/").pop()]);
  if (init.method === "GET" && path.startsWith("/git/trees/")) {
    const sha = path.split("/").pop().split("?")[0];
    const tree = (trees[sha]?.tree || []).map((entry, i) => {
      const blobSha = "b" + sha + i;
      blobs[blobSha] = entry.content;
      return { path: entry.path, type: "blob", size: entry.content.length, sha: blobSha };
    });
    return json(200, { tree });
  }
  if (init.method === "GET" && path.startsWith("/git/blobs/")) {
    const content = blobs[path.split("/").pop()];
    return content === undefined ? json(404, {}) : json(200, { content: Buffer.from(content).toString("base64"), encoding: "base64" });
  }
  if (init.method === "POST" && path === "/git/trees") { const sha = "t" + ++n; trees[sha] = body; return json(201, { sha }); }
  if (init.method === "POST" && path === "/git/commits") { const sha = "c" + ++n; commits[sha] = { tree: { sha: body.tree }, parents: body.parents }; return json(201, { sha }); }
  if (init.method === "POST" && path === "/git/refs") { refSha = body.sha; return json(201, {}); }
  if (init.method === "PATCH" && path === "/git/refs/heads/LOGS") {
    if (raceOnce) { raceOnce = false; refSha = "cX"; commits["cX"] = { tree: { sha: "tX" }, parents: [] }; return json(422, {}); }
    refSha = body.sha; return json(200, {});
  }
  return json(500, {});
};
const env = { GITHUB_TOKEN: "x" };
const post = (obj) => worker.fetch(new Request("https://relay/", { method: "POST", body: JSON.stringify(obj) }), env);
const good = { version: "0.15.20", lite: false, upload: "0123456789abcdef", files: [{ name: "VivifyReport.txt", from: 0, text: "hello" }, { name: "vivify_global-p4.txt", from: 10, text: "log" }] };
let fails = 0; const check = (what, ok) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) fails++; };
let r = await post(good); let t = await r.text();
check("first upload creates the orphan branch", r.status === 200 && refSha && commits[refSha].parents.length === 0 && calls.includes("POST /git/refs"));
const firstTree = trees[commits[refSha].tree.sha];
check("files land in logs/<date>/<time>_<version>_<id>/", firstTree.tree.every(e => /^logs\/\d{4}-\d\d-\d\d\/\d{6}_0\.15\.20_0123456789abcdef\//.test(e.path)) && !firstTree.base_tree);
const first = refSha;
r = await worker.fetch(new Request("https://relay/api/logs"), env);
const index = await r.json();
check("dashboard API lists uploaded bundles", r.status === 200 && index.uploads.length === 1 && index.uploads[0].files.length === 2 && index.totalBytes === 8);
check("health endpoint reports upload and file counts", (await worker.fetch(new Request("https://relay/api/health"), env)).status === 200);
const logPath = index.uploads[0].files[0].path;
r = await worker.fetch(new Request("https://relay/api/log?path=" + encodeURIComponent(logPath)), env);
check("dashboard API reads an uploaded log", r.status === 200 && (await r.text()) === "hello");
check("dashboard rejects paths outside the log allowlist", (await worker.fetch(new Request("https://relay/api/log?path=" + encodeURIComponent("../secrets.txt")), env)).status === 400);
r = await post(good); check("second upload builds on the branch", r.status === 200 && commits[refSha].parents[0] === first && trees[commits[refSha].tree.sha].base_tree);
raceOnce = true; r = await post(good); check("a race retries on top of the moved branch", r.status === 200 && commits[refSha].parents[0] === "cX");
check("bad file name refused", (await post({ ...good, files: [{ name: "../../.github/workflows/x.yml", text: "a" }] })).status === 400);
check("other names refused", (await post({ ...good, files: [{ name: "secrets.txt", text: "a" }] })).status === 400);
check("bad version refused", (await post({ ...good, version: "<script>" })).status === 400);
check("bad upload id refused", (await post({ ...good, upload: "../x" })).status === 400);
check("too many files refused", (await post({ ...good, files: Array(13).fill(good.files[0]) })).status === 400);
check("too much text refused", (await post({ ...good, files: [{ name: "VivifyReport.txt", text: "a".repeat(4.6 * 1024 * 1024) }] })).status === 413);
check("GET refused", (await worker.fetch(new Request("https://relay/"), env)).status === 405);
check("no token refused", (await worker.fetch(new Request("https://relay/", { method: "POST", body: "{}" }), {})).status === 500);
console.log(fails + " failure(s)"); process.exit(fails ? 1 : 0);
