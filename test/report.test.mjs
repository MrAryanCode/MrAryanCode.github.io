// Tests of the engineering report page (design.md DS-09, plan T-013): the injector, the run line, the Lighthouse rows,
// the motion hooks, the layout at 320, 390 and 480 px in both themes in all three engines, the stacked table, and the
// hydration of the injected page. Builds into dist/ like the other test files and serves it on ports of its own
// (taken from the operating system), so it never collides with the fixed ports of test/helpers.mjs.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium, firefox, webkit } from "playwright";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixture = JSON.parse(readFileSync(join(root, "test", "fixtures", "quality.json"), "utf8"));
const pages = JSON.parse(readFileSync(join(root, "quality", "pages.json"), "utf8"));
const SHA = fixture.commit;
const SHA7 = SHA.slice(0, 7);
const REPO = "https://github.com/MrAryanCode/MrAryanCode.github.io";
const RUN_URL = `${REPO}/actions/runs/1`;
const CI_ENV = { GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "MrAryanCode/MrAryanCode.github.io", GITHUB_RUN_ID: "1", GITHUB_SHA: SHA };
const CAPTION = "Per page, median run";
const COLUMNS = ["Page", "Performance", "Accessibility", "LCP (ms)", "TBT (ms)", "CLS"];

// Number formats of design.md DS-09, written independently of the injector: scores times 100, milliseconds with a comma, CLS with three decimals.
const group = (n) => n.toLocaleString("en-US");
const score = (s) => String(Math.round(s * 100));
const ms = (n) => group(Math.round(n));
const pageName = (entry) => (entry.file === "404.html" ? "404 page" : entry.path);
const lighthouseRow = (entry) => {
  const lh = fixture.performance.pages.find((p) => p.file === entry.file);
  return [pageName(entry), score(lh.scores.performance), score(lh.scores.accessibility), ms(lh.metrics.lcpMs), ms(lh.metrics.tbtMs), lh.metrics.cls.toFixed(3)];
};

// ---------- Harness ----------
const freePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

/** The text of an HTML fragment: tags and the hydration comments are removed, white space is collapsed. */
const textOf = (fragment) => fragment.replace(/<!--.*?-->/gs, "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

/** The cells of every tbody row of the Lighthouse table, as text. */
const tableRows = (html) =>
  [...html.match(/<tbody>.*?<\/tbody>/s)[0].matchAll(/<tr>(.*?)<\/tr>/gs)].map((tr) => [...tr[1].matchAll(/<t[hd][^>]*>(.*?)<\/t[hd]>/gs)].map((cell) => textOf(cell[1])));

const children = [];
const spawnNode = (args) => {
  const child = spawn(process.execPath, args, { cwd: root, stdio: "ignore" });
  children.push(child);
  return child;
};
async function stopChildren() {
  const running = children.splice(0);
  await Promise.all(running.map((c) => new Promise((resolve) => {
    if (c.exitCode !== null || c.signalCode !== null) return resolve();
    c.once("exit", resolve);
    c.kill();
  })));
}

/**
 * Builds the site against the fixture API with exactly the GITHUB_* variables of `env` (GITHUB_ACTIONS sets all four on
 * every run, `npm test` included, so the ones this test does not want are removed first). Returns the report page, and
 * `serve()` starts the Pages-like server on dist/ with `injected` set to put the fixture numbers into the page first.
 */
async function buildSite({ env, development = false }) {
  const apiPort = await freePort();
  spawnNode([join(root, "tools", "fixture-api.mjs"), join(root, "test", "fixtures"), String(apiPort)]);
  await sleep(500);
  const buildEnv = { ...process.env, SITE_GITHUB_API_URL: `http://127.0.0.1:${apiPort}`, NODE_ENV: development ? "development" : "production" };
  for (const key of Object.keys(CI_ENV)) delete buildEnv[key];
  Object.assign(buildEnv, env);
  const r = spawnSync(process.execPath, [join(root, "scripts", "build.mjs")], { cwd: root, env: buildEnv, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`build failed (${r.status}): ${r.stdout}\n${r.stderr}`);
  const file = join(root, "dist", "report", "index.html");
  return {
    file,
    template: readFileSync(file, "utf8"),
    async serve({ injected = false } = {}) {
      if (injected) {
        const i = spawnSync(process.execPath, [join(root, "scripts", "inject-report.cjs"), join(root, "test", "fixtures", "quality.json"), file], { encoding: "utf8" });
        if (i.status !== 0) throw new Error(`inject failed: ${i.stderr}`);
      }
      const port = await freePort();
      spawnNode([join(root, "tools", "pages-server.mjs"), join(root, "dist"), String(port)]);
      await sleep(500);
      return `http://127.0.0.1:${port}`;
    },
  };
}

const ENGINES = { chromium, firefox, webkit };
const launch = (name) => ENGINES[name].launch({ headless: true, executablePath: name === "chromium" ? process.env.CHROMIUM_PATH || undefined : undefined });

async function open(browser, url, { width = 1000, scheme = "light" } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, colorScheme: scheme });
  const page = await ctx.newPage();
  const problems = [];
  page.on("console", (m) => problems.push(`${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  await page.goto(`${url}/report/`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__hydrated === true);
  return { ctx, page, problems };
}

// ---------- Static files ----------
describe("lychee.toml", () => {
  test("excludes the CI run URL prefix, in a single-quoted TOML string", () => {
    const toml = readFileSync(join(root, "lychee.toml"), "utf8");
    assert.ok(toml.includes(String.raw`'^https://github\.com/MrAryanCode/MrAryanCode\.github\.io/actions/runs/'`));
    assert.ok(toml.includes(String.raw`'^https://www\.linkedin\.com'`), "the base exclude is kept");
    assert.ok(!/"[^"\n]*\\\.[^"\n]*"/.test(toml), "no backslash escape inside a double-quoted string (a TOML parse error)");
  });
});

// ---------- The report with the four variables an Actions run sets ----------
describe("report built as on Actions (GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID and GITHUB_SHA set)", () => {
  let site;
  let url;
  const tmp = mkdtempSync(join(tmpdir(), "report-test-"));

  before(async () => {
    site = await buildSite({ env: CI_ENV });
    // The template is kept apart from the page that is injected and served.
    url = await site.serve({ injected: true });
  });
  after(async () => {
    await stopChildren();
    rmSync(tmp, { recursive: true, force: true });
  });

  /** Runs the injector on a copy of the page; returns its exit status, error text and the page afterwards. */
  function inject(page, quality = fixture) {
    const pageFile = join(tmp, "page.html");
    const qualityFile = join(tmp, "quality.json");
    writeFileSync(pageFile, page);
    writeFileSync(qualityFile, JSON.stringify(quality));
    const r = spawnSync(process.execPath, [join(root, "scripts", "inject-report.cjs"), qualityFile, pageFile], { cwd: root, encoding: "utf8" });
    return { status: r.status, stderr: r.stderr, page: readFileSync(pageFile, "utf8") };
  }

  describe("scripts/inject-report.cjs", () => {
    test("the template holds placeholders and no number", () => {
      assert.ok(site.template.includes("__UNIT_PASSED__"));
      assert.ok(!site.template.includes("137 of 140"));
    });

    test("fills every placeholder of the template and writes the page", () => {
      const r = inject(site.template);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(!r.page.includes("__"), "no placeholder is left");
      assert.ok(r.page.includes("137"));
    });

    test("throws on a placeholder missing from the page, and leaves the page unwritten", () => {
      const without = site.template.split("__UNIT_SKIPPED__").join("0");
      const r = inject(without);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /placeholder missing: __UNIT_SKIPPED__/);
      assert.equal(r.page, without);
    });

    test("throws on a Lighthouse placeholder missing from the page", () => {
      const r = inject(site.template.split("__LH_4_CLS__").join("0.000"));
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /placeholder missing: __LH_4_CLS__/);
    });

    test("throws on a placeholder left over after the replacement", () => {
      const r = inject(site.template.replace("</main>", "<p>__NOT_FILLED__</p></main>"));
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /unreplaced placeholder left in .*page\.html/);
    });

    test("throws when quality.json has no Lighthouse result for a page of quality/pages.json", () => {
      const quality = structuredClone(fixture);
      quality.performance.pages = quality.performance.pages.filter((p) => p.file !== "404.html");
      const r = inject(site.template, quality);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /no Lighthouse result for 404\.html/);
    });

    test("formats scores, milliseconds, CLS and counts as DS-09 says", () => {
      const quality = structuredClone(fixture);
      quality.unitTests = { passed: 1234567, failed: 0, skipped: 999, total: 1235566 };
      const first = quality.performance.pages.find((p) => p.file === "index.html");
      first.scores.performance = 0.964;
      first.metrics.lcpMs = 12345.6;
      first.metrics.tbtMs = 999.5;
      first.metrics.cls = 0.1234;
      const r = inject(site.template, quality);
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(tableRows(r.page)[0], ["/", "96", "100", "12,346", "1,000", "0.123"]);
      const text = textOf(r.page.match(/<main.*<\/main>/s)[0]);
      assert.ok(text.includes("1,234,567 of 1,235,566"), text);
      assert.ok(text.includes("Skipped999"), text);
    });
  });

  describe("Lighthouse rows", () => {
    test("the template has one row per entry of quality/pages.json, in order, with that row's placeholders", () => {
      const rows = tableRows(site.template);
      assert.equal(rows.length, pages.length);
      pages.forEach((entry, i) => {
        const n = i + 1;
        assert.deepEqual(rows[i], [pageName(entry), ...["PERFORMANCE", "ACCESSIBILITY", "LCP", "TBT", "CLS"].map((m) => `__LH_${n}_${m}__`)], `row ${n}`);
      });
    });

    test("the injected rows equal quality.json for each page of quality/pages.json", () => {
      const rows = tableRows(inject(site.template).page);
      assert.deepEqual(rows, pages.map(lighthouseRow));
    });
  });

  describe("run line and Defined in links in the served HTML", () => {
    test("links the run once and the commit once", () => {
      const html = readFileSync(site.file, "utf8");
      const line = html.match(/<p[^>]*data-run-line[^>]*>.*?<\/p>/s)[0];
      assert.equal(textOf(line), `Every number on this page comes from the CI run that built this page, for commit ${SHA7}.`);
      assert.deepEqual([...line.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]), [RUN_URL, `${REPO}/commit/${SHA}`]);
    });
  });

  for (const name of Object.keys(ENGINES)) {
    describe(`in ${name}`, () => {
      let browser;
      before(async () => {
        browser = await launch(name);
      });
      after(async () => {
        await browser?.close();
      });

      test("hooks: data-field-kind 7 on the header band and 6 on the body, data-fx tiles on each check, scan on each h2 row", async () => {
        const { ctx, page } = await open(browser, url);
        const found = await page.evaluate(() => ({
          band: [...document.querySelectorAll('[data-field-kind="7"]')].map((el) => ({ cls: el.className, h1: !!el.querySelector("h1"), inMain: !!el.closest("main") })),
          body: [...document.querySelectorAll('[data-field-kind="6"]')].map((el) => ({ checks: el.querySelectorAll("section.check").length })),
          tiles: [...document.querySelectorAll('[data-fx="tiles"]')].map((el) => ({ tag: el.tagName, check: el.classList.contains("check"), h2: el.querySelectorAll("h2").length })),
          scan: [...document.querySelectorAll('main h2')].map((h2) => h2.parentElement.matches('[data-fx="scan"]')),
          scanRows: document.querySelectorAll('[data-fx="scan"]').length,
        }));
        assert.deepEqual(found.band, [{ cls: "band", h1: true, inMain: true }]);
        assert.deepEqual(found.body, [{ checks: 6 }]);
        assert.deepEqual(found.tiles, Array.from({ length: 6 }, () => ({ tag: "SECTION", check: true, h2: 1 })));
        assert.deepEqual(found.scan, Array.from({ length: 6 }, () => true));
        assert.equal(found.scanRows, 6);
        await ctx.close();
      });

      test("the hydrated page prints no console message and no error", async () => {
        const { ctx, problems } = await open(browser, url);
        assert.deepEqual(problems, []);
        await ctx.close();
      });

      for (const width of [320, 390, 480]) {
        for (const scheme of ["light", "dark"]) {
          test(`${width} px, ${scheme}: no sideways scroll, no truncated tile, tile labels in English`, async () => {
            const { ctx, page } = await open(browser, url, { width, scheme });
            // The layout under test: the table stacks when the page container is narrower than 480 px (a container query, not the viewport).
            const layout = await page.evaluate(() => ({ main: document.querySelector("main").getBoundingClientRect().width, td: getComputedStyle(document.querySelector("table.perf td")).display }));
            assert.equal(layout.td, layout.main < 479.98 ? "flex" : "table-cell", JSON.stringify(layout));
            if (width < 480) assert.equal(layout.td, "flex");

            const r = await sidewaysReport(page);
            assert.deepEqual(r, { docExtra: 0, bodyExtra: 0, scrollX: 0, elements: [], text: [] });

            const tiles = await page.evaluate(() => [...document.querySelectorAll(".tile-label")].map((el) => ({ text: el.textContent, lang: el.closest("[lang]")?.getAttribute("lang") })));
            assert.equal(tiles.length, 18);
            assert.ok(tiles.every((t) => t.lang === "en"), JSON.stringify(tiles.filter((t) => t.lang !== "en")));
            await ctx.close();
          });
        }
      }

      test("control: a tile that cannot wrap is found by the element and text-range detectors, not by the document check", async () => {
        const { ctx, page } = await open(browser, url, { width: 320 });
        const longWord = "W".repeat(40);
        // The page's own CSS lets a long unbroken word wrap inside its tile.
        await page.evaluate((w) => { document.querySelector(".tile-value").textContent = w; document.querySelector(".tile-label").textContent = w; }, longWord);
        assert.deepEqual(await sidewaysReport(page), { docExtra: 0, bodyExtra: 0, scrollX: 0, elements: [], text: [] }, "safe: the page CSS wraps a long word");
        // The mutant removes what lets it wrap; the tiles clip their overflow, so only the per-element and text-range checks see it.
        await page.addStyleTag({ content: ".tile-label, .tile-value { overflow-wrap: normal; word-break: normal; } .tile { min-width: auto; }" });
        const r = await sidewaysReport(page);
        assert.ok(r.elements.length > 0 || r.text.length > 0 || r.docExtra > 0 || r.scrollX > 0, `the mutant must be detected: ${JSON.stringify(r)}`);
        await ctx.close();
      });

      describe("the stacked performance table", () => {
        for (const width of [390, 800]) {
          test(`${width} px: one table with its caption, column headers, row headers and cells`, async () => {
            const { ctx, page } = await open(browser, url, { width });
            const display = await page.locator("table.perf td").first().evaluate((el) => getComputedStyle(el).display);
            assert.equal(display, width < 480 ? "flex" : "table-cell");
            const label = await page.locator("table.perf td").first().evaluate((el) => getComputedStyle(el, "::before").content);
            if (width < 480) assert.equal(label, '"Performance" / ""');
            await assertTableReads(page);
            await ctx.close();
          });
        }

        const mutants = {
          "content without the empty alternative text": async (page) => page.addStyleTag({ content: "@container page (max-width: 479.98px) { table.perf td::before { content: attr(data-label); } }" }),
          "thead display: none": async (page) => page.addStyleTag({ content: "@container page (max-width: 479.98px) { table.perf thead { display: none; } }" }),
          "th elements replaced by td": async (page) =>
            page.evaluate(() => { for (const th of document.querySelectorAll("table.perf th")) { const td = document.createElement("td"); td.innerHTML = th.innerHTML; th.replaceWith(td); } }),
        };
        for (const [mutant, apply] of Object.entries(mutants)) {
          test(`control at 390 px: the assertions reject "${mutant}"`, async () => {
            const { ctx, page } = await open(browser, url, { width: 390 });
            await apply(page);
            await assert.rejects(assertTableReads(page));
            await ctx.close();
          });
        }
      });
    });
  }

  describe("Chromium engine accessibility tree (CDP)", () => {
    let browser;
    before(async () => {
      browser = await launch("chromium");
    });
    after(async () => {
      await browser?.close();
    });

    async function engineNodes(page) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Accessibility.enable");
      const { nodes } = await cdp.send("Accessibility.getFullAXTree");
      return nodes.filter((n) => !n.ignored).map((n) => ({ role: n.role.value, name: n.name && n.name.value }));
    }

    test("390 px: the engine still has the table, its headers and cells, and no label text in the cell names", async () => {
      const { ctx, page } = await open(browser, url, { width: 390 });
      const nodes = await engineNodes(page);
      const count = (role) => nodes.filter((n) => n.role === role).length;
      assert.equal(count("table"), 1);
      assert.equal(nodes.find((n) => n.role === "table").name, CAPTION);
      assert.equal(count("columnheader"), COLUMNS.length);
      assert.equal(count("rowheader"), pages.length);
      assert.equal(count("cell"), pages.length * (COLUMNS.length - 1));
      assert.deepEqual(nodes.filter((n) => n.role === "cell").map((n) => n.name), pages.flatMap((e) => lighthouseRow(e).slice(1)));
      // The text "LCP (ms)" is once in the tree, in its column header: a leaked data-label would add one per row.
      assert.equal(nodes.filter((n) => n.role === "StaticText" && n.name === "LCP (ms)").length, 1);
      await ctx.close();
    });

    test("control: without the empty alternative text the label is in the cell names of the engine tree", async () => {
      const { ctx, page } = await open(browser, url, { width: 390 });
      await page.addStyleTag({ content: "@container page (max-width: 479.98px) { table.perf td::before { content: attr(data-label); } }" });
      const names = (await engineNodes(page)).filter((n) => n.role === "cell").map((n) => n.name);
      assert.ok(names.includes(`Performance ${score(fixture.performance.pages[0].scores.performance)}`), JSON.stringify(names.slice(0, 5)));
      await ctx.close();
    });
  });
});

// ---------- The run line in the other states ----------
describe("report built locally with a commit but no CI run (GITHUB_RUN_ID unset)", () => {
  let template;
  before(async () => {
    const { GITHUB_RUN_ID, ...withoutRun } = CI_ENV;
    template = (await buildSite({ env: withoutRun })).template;
  });
  after(stopChildren);

  test("the run line names the commit and has no link to a run", () => {
    const line = template.match(/<p[^>]*data-run-line[^>]*>.*?<\/p>/s)[0];
    assert.equal(textOf(line), `Every number on this page comes from the local build of commit ${SHA7}.`);
    assert.deepEqual([...line.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]), [`${REPO}/commit/${SHA}`]);
    assert.ok(!template.includes("data-run-link") && !template.includes("/actions/runs/"));
  });

  test("each Defined in path still links to the commit's copy of the file", () => {
    assert.equal([...template.matchAll(new RegExp(`href="${REPO}/blob/${SHA}/`, "g"))].length, 6);
  });
});

describe("report built with no commit (GITHUB_SHA unset, the other variables set)", () => {
  let template;
  before(async () => {
    const { GITHUB_SHA, ...withoutSha } = CI_ENV;
    template = (await buildSite({ env: withoutSha })).template;
  });
  after(stopChildren);

  test("the run line is omitted, whatever GITHUB_RUN_ID says", () => {
    assert.ok(!template.includes("data-run-line"));
    assert.ok(!template.includes("Every number on this page"));
    assert.ok(!template.includes("/actions/runs/"));
  });

  test("each Defined in path is plain text", () => {
    assert.ok(!template.includes("/blob/"));
    const paths = [...template.matchAll(/<div class="defined-in"[^>]*>(.*?)<\/div>/gs)].map((m) => textOf(m[1]));
    assert.deepEqual(paths, [".github/workflows/pages.yml", "package.json", "package.json", "lighthouserc.cjs", "package.json", ".github/workflows/pages.yml"].map((f) => `Defined in${f}`));
  });
});

// ---------- Hydration of the injected page ----------
// Built with Solid's development runtime, because only that runtime reports a hydration mismatch (test/hydration.test.mjs).
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

const { GITHUB_RUN_ID: _run, ...CI_ENV_WITHOUT_RUN } = CI_ENV;
for (const { label, env } of [
  { label: "all four GITHUB_* variables set (the run line has a link)", env: CI_ENV },
  { label: "commit only (the run line has no link)", env: CI_ENV_WITHOUT_RUN },
  { label: "no variable set (a local build, no run line)", env: {} },
]) {
  describe(`dev build, injected, ${label}`, () => {
    let browser;
    let url;
    before(async () => {
      const site = await buildSite({ env, development: true });
      url = await site.serve({ injected: true });
      browser = await launch("chromium");
    });
    after(async () => {
      await browser?.close();
      await stopChildren();
    });

    test("hydrates the numbers without a warning, an error or a DOM change, and main reads the same", async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const logs = [];
      page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
      page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
      await page.addInitScript(MUTATION_COUNTER);
      await page.goto(`${url}/report/`, { waitUntil: "load" });
      const before = await page.locator("main").innerText();
      await page.waitForFunction(() => window.__hydrated === true);
      await page.waitForTimeout(300);
      assert.deepEqual(logs, []);
      assert.deepEqual(await page.evaluate(() => window.__mutations), []);
      assert.equal(await page.locator("main").innerText(), before);
      assert.ok(before.includes("137 of 140"));
      // Positive control: the counter does see a change made after hydration.
      await page.evaluate(() => document.querySelector("main").append(document.createElement("i")));
      await page.waitForTimeout(100);
      assert.deepEqual(await page.evaluate(() => window.__mutations), ["childList:MAIN"]);
      await ctx.close();
    });
  });
}

// ---------- Detectors and the table assertion ----------

/**
 * Runs in the page. Every way text can be cut off or pushed sideways: the document and body widths, the element whose
 * content is wider than its box, and a text range outside the viewport or outside an ancestor that clips. The
 * Lighthouse table's own scroll box (.table-scroll) is a scroll region by design from 480 px up, so it is left out;
 * the stacked table below 480 px, which has no scroll box to speak of, is covered by its being the same box's content.
 */
function overflowReport() {
  const de = document.documentElement;
  const vw = de.clientWidth;
  const skip = (el) => !!el.closest(".table-scroll, .skip"); // .skip is the skip link, parked off screen until it has focus
  const name = (el) => el.tagName.toLowerCase() + (el.className ? "." + String(el.className).split(" ").join(".") : "");
  const out = { docExtra: Math.max(0, de.scrollWidth - de.clientWidth), bodyExtra: Math.max(0, document.body.scrollWidth - de.clientWidth), elements: [], text: [] };
  for (const el of document.body.querySelectorAll("*")) {
    if (el.clientWidth === 0 || skip(el)) continue; // inline boxes report 0
    if (el.scrollWidth > el.clientWidth + 1) out.elements.push(`${name(el)} scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`);
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue.trim() || skip(n.parentElement)) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const rect of range.getClientRects()) {
      if (rect.right > vw + 1 || rect.left < -1) out.text.push(`"${n.nodeValue.trim().slice(0, 24)}" outside the viewport: right ${Math.round(rect.right)} > ${vw}`);
      for (let a = n.parentElement; a && a !== de; a = a.parentElement) {
        if (getComputedStyle(a).overflowX === "visible") continue;
        const box = a.getBoundingClientRect();
        if (rect.right > box.right + 1 || rect.left < box.left - 1) out.text.push(`"${n.nodeValue.trim().slice(0, 24)}" clipped by ${name(a)}: right ${Math.round(rect.right)} > ${Math.round(box.right)}`);
      }
    }
  }
  return out;
}

/** The detectors above plus the behavioural check: can the page really be scrolled sideways? */
async function sidewaysReport(page) {
  const r = await page.evaluate(overflowReport);
  r.scrollX = await page.evaluate(() => {
    window.scrollTo(50, 0);
    const x = window.scrollX;
    window.scrollTo(0, 0);
    return x;
  });
  return r;
}

/** The accessibility snapshot Playwright derives from the DOM for the Lighthouse table (the same in all three engines). */
function expectedTableSnapshot() {
  const rows = pages.map(lighthouseRow);
  return [
    `- table "${CAPTION}":`,
    `  - caption: ${CAPTION}`,
    "  - rowgroup:",
    `    - row "${COLUMNS.join(" ")}":`,
    ...COLUMNS.map((c) => `      - columnheader "${c}"`),
    "  - rowgroup:",
    ...rows.flatMap((r) => [`    - row "${r.join(" ")}":`, `      - rowheader "${r[0]}"`, ...r.slice(1).map((v) => `      - cell "${v}"`)]),
  ].join("\n");
}

/** Throws unless the Lighthouse table still reads as a table: caption, column headers, row headers, cells without label text. */
async function assertTableReads(page) {
  assert.equal(await page.getByRole("table").count(), 1, "one table");
  assert.equal(await page.getByRole("table", { name: CAPTION }).count(), 1, "named by its caption");
  assert.equal((await page.locator("table.perf").ariaSnapshot()).trim(), expectedTableSnapshot());
  // Each value cell has the column header and the row header of its place, from the DOM table model.
  const association = await page.evaluate(() => {
    const head = document.querySelector("table.perf thead tr");
    return [...document.querySelectorAll("table.perf tbody td")].map((td) => [td.cellIndex, head.cells[td.cellIndex]?.tagName + "/" + head.cells[td.cellIndex]?.textContent, td.parentElement.cells[0].tagName]);
  });
  const expected = pages.flatMap(() => COLUMNS.slice(1).map((c, i) => [i + 1, `TH/${c}`, "TH"]));
  assert.deepEqual(association, expected);
}
