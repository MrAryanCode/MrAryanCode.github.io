// Hydration checks. Built with Solid's development runtime, because only that runtime reports a hydration mismatch.
// The suite runs twice: on a build with a build stamp (GITHUB_SHA set, as on Actions) and on a build without one
// (a local build), because the footer's stamp line is rendered on the server and must hydrate in both shapes.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { chromium } from "playwright";
import { BASE, TEST_SHA, buildAndServe, stopAll } from "./helpers.mjs";

// Counts DOM changes under #root made outside [data-client-only] zones after parsing ended.
// Module scripts (hydration) run after readyState becomes "interactive", so parser insertions are discarded first.
const MUTATION_COUNTER = () => {
  window.__mutations = [];
  let armed = false;
  const obs = new MutationObserver((records) => {
    if (!armed) return;
    for (const r of records) {
      const el = r.target.nodeType === 1 ? r.target : r.target.parentElement;
      if (el && el.closest("#root") && !el.closest("[data-client-only]")) window.__mutations.push(`${r.type}:${el.tagName}`);
    }
  });
  obs.observe(document, { childList: true, subtree: true, characterData: true, attributes: true });
  document.addEventListener("readystatechange", () => {
    if (document.readyState === "interactive") { obs.takeRecords(); armed = true; }
  });
};

for (const { label, githubSha } of [
  { label: "build stamp set (GITHUB_SHA set)", githubSha: TEST_SHA },
  { label: "build null (GITHUB_SHA unset)", githubSha: null },
]) {
  describe(label, () => {
    let browser;
    before(async () => {
      await buildAndServe({ development: true, githubSha });
      browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
    });
    after(async () => {
      await browser?.close();
      await stopAll();
    });

    async function open(path) {
      const ctx = await browser.newContext();
      const requests = [];
      const logs = [];
      ctx.on("request", (r) => requests.push(new URL(r.url()).port === "4611" ? "GITHUB-FIXTURE" : new URL(r.url()).pathname));
      const page = await ctx.newPage();
      page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
      page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
      await page.addInitScript(MUTATION_COUNTER);
      await page.goto(BASE + path, { waitUntil: "load" });
      return { ctx, page, requests, logs };
    }

    test("JavaScript on: hydrates without warnings, mutations or GitHub requests", async () => {
      for (const path of ["/", "/projects/certway/", "/report/", "/nope/x"]) {
        const { ctx, page, requests, logs } = await open(path);
        await page.waitForFunction(() => window.__hydrated === true);
        await page.waitForTimeout(300);
        // Two browser notices are not hydration output: the 404 page's own status, and Chrome's warning
        // when the GPU layer asks for a WebGPU adapter on a runner that has none (seen on ubuntu-26.04).
        assert.deepEqual(logs.filter((l) => !/Failed to load resource.*404/.test(l) && l !== "warning: No available adapters."), [], `${path} console`);
        assert.deepEqual(await page.evaluate(() => window.__mutations), [], `${path} DOM changed during hydration`);
        assert.ok(!requests.some((r) => r.includes("GITHUB")), `${path} requested the GitHub API`);
        await ctx.close();
      }
    });

    test("the footer build stamp matches the build", async () => {
      const { ctx, page } = await open("/");
      await page.waitForFunction(() => window.__hydrated === true);
      const data = JSON.parse(await page.locator("#site-data").textContent());
      const commit = "https://github.com/MrAryanCode/MrAryanCode.github.io/commit/";
      const stamp = page.locator(`footer a[href^='${commit}']`);
      if (githubSha === null) {
        assert.equal(data.build, null);
        assert.equal(await stamp.count(), 0);
        assert.ok(!(await page.locator("footer").innerText()).includes("Built "));
      } else {
        assert.equal(data.build.sha, githubSha);
        assert.match(data.build.builtAt, /^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
        assert.equal(await stamp.getAttribute("href"), commit + githubSha);
        assert.equal(await stamp.innerText(), githubSha.slice(0, 7));
        assert.match(await page.locator("footer p").last().innerText(), /^Built \d{4}-\d\d-\d\d \d\d:\d\d UTC from 0123456$/);
      }
      await ctx.close();
    });

    test("the mutation counter sees a change made after hydration (positive control)", async () => {
      const { ctx, page } = await open("/report/");
      await page.waitForFunction(() => window.__hydrated === true);
      await page.evaluate(() => document.querySelector("main").append(document.createElement("i")));
      await page.waitForTimeout(100);
      assert.deepEqual(await page.evaluate(() => window.__mutations), ["childList:MAIN"]);
      await ctx.close();
    });
  });
}
