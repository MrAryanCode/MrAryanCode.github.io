// Local stand-in for api.github.com: serves the saved certway fixtures and counts requests.
// Usage: node fixture-api.mjs <fixturesDir> [port]
// Control: GET /__stats, GET /__reset, GET /__mode?status=403 (every API path then answers that status).
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [dir, portArg] = process.argv.slice(2);
const port = Number(portArg ?? 4599);
const routes = {
  "/repos/MrAryanCode/certway": join(dir, "repo-certway.json"),
  "/repos/MrAryanCode/certway/releases/latest": join(dir, "release-latest-certway.json"),
  "/repositories/1317222266": join(dir, "repo-certway.json"),
};
let stats = { requests: {}, withAuth: 0, withoutAuth: 0, apiVersionHeaders: {} };
let forced = 0; let forcedPath = null; let forcedLocation = null;
let remaining = 60;

createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/__stats") return res.end(JSON.stringify(stats));
  if (url.pathname === "/__reset") { stats = { requests: {}, withAuth: 0, withoutAuth: 0, apiVersionHeaders: {} }; forced = 0; forcedPath = null; forcedLocation = null; remaining = 60; return res.end("ok"); }
  if (url.pathname === "/__mode") { forced = Number(url.searchParams.get("status") ?? 0); forcedPath = url.searchParams.get("path"); forcedLocation = url.searchParams.get("location"); return res.end("mode " + forced + " " + forcedPath); }
  stats.requests[url.pathname] = (stats.requests[url.pathname] ?? 0) + 1;
  if (req.headers.authorization) stats.withAuth++; else stats.withoutAuth++;
  const v = req.headers["x-github-api-version"] ?? "(none)";
  stats.apiVersionHeaders[v] = (stats.apiVersionHeaders[v] ?? 0) + 1;
  remaining = Math.max(0, remaining - 1);
  const base = { "content-type": "application/json; charset=utf-8", "x-ratelimit-limit": "60", "x-ratelimit-remaining": String(remaining) };
  if (forced && (!forcedPath || forcedPath === url.pathname)) { if (forcedLocation) base.location = forcedLocation; res.writeHead(forced, base); return res.end(JSON.stringify({ message: "API rate limit exceeded (fixture)" })); }
  const file = routes[url.pathname];
  if (!file) { res.writeHead(404, base); return res.end(JSON.stringify({ message: "Not Found" })); }
  res.writeHead(200, base);
  res.end(readFileSync(file));
}).listen(port, "127.0.0.1", () => console.log("fixture-api on " + port));
