// Static checks on the built HTML: every route has its content, its own head tags and no stray build tokens.
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { after, before, test } from "node:test";
import { buildAndServe, dist, html, stopAll } from "./helpers.mjs";

before(() => buildAndServe());
after(stopAll);

const pages = [
  { file: "index.html", url: "https://mraryancode.github.io/", h1: "Aryan Miri", title: "Aryan Miri | MrAryanCode", og: "home" },
  { file: "projects/certway/index.html", url: "https://mraryancode.github.io/projects/certway/", h1: "certway case study", title: "certway case study | MrAryanCode", og: "certway" },
  { file: "report/index.html", url: "https://mraryancode.github.io/report/", h1: "Engineering report", title: "Engineering report | MrAryanCode", og: "report" },
];

for (const p of pages) {
  test(`${p.file}: content and head`, () => {
    const h = html(p.file);
    assert.match(h, new RegExp(`<h1[^>]*>${p.h1}</h1>`));
    assert.ok(h.includes(`<title>${p.title}</title>`));
    assert.ok(h.includes(`<link rel="canonical" href="${p.url}">`));
    assert.ok(h.includes(`<meta property="og:url" content="${p.url}">`));
    assert.ok(h.includes(`<meta property="og:image" content="https://mraryancode.github.io/og/${p.og}.png">`));
    assert.ok(h.includes(`<meta name="twitter:card" content="summary_large_image">`));
    assert.equal((h.match(/<title>/g) ?? []).length, 1);
    assert.ok(!h.includes("<!--ssr-"), "no template token left");
  });
}

test("404.html: content, no canonical", () => {
  const h = html("404.html");
  assert.match(h, /<h1[^>]*>Page not found<\/h1>/);
  assert.ok(!h.includes('rel="canonical"'));
});

test("facts are in the prerendered HTML and stamped with a read time", () => {
  for (const f of ["index.html", "projects/certway/index.html"]) {
    const h = html(f);
    assert.ok(h.includes(">v1.0.1</a>") && h.includes("<dd>MIT</dd>") && h.includes("<dd>3</dd>"));
    assert.match(h, /<time data-read-at datetime="\d{4}-\d\d-\d\dT[\d:.]+Z">\d{4}-\d\d-\d\d \d\d:\d\d UTC<\/time>/);
  }
});

test("a local build has no build stamp: #site-data carries build null and the footer has no stamp line", () => {
  for (const f of ["index.html", "projects/certway/index.html", "report/index.html", "404.html"]) {
    const h = html(f);
    const data = JSON.parse(/<script type="application\/json" id="site-data">(.*?)<\/script>/s.exec(h)[1]);
    assert.equal(data.build, null, `${f} build`);
    assert.deepEqual(Object.keys(data).sort(), ["build", "facts", "route"], `${f} site-data keys`);
    assert.ok(!h.includes("Built "), `${f} has a build stamp line`);
  }
});

test("the client JavaScript contains no token name and no Authorization header", () => {
  for (const f of readdirSync(dist("assets")).filter((n) => n.endsWith(".js"))) {
    const js = html(`assets/${f}`);
    for (const needle of ["SITE_GITHUB", "Authorization"]) assert.ok(!js.includes(needle), `${f} contains ${needle}`);
  }
});

test("worker and GPU code are separate chunks that no page references", () => {
  const files = readdirSync(dist("assets"));
  assert.ok(files.some((n) => /^checksum\.worker-.*\.js$/.test(n)));
  assert.ok(files.some((n) => /^layer-.*\.js$/.test(n)));
  for (const f of ["index.html", "projects/certway/index.html", "report/index.html", "404.html"]) {
    assert.ok(!/layer-|checksum\.worker-/.test(html(f)), `${f} references a lazy chunk`);
  }
});

test("fonts: exactly two preloads with crossorigin, files that exist, @font-face and fallback faces", () => {
  const files = readdirSync(dist("assets"));
  for (const f of ["index.html", "projects/certway/index.html", "report/index.html", "404.html"]) {
    const links = html(f).match(/<link rel="preload"[^>]*>/g) ?? [];
    assert.equal(links.length, 2, `${f} preload count`);
    for (const l of links) {
      assert.match(l, /as="font" type="font\/woff2" href="\/assets\/[^"]+\.woff2" crossorigin>/);
      assert.ok(files.includes(/href="\/assets\/([^"]+)"/.exec(l)[1]), `${f}: ${l} has no file`);
    }
  }
  const css = files.filter((n) => n.endsWith(".css")).map((n) => html(`assets/${n}`)).join("\n");
  for (const family of ["Geist", "Geist Mono", "Geist fallback", "Geist Mono fallback"]) {
    assert.ok(new RegExp(`@font-face\\s*\\{[^}]*font-family:\\s*["']?${family}["']?[;}]`).test(css), `no @font-face for ${family}`);
  }
});
