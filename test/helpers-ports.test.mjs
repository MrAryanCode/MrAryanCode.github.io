// The port offset of test/helpers.mjs (TEST_PORT_OFFSET). Node only, no browser: each case reads the helper's ports in a
// fresh process, because the helper reads the variable once, when it is loaded.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { root } from "./helpers.mjs";

const helpers = pathToFileURL(join(root, "test", "helpers.mjs")).href;
const PRINT = `import(${JSON.stringify(helpers)}).then(
  (m) => console.log(JSON.stringify({ API_PORT: m.API_PORT, SITE_PORT: m.SITE_PORT, TEST_SITE_PORT: m.TEST_SITE_PORT, BASE: m.BASE, TEST_BASE: m.TEST_BASE })),
  (e) => { console.log(JSON.stringify({ error: e.message })); });`;

/** Loads test/helpers.mjs in a new process whose TEST_PORT_OFFSET is `offset` (undefined: unset) and returns what it exports. */
function portsWith(offset) {
  const env = { ...process.env };
  delete env.TEST_PORT_OFFSET;
  if (offset !== undefined) env.TEST_PORT_OFFSET = offset;
  const r = spawnSync(process.execPath, ["-e", PRINT], { env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

const DEFAULT = { API_PORT: 4611, SITE_PORT: 4612, TEST_SITE_PORT: 4613 };
const PORT_NAMES = Object.keys(DEFAULT);

test("without the variable (and with an empty one) every port is the fixed default", () => {
  for (const offset of [undefined, ""]) {
    const p = portsWith(offset);
    for (const [name, port] of Object.entries(DEFAULT)) assert.equal(p[name], port, `${name} with offset ${JSON.stringify(offset)}`);
    assert.equal(p.BASE, "http://127.0.0.1:4612");
    assert.equal(p.TEST_BASE, "http://127.0.0.1:4613");
  }
});

test("an offset of 100 moves every port by 100", () => {
  const p = portsWith("100");
  for (const [name, port] of Object.entries(DEFAULT)) assert.equal(p[name], port + 100, name);
  assert.equal(p.BASE, "http://127.0.0.1:4712");
  assert.equal(p.TEST_BASE, "http://127.0.0.1:4713");
});

test("an invalid offset throws an error whose message starts with TEST_PORT_OFFSET", () => {
  for (const bad of ["abc", "-1", "1.5", "1e2", " 5", "0x10", "100 "]) {
    const p = portsWith(bad);
    assert.match(p.error ?? "", /^TEST_PORT_OFFSET/, `value ${JSON.stringify(bad)} did not throw`);
  }
});

const children = [];
let dir;
after(async () => {
  await Promise.all(children.map((c) => new Promise((resolve) => {
    if (c.exitCode !== null || c.signalCode !== null) return resolve();
    c.once("exit", resolve);
    c.kill();
  })));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function get(url) {
  for (let i = 0; i < 50; i++) {
    try { return await fetch(url); } catch { await sleep(100); }
  }
  throw new Error(`no answer from ${url}`);
}

// The test uses large offsets that differ by 100, not 0 and 100, so that it never takes the ports 4611 to 4613 that a
// browser run on the same machine holds. The mechanism is the one the default offset of 0 uses.
test("two buildAndServe-style servers with different offsets run at the same time and both answer", async () => {
  dir = mkdtempSync(join(tmpdir(), "helpers-ports-"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>ports</title>");
  const offsets = ["30000", "30100"];
  const sites = [];
  for (const offset of offsets) {
    const p = portsWith(offset);
    children.push(spawn(process.execPath, [join(root, "tools", "fixture-api.mjs"), join(root, "test", "fixtures"), String(p.API_PORT)], { stdio: "ignore" }));
    children.push(spawn(process.execPath, [join(root, "tools", "pages-server.mjs"), dir, String(p.SITE_PORT)], { stdio: "ignore" }));
    sites.push(p);
  }
  assert.equal(new Set(sites.flatMap((p) => PORT_NAMES.map((n) => p[n]))).size, PORT_NAMES.length * 2, "the two runs share a port");
  for (const [i, p] of sites.entries()) {
    const page = await get(`${p.BASE}/`);
    assert.equal(page.status, 200, `site of offset ${offsets[i]}`);
    assert.match(await page.text(), /<title>ports<\/title>/);
    const api = await get(`http://127.0.0.1:${p.API_PORT}/repos/MrAryanCode/certway`);
    assert.equal(api.status, 200, `fixture API of offset ${offsets[i]}`);
  }
});
