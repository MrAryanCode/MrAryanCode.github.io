// AT-05 (node): the build fails closed when the GitHub API does not give two clean answers (plan P-10, B-10).
// For each case the fixture API is switched with /__mode, `npm run build` (node scripts/build.mjs) runs against it,
// and the build must exit non-zero and leave neither dist/ nor .stage/. The fixture API answers a failing status
// with the real fixture body, so only the status check of scripts/github.mjs can make the build stop.
// A control case with no failure proves that the same setup builds, so the cases cannot fail for another reason.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { get } from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { root, API_PORT } from "./helpers.mjs";

const REPO = "/repos/MrAryanCode/certway";
const RELEASE = "/repos/MrAryanCode/certway/releases/latest";
let api;

before(async () => {
  api = spawn(process.execPath, [join(root, "tools", "fixture-api.mjs"), join(root, "test", "fixtures"), String(API_PORT)], { cwd: root, stdio: "ignore" });
  await sleep(500);
});

after(async () => {
  if (api.exitCode === null && api.signalCode === null) await new Promise((resolve) => { api.once("exit", resolve); api.kill(); });
});

// A fresh connection each time (agent: false): the build above blocks this process for up to 15 s, and a pooled
// keep-alive connection that the fixture API closed meanwhile made fetch fail with "other side closed".
const mode = (query) =>
  new Promise((resolve, reject) => {
    get(`http://127.0.0.1:${API_PORT}/__mode?${query}`, { agent: false }, (res) => {
      res.resume();
      res.on("end", () => {
        assert.equal(res.statusCode, 200);
        resolve();
      });
    }).on("error", reject);
  });

function build() {
  const env = { ...process.env, SITE_GITHUB_API_URL: `http://127.0.0.1:${API_PORT}`, NODE_ENV: "production" };
  delete env.GITHUB_SHA;
  delete env.SITE_GITHUB_TOKEN;
  const r = spawnSync(process.execPath, [join(root, "scripts", "build.mjs")], { cwd: root, env, encoding: "utf8" });
  return { status: r.status, output: r.stdout + r.stderr };
}

const noOutputLeft = () => {
  assert.equal(existsSync(join(root, "dist")), false, "dist/ exists after a failed build");
  assert.equal(existsSync(join(root, ".stage")), false, ".stage/ exists after a failed build");
};

const cases = [
  ["500 on both paths", "status=500", /answered 500/],
  ["429 on both paths", "status=429", /answered 429/],
  ["301 on the repository path", `status=301&path=${REPO}&location=${encodeURIComponent("https://api.example.invalid/repos/MrAryanCode/certway")}`, /request failed/],
  ["404 on the release path", `status=404&path=${RELEASE}`, new RegExp(`${RELEASE.replaceAll("/", "\/")} answered 404`)],
  ["a repository with private: true", "private=1", /private must be false/],
  ["no answer for 16 s (past the 15 s limit)", "hang=16000", /request failed/],
];

for (const [name, query, message] of cases) {
  test(`AT-05 the build fails closed: ${name}`, async () => {
    await mode(query);
    const r = build();
    assert.notEqual(r.status, 0, `the build succeeded:\n${r.output}`);
    assert.match(r.output, message);
    noOutputLeft();
  });
}

test("AT-05 control: with no failure the same setup builds", async () => {
  await mode("status=0");
  const r = build();
  assert.equal(r.status, 0, r.output);
  assert.equal(existsSync(join(root, "dist", "index.html")), true);
});
