// AT-02 (node): what loads first, on the production build (plan P-10).
// The JavaScript that dist/index.html loads before interaction is at most 35 KB gzip. That is every inline script
// of the page, every <script src>, every modulepreload link, and every chunk those scripts import statically
// (`import ... from "./x.js"`); a dynamic `import("./x.js")` is not loaded first. The tier-2 worker and the
// tier-3 GPU files are separate files in dist/assets/ and are not part of that set.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { buildAndServe, dist, html, stopAll } from "./helpers.mjs";

const BUDGET_BYTES = 35 * 1024;
const gzipSize = (buf) => gzipSync(buf).length;

before(() => buildAndServe());
after(() => stopAll());

/** The files dist/index.html loads as JavaScript, then every chunk they import statically. Paths are relative to dist/. */
function firstLoad() {
  const page = html("index.html");
  const inline = [...page.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((s) => s.trim());
  const direct = [
    ...[...page.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]),
    ...[...page.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g)].map((m) => m[1]),
  ].map((href) => href.replace(/^\//, ""));
  const files = new Set();
  const queue = [...direct];
  while (queue.length) {
    const file = queue.shift();
    if (files.has(file)) continue;
    files.add(file);
    const code = readFileSync(dist(file), "utf8");
    // Static imports and re-exports: `from"./x.js"`, `from "./x.js"`, and the side-effect form `import"./x.js"`.
    for (const m of code.matchAll(/(?:\bfrom\s*|\bimport\s*)["'](\.{1,2}\/[^"']+\.js)["']/g)) {
      const target = new URL(m[1], `http://x/${file}`).pathname.slice(1);
      queue.push(target);
    }
  }
  return { inline, files: [...files] };
}

test("AT-02 the JavaScript loaded first is at most 35 KB gzip", () => {
  const { inline, files } = firstLoad();
  assert.ok(files.length > 0, "dist/index.html loads no script file");
  const sizes = files.map((f) => [f, gzipSize(readFileSync(dist(f)))]);
  const total = sizes.reduce((n, [, size]) => n + size, 0) + inline.reduce((n, s) => n + gzipSize(Buffer.from(s)), 0);
  assert.ok(total <= BUDGET_BYTES, `first-load JavaScript is ${total} bytes gzip (budget ${BUDGET_BYTES}): ${JSON.stringify(sizes)} and ${inline.length} inline script(s)`);
});

test("AT-02 the tier-2 worker and the tier-3 GPU files are separate files, not loaded first", () => {
  const assets = readdirSync(dist("assets")).filter((f) => f.endsWith(".js"));
  const { files } = firstLoad();
  const loadedFirst = new Set(files.map((f) => f.replace(/^assets\//, "")));
  const workers = assets.filter((f) => /worker/i.test(f));
  const gpu = assets.filter((f) => /^(tier3|layer|gpu|webgl2|core|modes)\b/i.test(f));
  assert.ok(workers.length > 0, `no worker file in dist/assets/: ${assets.join(", ")}`);
  assert.ok(gpu.length > 0, `no GPU file in dist/assets/: ${assets.join(", ")}`);
  for (const f of [...workers, ...gpu]) assert.equal(loadedFirst.has(f), false, `${f} is loaded before interaction`);
});
