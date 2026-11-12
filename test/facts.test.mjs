// The GitHub-facts mapping shared by the build (scripts/github.mjs) and the browser (src/facts/github-facts.ts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { after, before, describe, test } from "node:test";
import { parseRelease, parseRepo } from "../src/facts/github-facts.ts";

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const NAME = "MrAryanCode/certway";

describe("parseRepo", () => {
  test("maps the fixture", () => {
    const repo = parseRepo(NAME)(fixture("repo-certway.json"));
    assert.deepEqual(repo, {
      fullName: NAME,
      htmlUrl: "https://github.com/MrAryanCode/certway",
      stars: 3,
      pushedAt: "2026-11-07T17:31:27Z",
      license: "MIT",
      description: null,
    });
  });

  test("a repository without a license maps to license: null, not a failure", () => {
    const repo = parseRepo(NAME)({ ...fixture("repo-certway.json"), license: null });
    assert.ok(repo !== null);
    assert.equal(repo.license, null);
  });

  test("a license without an SPDX id falls back to its name", () => {
    const repo = parseRepo(NAME)({ ...fixture("repo-certway.json"), license: { name: "Other", spdx_id: null } });
    assert.equal(repo?.license, "Other");
  });

  test("a private repository, another full_name or a missing field is rejected", () => {
    const good = fixture("repo-certway.json");
    assert.equal(parseRepo(NAME)({ ...good, private: true }), null);
    assert.equal(parseRepo(NAME)({ ...good, full_name: "someone/else" }), null);
    assert.equal(parseRepo(NAME)({ ...good, stargazers_count: "3" }), null);
    assert.equal(parseRepo(NAME)(null), null);
  });
});

describe("parseRelease", () => {
  test("maps the fixture", () => {
    assert.deepEqual(parseRelease(fixture("release-latest-certway.json")), {
      tag: "v1.0.1",
      url: "https://github.com/MrAryanCode/certway/releases/tag/v1.0.1",
      publishedAt: "2026-11-07T17:35:21Z",
    });
  });

  test("a missing tag is rejected", () => {
    assert.equal(parseRelease({ html_url: "https://example.test", published_at: null }), null);
  });
});

describe("fetchFacts (build-time GETs)", () => {
  let server;
  let seen = [];
  let status = 200;
  let fetchFacts;
  before(async () => {
    server = createServer((req, res) => {
      seen.push({ url: req.url, auth: req.headers.authorization ?? null });
      if (status !== 200) { res.writeHead(status, { "content-type": "application/json" }); return res.end("{}"); }
      const file = req.url === `/repos/${NAME}` ? "repo-certway.json" : req.url === `/repos/${NAME}/releases/latest` ? "release-latest-certway.json" : null;
      if (!file) { res.writeHead(404, { "content-type": "application/json" }); return res.end("{}"); }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(readFileSync(new URL(`./fixtures/${file}`, import.meta.url)));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    // scripts/github.mjs reads its environment once, at import time.
    process.env.SITE_GITHUB_API_URL = `http://127.0.0.1:${server.address().port}`;
    delete process.env.SITE_GITHUB_TOKEN;
    ({ fetchFacts } = await import("../scripts/github.mjs"));
  });
  after(() => new Promise((resolve) => server.close(resolve)));

  test("makes exactly the two GETs, unauthenticated, and returns build-time facts", async () => {
    seen = [];
    status = 200;
    const facts = await fetchFacts();
    assert.deepEqual(seen.map((s) => s.url), [`/repos/${NAME}`, `/repos/${NAME}/releases/latest`]);
    assert.ok(seen.every((s) => s.auth === null));
    assert.equal(facts.live, false);
    assert.equal(facts.repo.license, "MIT");
    assert.equal(facts.release.tag, "v1.0.1");
  });

  test("a non-200 answer rejects", async () => {
    status = 500;
    await assert.rejects(fetchFacts(), /answered 500/);
  });
});
