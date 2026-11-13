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

test("facts are in the prerendered HTML and stamped with a read time", () => {
  // The certway page's own facts line goes with DS-08 (T-012); T-012 asserts that page in test/certway.test.mjs.
  for (const f of ["index.html"]) {
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
      { label: "This site", url: `${GITHUB}MrAryanCode.github.io`, skills: ["TypeScript", "SolidJS", "Vite", "Node.js", "Playwright", "HTML and CSS", "GitHub Actions"] },
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
