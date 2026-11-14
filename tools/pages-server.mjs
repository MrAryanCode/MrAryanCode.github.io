// Static server that copies the GitHub Pages path behaviour observed on 2026-11-08:
//  - exact, case-sensitive file match -> 200
//  - directory without trailing slash -> 301 to "<path>/"
//  - directory with trailing slash -> its index.html (200), else 404
//  - extensionless path whose "<path>.html" exists -> 200 with that file
//  - a file path followed by "/" -> 404
//  - every 404 serves <root>/404.html when it exists
// Usage: node pages-server.mjs <root> [port]
import { createServer } from "node:http";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const [root, portArg] = process.argv.slice(2);
const port = Number(portArg ?? 4600);
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".png": "image/png",
  ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".ico": "image/x-icon", ".xml": "application/xml",
  ".txt": "text/plain", ".json": "application/json", ".webmanifest": "application/manifest+json" };

// Resolve segments with exact (case-sensitive) names even on a case-insensitive file system.
function resolveExact(segments) {
  let cur = root;
  for (const seg of segments) {
    let names;
    try { names = readdirSync(cur); } catch { return null; }
    if (!names.includes(seg)) return null;
    cur = join(cur, seg);
  }
  return cur;
}

function send(res, status, file, extra = {}) {
  res.writeHead(status, { "content-type": types[extname(file)] ?? "application/octet-stream", ...extra });
  res.end(readFileSync(file));
}

function notFound(res) {
  const f = join(root, "404.html");
  if (existsSync(f)) return send(res, 404, f);
  res.writeHead(404, { "content-type": "text/plain" }); res.end("404 (no 404.html)");
}

createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const path = decodeURIComponent(url.pathname);
  const trailing = path.endsWith("/");
  const segments = path.split("/").filter(Boolean);
  const hit = resolveExact(segments);
  if (hit) {
    const st = statSync(hit);
    if (st.isDirectory()) {
      if (!trailing) { res.writeHead(301, { location: path + "/" + url.search }); return res.end(); }
      const idx = resolveExact([...segments, "index.html"]);
      return idx ? send(res, 200, idx) : notFound(res);
    }
    if (trailing) return notFound(res);
    return send(res, 200, hit);
  }
  if (!trailing && segments.length && !extname(path)) {
    const last = segments[segments.length - 1] + ".html";
    const html = resolveExact([...segments.slice(0, -1), last]);
    if (html) return send(res, 200, html);
  }
  return notFound(res);
}).listen(port, "127.0.0.1", () => console.log("pages-server on " + port + " root " + root));
