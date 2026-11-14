// Static checks on the built HTML: every route has its content, its own head tags and no stray build tokens.
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { contact } from "../src/content/contact.ts";
import * as identity from "../src/content/identity.ts";
import * as skills from "../src/content/skills.ts";
import * as working from "../src/content/working.ts";
import { routes } from "../src/routes.ts";
import { TEST_SHA, buildAndServe, dist, html, root, stopAll } from "./helpers.mjs";

before(() => buildAndServe());
after(stopAll);

const pages = [
  { file: "index.html", url: "https://mraryancode.github.io/", h1: "Aryan Miri", title: "Aryan Miri | Full-stack developer", og: "home" },
  { file: "projects/certway/index.html", url: "https://mraryancode.github.io/projects/certway/", h1: "certway( case study)?", title: "certway case study | Aryan Miri", og: "certway" },
  { file: "report/index.html", url: "https://mraryancode.github.io/report/", h1: "Engineering report", title: "Engineering report | Aryan Miri", og: "report" },
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

// The signed 404 copy (design.md DS-10, D-032), written out here on purpose like the route copy below.
const COPY_AT_STEP_3_404_H1 = "404";
const COPY_AT_STEP_3_404_LEAD = "This page does not exist. These are the pages on this site:";
const COPY_AT_STEP_3_404_LINKS = [
  { label: "Home page", href: "/" },
  { label: "certway case study", href: "/projects/certway/" },
  { label: "Engineering report", href: "/report/" },
];
const allFiles = ["index.html", "projects/certway/index.html", "report/index.html", "404.html"];
// Solid writes data-hk keys and <!--$--> markers into the prerendered HTML; the checks below read the page without them.
const plain = (file) => html(file).replace(/<!--.*?-->/gs, "").replace(/ data-hk="[^"]*"/g, "");

test("404.html: content, no canonical", () => {
  const h = plain("404.html");
  assert.match(h, new RegExp(`<h1[^>]*>${COPY_AT_STEP_3_404_H1}</h1>`));
  assert.ok(h.includes(COPY_AT_STEP_3_404_LEAD), "the lead line");
  assert.ok(h.includes("<title>404: Page not found | Aryan Miri</title>"));
  assert.ok(!h.includes('rel="canonical"'));
});

// The list is the site's pages in route-table order without the 404 route itself (D-032).
const listHrefs = (h) => {
  const list = /<ul class="page-list"[^>]*>(.*?)<\/ul>/s.exec(h)[1];
  return [...list.matchAll(/<a\s[^>]*href="([^"]*)"/g)].map((m) => m[1]);
};

test("404.html: the link list is COPY_AT_STEP_3_404_LINKS and its hrefs equal the non-404 paths of src/routes.ts, in order", () => {
  const h = plain("404.html");
  const want = routes.filter((r) => r.id !== "notfound").map((r) => r.path);
  assert.deepEqual(listHrefs(h), want);
  assert.deepEqual(COPY_AT_STEP_3_404_LINKS.map((l) => l.href), want);
  const labels = [...(/<ul class="page-list"[^>]*>(.*?)<\/ul>/s.exec(h)[1]).matchAll(/<span class="row-label">([^<]*)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(labels, COPY_AT_STEP_3_404_LINKS.map((l) => l.label));
});

test("404.html: root-absolute hrefs in main and no aria-current anywhere", () => {
  const h = plain("404.html");
  const main = /<main[^>]*>(.*)<\/main>/s.exec(h)[1];
  for (const [, href] of main.matchAll(/<a\s[^>]*href="([^"]*)"/g)) assert.ok(href.startsWith("/"), `href ${href} is not root-absolute`);
  assert.ok(!h.includes("aria-current"), "no link points at the 404 page itself");
});

test("aria-current=page: the identity link on home and the footer Engineering report link on /report/, nothing on the other pages", () => {
  const current = (file) => [...plain(file).matchAll(/<a\s[^>]*aria-current="page"[^>]*>/g)].map((m) => m[0]);
  const home = current("index.html");
  assert.equal(home.length, 1, "home has exactly one aria-current");
  assert.match(home[0], /href="\/"/);
  assert.ok(/<header[^>]*>.*?<\/header>/s.exec(plain("index.html"))[0].includes(home[0]), "home: it is in the header");
  const report = current("report/index.html");
  assert.equal(report.length, 1, "report has exactly one aria-current");
  assert.match(report[0], /href="\/report\/"/);
  assert.ok(/<footer[^>]*>.*?<\/footer>/s.exec(plain("report/index.html"))[0].includes(report[0]), "report: it is in the footer");
  assert.deepEqual(current("projects/certway/index.html"), []);
  assert.deepEqual(current("404.html"), []);
});

test("D-051 hooks: data-field-kind 0 on the 404 hero and 4 on every footer, data-fx arrow on each 404 row, progress on every page", () => {
  const notFound = plain("404.html");
  assert.equal((notFound.match(/<div class="not-found" data-field-kind="0">/g) ?? []).length, 1, "404 hero kind 0");
  const rows = notFound.match(/<a class="row"[^>]*>.*?<\/a>/gs) ?? [];
  assert.equal(rows.length, COPY_AT_STEP_3_404_LINKS.length);
  for (const row of rows) assert.match(row, /<svg class="row-arrow" data-fx="arrow"/, "each row has an arrow");
  assert.equal((notFound.match(/data-fx="arrow"/g) ?? []).length, rows.length, "only the rows carry an arrow");
  for (const f of allFiles) {
    const h = plain(f);
    assert.match(/<footer[^>]*>/.exec(h)?.[0] ?? "", /data-field-kind="4"/, `${f} footer kind 4`);
    assert.equal((h.match(/data-fx="progress"/g) ?? []).length, 1, `${f} progress bar element`);
  }
});

test("the shared chrome: skip link first, identity link to /, Message me, the footer contact group and no Built line without a build", () => {
  for (const f of allFiles) {
    const h = plain(f);
    const body = /<body[^>]*>(.*)<\/body>/s.exec(h)[1];
    assert.match(body, /^\s*<div id="root"[^>]*><a class="skip" href="#main">Skip to content<\/a>/, `${f} skip link first`);
    const header = /<header[^>]*>(.*?)<\/header>/s.exec(h)[1];
    assert.match(header, /<a href="\/"[^>]*>.*Aryan Miri.*MrAryanCode.*<\/a>/s, `${f} identity link`);
    assert.match(header, /<a href="https:\/\/t\.me\/aryan_61_04"[^>]*>Message me<\/a>/, `${f} Message me`);
    const footer = /<footer[^>]*>(.*?)<\/footer>/s.exec(h)[1];
    for (const href of ["mailto:mraryanmiri@gmail.com", "https://t.me/aryan_61_04", "https://github.com/MrAryanCode", "https://t.me/MrAryanCode", "https://github.com/MrAryanCode/MrAryanCode.github.io", "/report/"]) {
      assert.ok(footer.includes(`href="${href}"`), `${f} footer lacks ${href}`);
    }
    assert.ok(footer.includes("© 2026 Aryan Miri. Text and images are not licensed for reuse."), `${f} rights line`);
    assert.ok(!footer.includes("Built "), `${f} has a Built line with build null`);
  }
});

// Home page helpers: the page's `main` without Solid's markers, a page's opening tags, and one tag's attributes.
const homeMain = () => /<main[^>]*>(.*)<\/main>/s.exec(plain("index.html"))[1];
const openTags = (h, name) => [...h.matchAll(new RegExp(`<${name}\\b[^>]*>`, "g"))].map((m) => m[0]);
const hasAttr = (tag, name, value) => (value === undefined ? new RegExp(`\\s${name}(?=[\\s=>/])`).test(tag) : tag.includes(` ${name}="${value}"`));
const dataFx = (tag) => (/\sdata-fx="([^"]*)"/.exec(tag)?.[1] ?? "").split(" ").filter(Boolean);
const stripTags = (h) => h.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
// The one element that carries data-fact="<name>": its opening tag and its inner HTML.
const factElement = (h, name) => {
  const m = new RegExp(`(<(\\w+)\\b[^>]*\\sdata-fact="${name}"[^>]*>)(.*?)</\\2>`, "s").exec(h);
  return m ? { tag: m[1], inner: m[3] } : null;
};

test("the certway card: each fact on its own [data-fact] element, the as-of line, the hidden failure note", () => {
  const h = plain("index.html");
  const tag = factElement(h, "tag");
  assert.equal(tag.inner, "v1.0.1");
  assert.ok(hasAttr(tag.tag, "href", "https://github.com/MrAryanCode/certway/releases/tag/v1.0.1"), "the tag links to the release");
  assert.equal(factElement(h, "license").inner, "MIT");
  assert.equal(factElement(h, "stars").inner, "3");
  assert.equal(factElement(h, "pushedAt").inner, "2026-11-07");
  for (const name of ["tag", "license", "stars", "pushedAt"]) {
    assert.equal((h.match(new RegExp(`data-fact="${name}"`, "g")) ?? []).length, 1, `exactly one ${name} fact`);
  }
  const asOf = [...h.matchAll(/<time\b[^>]*\sdata-as-of[^>]*>(.*?)<\/time>/g)];
  assert.equal(asOf.length, 1, "exactly one time[data-as-of]");
  assert.match(asOf[0][0], /datetime="\d{4}-\d\d-\d\dT[\d:.]+Z"/);
  assert.match(asOf[0][1], /^\d{4}-\d\d-\d\d \d\d:\d\d UTC$/);
  const sentence = stripTags(/<p[^>]*>([^<]*<time\b[^>]*\sdata-as-of[^>]*>.*?<\/time>[^<]*)<\/p>/s.exec(h)[1]);
  assert.match(sentence, /^Facts from the GitHub API as of \d{4}-\d\d-\d\d \d\d:\d\d UTC, when this page was built\.$/, "the build wording of the as-of sentence");
  const note = /<p\b[^>]*\sdata-live-fail[^>]*>(.*?)<\/p>/s.exec(h);
  assert.ok(hasAttr(note[0], "hidden") && hasAttr(note[0], "role", "status"), "the note is hidden and a status message");
  assert.equal(stripTags(note[1]), "Live facts could not be read. Showing the facts from when this page was built.");
  assert.ok(h.indexOf("data-live-fail") < h.indexOf("data-as-of"), "the note is directly above the as-of line");
  assert.deepEqual([...h.matchAll(/<dt class="tile-label">([^<]*)<\/dt>/g)].map((m) => m[1]), ["Latest release", "License", "Stars", "Last push"]);
  assert.ok(!h.includes("data-read-at"), "the old read-time stamp is gone");
});

test("home: main holds the four sections in order, each labelled by its own heading, with one h1 and the signed outline", () => {
  const main = homeMain();
  assert.equal(main.replace(/<section\b.*?<\/section>/gs, "").trim(), "", "main holds nothing but its four sections");
  const sections = openTags(main, "section");
  assert.equal(sections.length, 4);
  assert.deepEqual(sections.map((t) => /\sid="([^"]*)"/.exec(t)?.[1] ?? null), [null, null, "skills", "working"]);
  assert.deepEqual(sections.map((t) => /\sdata-field-kind="([^"]*)"/.exec(t)?.[1]), ["0", "1", "2", "3"], "field kinds hero, work, skills, working");
  for (const t of sections) {
    const label = /\saria-labelledby="([^"]*)"/.exec(t)?.[1];
    assert.ok(label && main.includes(` id="${label}"`), `${t} is labelled by an element that exists`);
  }
  const outline = [...main.matchAll(/<h([1-3])\b[^>]*>(.*?)<\/h\1>/gs)].map((m) => `h${m[1]} ${stripTags(m[2])}`);
  assert.deepEqual(outline, ["h1 Aryan Miri", "h2 Work", "h3 certway", "h3 This site", "h2 Skills", "h3 Shipped in public", "h3 Also worked with", "h2 Working with me"]);
  assert.equal((plain("index.html").match(/<h1\b/g) ?? []).length, 1, "one h1 on the page");
  const work = openTags(main, "h2").find((t) => hasAttr(t, "id", "work"));
  assert.ok(work && hasAttr(work, "tabindex", "-1"), "the Work h2 is the target of See the work");
  const articles = openTags(main, "article");
  assert.deepEqual(articles.map((t) => /\sid="([^"]*)"/.exec(t)?.[1]), ["certway", "this-site"], "both cards are articles, certway first");
  const at = (id) => main.indexOf(` id="${id}"`);
  assert.ok(at("certway") > 0 && at("certway") < at("this-site") && at("this-site") < at("skills") && at("skills") < at("working"), "certway, this site, skills, working, in that order");
});

test("home: the Telegram links (first screen and #working), the email link, See the work, and the cards' links", () => {
  const main = homeMain();
  const [hero, , , working] = [...main.matchAll(/<section\b.*?<\/section>/gs)].map((m) => m[0]);
  const telegram = 'href="https://t.me/aryan_61_04"';
  assert.equal(hero.split(telegram).length - 1, 1, "exactly one Telegram link on the first screen");
  assert.ok(!hero.includes("mailto:"), "no mailto link on the first screen");
  assert.match(hero, /<a\b[^>]*href="https:\/\/t\.me\/aryan_61_04"[^>]*>Message me on Telegram<\/a>/);
  assert.match(hero, /<a\b[^>]*href="#work"[^>]*>See the work<\/a>/);
  assert.ok(working.includes(telegram) && working.includes('href="mailto:mraryanmiri@gmail.com"'), "#working links to Telegram and to email");
  assert.ok(working.includes(">mraryanmiri@gmail.com</a>"));
  const site = /<article\b[^>]*id="this-site".*?<\/article>/s.exec(main)[0];
  assert.match(site, /<a\b[^>]*href="\/report\/"[^>]*>How this site is built<\/a>/);
  assert.match(site, /<a\b[^>]*href="https:\/\/github\.com\/MrAryanCode\/MrAryanCode\.github\.io"[^>]*>Source on GitHub<\/a>/);
  assert.deepEqual([...site.matchAll(/<li>(?:<svg.*?<\/svg>)?([^<]*)<\/li>/g)].map((m) => m[1]), identity.COPY_AT_STEP_3_SITE_CHECKS.map((c) => c.text), "the card lists the six checks, in order");
  const certway = /<article\b[^>]*id="certway".*?<\/article>/s.exec(main)[0];
  assert.match(certway, /<a\b[^>]*href="\/projects\/certway\/"[^>]*>Read the case study<\/a>/);
  assert.match(certway, /<a\b[^>]*href="https:\/\/github\.com\/MrAryanCode\/certway"[^>]*>Source on GitHub<\/a>/);
});

test("home: the skills panels show the shipped items, each skill joined by commas, and the also-worked-with line", () => {
  const section = /<section\b[^>]*id="skills".*?<\/section>/s.exec(plain("index.html"))[0];
  const items = [...(/<ul>(.*?)<\/ul>/s.exec(section)[1]).matchAll(/<li>(.*?)<\/li>/gs)].map((m) => stripTags(m[1]));
  assert.deepEqual(items, [
    "certway: Rust",
    "This site: TypeScript, SolidJS, Vite, Node.js, Playwright, HTML and CSS, GitHub Actions, Web Animations API, Web Workers, WebGPU",
    "GitHub profile: Python, GitHub Actions",
  ]);
  assert.ok(section.includes("<p>Go · React, Svelte · .NET · Flutter</p>"));
});

// design.md DS-04 and DS-05 (D-026, D-027): a check or a skill that the page names must still exist in the repository.
test("every COPY_AT_STEP_3_SITE_CHECKS marker occurs in its file, and so does every marker of the This site skills", () => {
  const site = skills.COPY_AT_STEP_3_SKILLS_SHIPPED.find((item) => item.label === "This site");
  assert.ok(site, "the shipped list has a This site item");
  assert.equal(identity.COPY_AT_STEP_3_SITE_CHECKS.length, 6);
  assert.ok(site.skills.length > 0);
  for (const item of identity.COPY_AT_STEP_3_SITE_CHECKS) {
    assert.ok(readFileSync(join(root, item.file), "utf8").includes(item.marker), `check "${item.text}": marker ${JSON.stringify(item.marker)} is absent from ${item.file}`);
  }
  for (const skill of site.skills) {
    assert.ok(readFileSync(join(root, skill.file), "utf8").includes(skill.marker), `skill "${skill.text}": marker ${JSON.stringify(skill.marker)} is absent from ${skill.file}`);
  }
});

test("D-051 hooks on home: field kinds, tilt and parallax, magnet, scan, tiles, ticks, and plain fact values", () => {
  const main = homeMain();
  const articles = openTags(main, "article");
  assert.equal(articles.length, 2);
  for (const t of articles) assert.deepEqual(dataFx(t), ["tilt", "parallax"], `${t} tilts and moves with the scroll`);
  const panels = openTags(main, "div").filter((t) => /\sclass="panel"/.test(t));
  assert.equal(panels.length, 2, "two skills panels");
  for (const t of panels) assert.deepEqual(dataFx(t), ["tilt"], "a skills panel tilts and has no parallax");
  const fx = (token) => [...main.matchAll(/<\w+\b[^>]*\sdata-fx="[^"]*"[^>]*>/g)].map((m) => m[0]).filter((t) => dataFx(t).includes(token));
  assert.equal(fx("tilt").length, 4);
  assert.equal(fx("parallax").length, 2);
  const magnets = fx("magnet");
  assert.equal(magnets.length, 2, "the two primary pill buttons");
  for (const t of magnets) assert.ok(/^<a\b/.test(t) && /\sclass="btn btn-primary"/.test(t) && hasAttr(t, "href", "https://t.me/aryan_61_04"), `${t} is a primary Telegram link`);
  assert.equal([...main.matchAll(/<div class="heading-row" data-fx="scan"><span class="index" aria-hidden="true"><\/span><h2\b/g)].length, 3, "a scan row for Work, Skills and Working with me");
  assert.equal(fx("scan").length, 3, "scan sits on nothing else");
  const tiles = /<dl\b[^>]*\sdata-fx="tiles"[^>]*>(.*?)<\/dl>/s.exec(main);
  assert.ok(tiles && fx("tiles").length === 1, "one facts box carries tiles");
  for (const name of ["tag", "license", "stars", "pushedAt"]) assert.ok(tiles[1].includes(`data-fact="${name}"`), `${name} is inside the facts box`);
  const ticks = /<ul\b[^>]*\sdata-fx="ticks"[^>]*>(.*?)<\/ul>/s.exec(main);
  assert.ok(ticks && fx("ticks").length === 1, "one checks list carries ticks");
  const rows = ticks[1].match(/<li>.*?<\/li>/gs) ?? [];
  assert.equal(rows.length, 6);
  for (const row of rows) assert.match(row, /^<li><svg\b[^>]*aria-hidden="true"/, "each check starts with its tick");
  // The fact values are plain text: no roll markup and no child element (the roll overlay is added later, D-053).
  for (const name of ["tag", "license", "stars", "pushedAt"]) {
    assert.ok(!factElement(plain("index.html"), name).inner.includes("<"), `data-fact ${name} holds plain text only`);
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
  assert.ok(files.some((n) => /^input\.worker-.*\.js$/.test(n)));
  assert.ok(files.some((n) => /^layer-.*\.js$/.test(n)));
  for (const f of ["index.html", "projects/certway/index.html", "report/index.html", "404.html"]) {
    assert.ok(!/layer-|input\.worker-/.test(html(f)), `${f} references a lazy chunk`);
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

// The signed step 3 copy (design.md DS-00 and DS-11), written out here on purpose: the test must fail when a string in
// src/ changes, so it never reads its expected values from the modules it checks.
const COPY_AT_STEP_3_ROUTE_COPY = {
  home: {
    title: "Aryan Miri | Full-stack developer",
    description: "Full-stack developer who builds web products end to end and ships them with tests and CI. Open to remote full-stack roles, full-time or contract.",
    ogAlt: 'Card with the text "Aryan Miri" and "Full-stack developer".',
  },
  certway: {
    title: "certway case study | Aryan Miri",
    description: "A case study of certway, written in Rust: one static binary that gets and renews TLS certificates from Let's Encrypt on Linux and macOS. How it is built, tested and released, pinned to v1.0.1.",
    ogAlt: 'Card with the text "certway case study" and "Aryan Miri, Full-stack developer".',
  },
  report: {
    title: "Engineering report | Aryan Miri",
    description: "How this site is built: the checks every deploy must pass, with the numbers from the build you are reading.",
    ogAlt: 'Card with the text "Engineering report" and "Aryan Miri, Full-stack developer".',
  },
  notfound: { title: "404: Page not found | Aryan Miri", description: "This page does not exist." },
};
const COPY_AT_STEP_3_CARD_LINES = {
  home: ["Aryan Miri", "Full-stack developer"],
  certway: ["certway case study", "Aryan Miri · Full-stack developer"],
  report: ["Engineering report", "Aryan Miri · Full-stack developer"],
};
const COPY_AT_STEP_3_REPORT_LEAD = "How this site is built: the checks every deploy must pass, with the numbers from the build you are reading.";
const COPY_AT_STEP_3_AVAILABILITY = ["Open to remote full-stack roles, full-time or contract.", "Based in Tehran (UTC+03:30)."];
const GITHUB = "https://github.com/MrAryanCode/";

test("route titles, descriptions, ogAlt and ogCard equal the signed copy; 404 has title and description only", () => {
  assert.deepEqual(routes.map((r) => r.id), ["home", "certway", "report", "notfound"]);
  for (const r of routes) {
    const want = COPY_AT_STEP_3_ROUTE_COPY[r.id];
    assert.equal(r.title, want.title, `${r.id} title`);
    assert.equal(r.description, want.description, `${r.id} description`);
    if (r.id === "notfound") {
      assert.equal(r.ogAlt, "", "404 has no ogAlt");
      assert.equal(r.ogCard, undefined, "404 has no ogCard");
    } else {
      assert.equal(r.ogAlt, want.ogAlt, `${r.id} ogAlt`);
      assert.deepEqual(r.ogCard, COPY_AT_STEP_3_CARD_LINES[r.id], `${r.id} ogCard`);
    }
  }
  assert.equal(COPY_AT_STEP_3_ROUTE_COPY.report.description, COPY_AT_STEP_3_REPORT_LEAD);
  assert.ok(COPY_AT_STEP_3_ROUTE_COPY.home.description.includes(COPY_AT_STEP_3_AVAILABILITY[0]), "home description holds the availability sentence word for word");
});

test("the content modules equal the signed copy (identity, skills, working, contact)", () => {
  assert.equal(identity.COPY_AT_STEP_3_HOME_H1, "Aryan Miri");
  assert.equal(identity.COPY_AT_STEP_3_ROLE_LINE, "Full-stack developer. I build web products end to end and ship them with tests and CI.");
  assert.match(identity.COPY_AT_STEP_3_ROLE_LINE, /full-stack/i);
  assert.deepEqual(identity.COPY_AT_STEP_3_AVAILABILITY, COPY_AT_STEP_3_AVAILABILITY);
  assert.equal(identity.COPY_AT_STEP_3_CERTWAY_SUMMARY, "HTTPS in one command. One static binary that gets and renews TLS certificates from Let's Encrypt on Linux and macOS.");
  assert.equal(identity.COPY_AT_STEP_3_SITE_SUMMARY, "The site you are reading. It goes live only when every one of these checks passes:");
  assert.deepEqual(identity.COPY_AT_STEP_3_SITE_CHECKS.map((c) => c.text), [
    "Unit tests",
    "Acceptance tests in Chromium, Firefox and WebKit",
    "Accessibility check on every page (axe-core)",
    "Performance check (Lighthouse)",
    "HTML validation (Nu Html Checker)",
    "Link check (lychee)",
  ]);

  assert.equal(skills.COPY_AT_STEP_3_SKILLS_HEADING, "Skills");
  assert.equal(skills.COPY_AT_STEP_3_SKILLS_SHIPPED_HEADING, "Shipped in public");
  assert.equal(skills.COPY_AT_STEP_3_SKILLS_ALSO_HEADING, "Also worked with");
  assert.deepEqual(
    skills.COPY_AT_STEP_3_SKILLS_SHIPPED.map((i) => ({ label: i.label, url: i.url, skills: i.skills.map((s) => (typeof s === "string" ? s : s.text)) })),
    [
      { label: "certway", url: `${GITHUB}certway`, skills: ["Rust"] },
      { label: "This site", url: `${GITHUB}MrAryanCode.github.io`, skills: ["TypeScript", "SolidJS", "Vite", "Node.js", "Playwright", "HTML and CSS", "GitHub Actions", "Web Animations API", "Web Workers", "WebGPU"] },
      { label: "GitHub profile", url: `${GITHUB}MrAryanCode`, skills: ["Python", "GitHub Actions"] },
    ],
  );
  for (const s of skills.COPY_AT_STEP_3_SKILLS_SHIPPED[1].skills) assert.ok(s.file && s.marker, `${s.text} has a file and a marker`);
  for (const c of identity.COPY_AT_STEP_3_SITE_CHECKS) assert.ok(c.file && c.marker, `${c.text} has a file and a marker`);
  assert.equal(skills.COPY_AT_STEP_3_SKILLS_ALSO, "Go · React, Svelte · .NET · Flutter");

  assert.equal(working.COPY_AT_STEP_3_WORKING_HEADING, "Working with me");
  assert.equal(working.COPY_AT_STEP_3_WORKING_START, "Telegram is the fastest way to reach me. Send the role and what your team is building.");
  assert.deepEqual(working.COPY_AT_STEP_3_WORKING_LINKS, {
    telegram: { label: "Message me on Telegram", url: "https://t.me/aryan_61_04" },
    email: { label: "Email", text: "mraryanmiri@gmail.com", url: "mailto:mraryanmiri@gmail.com" },
  });

  assert.deepEqual(contact, {
    email: "mraryanmiri@gmail.com",
    emailUrl: "mailto:mraryanmiri@gmail.com",
    telegramUrl: "https://t.me/aryan_61_04",
    telegramHandle: "@aryan_61_04",
    githubUrl: "https://github.com/MrAryanCode",
    githubHandle: "@MrAryanCode",
    channelUrl: "https://t.me/MrAryanCode",
    channelHandle: "@MrAryanCode",
    cv: null,
  });
});

test("no content string is empty, and no CV value or link exists (D-013, P-02.4)", () => {
  const strings = [];
  const walk = (v) => {
    if (typeof v === "string") strings.push(v);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  for (const m of [identity, skills, working, contact]) walk(m);
  assert.ok(strings.length > 40, "the walk found the content strings");
  for (const s of strings) assert.ok(s.trim().length > 0, "an empty content string");
  assert.equal(contact.cv, null);
  for (const [k, v] of Object.entries(contact)) assert.ok(k === "cv" || !/cv/i.test(String(v)), `${k} looks like a CV value`);
  for (const f of ["index.html", "projects/certway/index.html", "report/index.html", "404.html"]) {
    for (const [, href] of html(f).matchAll(/<a\s[^>]*href="([^"]*)"/g)) assert.ok(!/cv/i.test(href), `${f} links to ${href}`);
  }
});

// A build with a commit: the footer's last line is `Built <date> from <sha7>` with the 7 characters linking to the commit (D-023).
// It rebuilds dist/ with GITHUB_SHA set, so it runs after every test above that needs the local build without a stamp.
// The build time is the real start time of that build (scripts/build.mjs stamps it), so the test reads it from #site-data.
test("a build with a commit: the footer stamp reads Built <date> from <sha7> and links to the commit, on every page", async () => {
  await stopAll();
  await buildAndServe({ githubSha: TEST_SHA });
  for (const f of allFiles) {
    const h = plain(f);
    const data = JSON.parse(/<script type="application\/json" id="site-data">(.*?)<\/script>/s.exec(h)[1]);
    assert.deepEqual(Object.keys(data.build).sort(), ["builtAt", "sha"], `${f} build keys`);
    assert.equal(data.build.sha, TEST_SHA);
    assert.match(data.build.builtAt, /^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
    const footer = /<footer[^>]*>(.*?)<\/footer>/s.exec(h)[1];
    const stamp = `Built ${data.build.builtAt.slice(0, 10)} from <a href="https://github.com/MrAryanCode/MrAryanCode.github.io/commit/${TEST_SHA}">${TEST_SHA.slice(0, 7)}</a>`;
    assert.ok(footer.includes(stamp), `${f} footer lacks the stamp: ${footer}`);
    assert.ok(footer.trimEnd().endsWith(`${stamp}</p>`), `${f}: the stamp is the footer's last line`);
    assert.equal((h.match(/Built /g) ?? []).length, 1, `${f}: exactly one Built line`);
  }
});

// This test and the one after it come last on purpose: each stops the shared helpers and rebuilds dist/ from a changed fixture.
// This one uses a description that closes the script.
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

// design.md DS-03, Empty: a repository without a license has no License row. A fixture whose license is null must build,
// and the other facts stay. It rebuilds dist/ like the test above, so it comes last too.
test("a fixture whose license is null builds and the home page has no License row", async () => {
  const dir = mkdtempSync(join(tmpdir(), "site-fixtures-"));
  try {
    cpSync(join(root, "test", "fixtures"), dir, { recursive: true });
    const file = join(dir, "repo-certway.json");
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), license: null }));
    await stopAll();
    await buildAndServe({ fixturesDir: dir });
    const h = plain("index.html");
    assert.ok(!h.includes('data-fact="license"'), "no license fact element");
    assert.ok(!h.includes(">License<"), "no License label");
    assert.deepEqual([...h.matchAll(/<dt class="tile-label">([^<]*)<\/dt>/g)].map((m) => m[1]), ["Latest release", "Stars", "Last push"]);
    for (const name of ["tag", "stars", "pushedAt"]) assert.ok(factElement(h, name), `${name} is still shown`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
