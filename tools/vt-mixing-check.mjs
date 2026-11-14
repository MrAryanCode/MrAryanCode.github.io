// Checks rules 1 to 3 of cross-document-view-transitions-mixing against the head script and the style that the built
// site carries (dist/index.html), in Chromium. Run it after `npm run build`, and after any change to the head script:
//   node tools/vt-mixing-check.mjs
// It serves a two-card site (home, /projects/certway/, /report/) whose pages use the built script and style, then runs
// part 1 (mixing: ungated and gated, at pagereveal and at 300 ms) and part 2 (back-forward cache restores). It exits 1
// when a result differs from what the rules say.
// HTML=<file> reads another built index.html. CHROMIUM_PATH=<browser path> (or CHANNEL, EXE) picks the browser.
// NAIVE=1 removes the name cleanup from the script and skips part 1 (control run: part 2 must then fail).
// NOOPTIN=1 removes the script's insertion of the opt-in (control run: no page opts in, so part 1 must fail).
// UNGATED=1 starts the restore-time transition in part 2 without waiting for window.vtSettled() (control run: must fail).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const htmlFile = process.env.HTML || fileURLToPath(new URL("../dist/index.html", import.meta.url));
const built = fs.readFileSync(htmlFile, "utf8");
const scripts = [...built.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((s) => s.includes("vtSettled"));
// The opt-in is inserted by the head script itself (D-061), so the served pages get it only from the script. The
// ::view-transition-* rules live in the site stylesheet, which the built page links. The check keeps only those top-level
// rules (the rest of the sheet carries font URLs and layout this check does not serve).
function topLevelRules(text) {
  const rules = [];
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) { rules.push(text.slice(start, i + 1)); start = i + 1; }
    else if (text[i] === ";" && depth === 0) start = i + 1;
  }
  return rules;
}
const sheets = [...built.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
const sheetText = sheets.map((h) => fs.readFileSync(path.join(path.dirname(htmlFile), h), "utf8")).filter((s) => s.includes("::view-transition-group"));
if (scripts.length !== 1 || sheetText.length !== 1) throw new Error(`expected one head script and one stylesheet with the view-transition rules in the built page, found ${scripts.length} and ${sheetText.length}`);
if (sheetText[0].includes("@view-transition")) throw new Error("the built stylesheet carries the opt-in, which the head script must insert (D-061)");
if (!scripts[0].includes("@view-transition { navigation: auto; }") || !scripts[0].includes("prefers-reduced-motion: reduce) { @view-transition { navigation: none; }")) throw new Error("the head script does not insert the opt-in and its reduced-motion form");
const css = topLevelRules(sheetText[0]).filter((r) => r.includes("view-transition") || r.includes("vt-lift")).join("\n");
if (!css.includes("::view-transition-group(case-card)") || !css.includes("::view-transition-image-pair(case-card)") || !css.includes("@keyframes vt-lift")) throw new Error("the built stylesheet lost the view-transition rules");
let js = scripts[0];
if (process.env.NOOPTIN) js = js.replace("document.head.appendChild(optIn);", "");
if (process.env.NAIVE) js = js.replace("vt.finished.then(done, done);", "").replaceAll("clearNames();", "");
const head = `<script>${js}</script>`;

const style = "<style>body{margin:0}.panel-card{display:block;width:360px;height:290px;margin:140px 24px 0;background:#ddd}.band{width:1120px;height:390px;margin:24px;background:#bcd}</style>";
const page = (body) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>${head}${style}</head><body>${body}</body></html>`;
const cards = [["/projects/certway/", "certway"], ["/report/", "this site"]].map(([href, text]) => `<article class="panel-card"><a href="${href}">${text}</a></article>`).join("");
const routes = { "/": ["text/html", page(cards)] };
for (const path of ["/projects/certway/", "/report/"]) routes[path] = ["text/html", page(`<div class="band"></div><p id="val">0</p>`)];
const server = http.createServer((req, res) => {
  const r = routes[req.url.split("?")[0]];
  if (!r) { res.writeHead(req.url === "/favicon.ico" ? 204 : 404); res.end(); return; }
  res.writeHead(200, { "content-type": r[0] + "; charset=utf-8", "cache-control": "max-age=60" });
  res.end(r[1]);
}).listen(0, "127.0.0.1");
await new Promise((r) => server.on("listening", r));
const base = "http://127.0.0.1:" + server.address().port;

const executablePath = process.env.CHROMIUM_PATH || process.env.EXE;
const browser = await chromium.launch({
  ignoreDefaultArgs: ["--disable-back-forward-cache"],
  ...(process.env.CHANNEL ? { channel: process.env.CHANNEL } : executablePath ? { executablePath } : {}),
});
console.log("browser", browser.version());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const expect = (ok, what) => { if (!ok) failures.push(what); };

// Part 1: a same-document transition started while the cross-document one is active.
// The init script plays the part of app code; 'gated' waits for window.vtSettled() first.
async function mixing(mode, when) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(({ mode, when }) => {
    const r = window.__r = { X: "-", S: "-", val: "0" };
    const t = () => Math.round(performance.now());
    function start() {
      const go = () => {
        r.Sstart = t();
        const S = document.startViewTransition(() => { document.getElementById("val").textContent = "1"; });
        S.ready.then(() => { r.S = "ready"; }, (e) => { r.S = "ready rejected: " + e.message; });
        S.finished.then(() => { r.Sfinished = t(); });
      };
      mode === "gated" ? window.vtSettled().then(go) : go();
    }
    addEventListener("pagereveal", (e) => {
      const X = e.viewTransition;
      if (!X) return;
      X.ready.then(() => { r.X = "ready"; }, (er) => { r.X = "ready rejected: " + er.message; });
      X.finished.then(() => { r.Xfinished = t(); });
      if (when === "pagereveal") start(); else setTimeout(start, when);
    });
  }, { mode, when });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "/", { waitUntil: "load" });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.click('a[href="/projects/certway/"]');
  await page.waitForURL("**/projects/certway/");
  await page.waitForTimeout(2500);
  const r = await page.evaluate(() => ({ ...window.__r, val: document.getElementById("val").textContent }));
  const after = r.Sstart >= r.Xfinished ? "S started after X finished" : "S started while X was active";
  console.log(`${mode.padEnd(8)} at ${String(when).padEnd(9)} X: ${r.X} | S: ${r.S} | val=${r.val} | ${after} | pageerrors: ${errors.length}`);
  const label = `rule 1, ${mode} at ${when}`;
  expect(r.X === "ready", `${label}: X ready (${r.X})`);
  expect(r.val === "1", `${label}: the update ran (val=${r.val})`);
  expect(errors.length === 0, `${label}: pageerrors ${JSON.stringify(errors)}`);
  if (mode === "gated") {
    expect(r.S === "ready", `${label}: S ready (${r.S})`);
    expect(after === "S started after X finished", `${label}: ${after}`);
  } else {
    expect(r.S === "ready rejected: Transition was skipped. Navigation transition active", `${label}: S skipped (${r.S})`);
    expect(after === "S started while X was active", `${label}: ${after}`);
  }
  await ctx.close();
}
if (!process.env.NAIVE) {
  await mixing("ungated", "pagereveal");
  await mixing("ungated", 300);
  await mixing("gated", "pagereveal");
  await mixing("gated", 300);
}

// Part 2: names after back-forward cache restores. Logs the names present at each pageshow.
async function bfcache() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript((UNGATED) => {
    window.__log = [];
    const names = () => [...document.querySelectorAll(".panel-card, .band")].filter((e) => getComputedStyle(e).viewTransitionName !== "none").map((e) => e.className);
    // Registered after the head script's own listeners, as app code is.
    addEventListener("DOMContentLoaded", () => addEventListener("pageshow", (e) => {
      if (!e.persisted) return;
      __log.push("pageshow names=" + JSON.stringify(names()));
      const go = () => {
        const S = document.startViewTransition(() => { __log.push("same-document update callback ran"); });
        S.finished.then(() => __log.push("same-document finished"), () => __log.push("same-document finished rejected"));
      };
      UNGATED ? go() : window.vtSettled().then(go);
    }));
    addEventListener("pagereveal", (e) => { __log.push("pagereveal " + (e.viewTransition ? "transition" : "null") + " names=" + JSON.stringify(names())); });
  }, !!process.env.UNGATED);
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  const quiet = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.goto(base + "/", { waitUntil: "load" });
  await quiet();
  await page.evaluate(() => { window.__marker = "home"; });
  await page.click('a[href="/projects/certway/"]');
  await page.waitForURL("**/projects/certway/");
  await sleep(1200);
  await page.evaluate(() => { window.__marker = "certway"; });
  await page.goBack({ waitUntil: "commit" }); await sleep(1200);
  const home = await page.evaluate(() => ({ restored: window.__marker === "home", log: window.__log }));
  await page.goForward({ waitUntil: "commit" }); await sleep(2000);
  const certway = await page.evaluate(() => ({ restored: window.__marker === "certway", log: window.__log }));
  await page.goBack({ waitUntil: "commit" }); await sleep(1200);
  await page.click('a[href="/report/"]');
  await page.waitForURL("**/report/");
  await sleep(1200);
  const report = await page.evaluate(() => window.__log.slice(-1)[0] || "no pagereveal log");
  const tail = (log) => log.slice(log.findLastIndex((x) => x.startsWith("pageshow"))).join(" ; ");
  if (!home.restored || !certway.restored) {
    console.log("not restored from the back-forward cache this time, retrying");
    await ctx.close();
    return false;
  }
  console.log("home, restored by back        :", tail(home.log));
  console.log("certway, restored by forward  :", tail(certway.log));
  console.log("report, clicked after restores:", report, "| console errors:", JSON.stringify(errors));
  // Rule 2: no name is left at pagereveal, so the next card click still transitions and logs no duplicate-name error.
  for (const [label, log] of [["home", home.log], ["certway", certway.log]]) {
    expect(/pagereveal \w+ names=\[\]/.test(tail(log)), `rule 2, ${label} restore: a name is present at pagereveal (${tail(log)})`);
  }
  expect(report === "pagereveal transition names=[]", `rule 2, click after the restores: ${report}`);
  expect(errors.length === 0, `rule 2, console errors ${JSON.stringify(errors)}`);
  // Rule 3: the same-document transition started in pageshow (persisted) waits for the gate and its update runs.
  for (const [label, log] of [["home", home.log], ["certway", certway.log]]) {
    expect(tail(log).includes("same-document update callback ran") && tail(log).includes("same-document finished"), `rule 3, ${label} restore: the update did not run (${tail(log)})`);
  }
  await ctx.close();
  return true;
}
let restored = false;
for (let i = 0; i < 5 && !restored; i++) restored = await bfcache();
expect(restored, "part 2: no run was restored from the back-forward cache in 5 tries");
await browser.close();
server.close();

if (failures.length) {
  console.log("FAIL");
  for (const f of failures) console.log(" -", f);
  process.exitCode = 1;
} else console.log("ok: rules 1 to 3 hold");
