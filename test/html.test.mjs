// Static checks on the built HTML: every route has its content, its own head tags and no stray build tokens.
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { buildAndServe, dist, html, root, stopAll } from "./helpers.mjs";

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

test("the Geist OFL licence ships with the fonts, byte for byte (D-059)", () => {
  const shipped = readFileSync(dist("fonts", "LICENSE.txt"));
  assert.ok(shipped.length > 0);
  assert.ok(shipped.equals(readFileSync(join(root, "node_modules", "@fontsource", "geist", "LICENSE"))));
});

// Last on purpose: it stops the shared helpers and rebuilds dist/ from a fixture whose description closes the script.
test("#site-data never holds a raw '<' and still parses back to the same facts (D-059)", async () => {
  const hostile = "x</script><b>y & z";
  const dir = mkdtempSync(join(tmpdir(), "site-fixtures-"));
  try {
    cpSync(join(root, "test", "fixtures"), dir, { recursive: true });
    const file = join(dir, "repo-certway.json");
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), description: hostile }));
    await stopAll();
    await buildAndServe({ fixturesDir: dir });
    for (const f of ["index.html", "projects/certway/index.html", "report/index.html", "404.html"]) {
      const h = html(f);
      assert.ok(!h.includes("</script><b>"), `${f} holds the closing tag raw`);
      const block = /<script type="application\/json" id="site-data">(.*?)<\/script>/s.exec(h);
      assert.ok(block, `${f} has no #site-data block`);
      assert.ok(!block[1].includes("<"), `${f} #site-data has a raw '<'`);
      assert.equal(JSON.parse(block[1]).facts.repo.description, hostile, `${f} description`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
