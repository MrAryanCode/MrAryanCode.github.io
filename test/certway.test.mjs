// The certway case study page (design.md DS-08, DV-02.1, DV-02.2; D-043 to D-049; P-12 hooks of D-051).
// The expected statements below are written out on purpose, word for word from the signed decisions D-044 to D-049, so a
// change to src/content/case-study.ts that is not a new sign-off fails here.
import { strict as assert } from "node:assert";
import { after, before, test } from "node:test";
import * as study from "../src/content/case-study.ts";
import { COPY_AT_STEP_3_CERTWAY_SUMMARY } from "../src/content/identity.ts";
import { buildAndServe, html, stopAll } from "./helpers.mjs";

before(() => buildAndServe());
after(stopAll);

const SHA = "cb74da823223b7aa837063b30d9b0d4da92f29fe";
const BLOB = `https://github.com/MrAryanCode/certway/blob/${SHA}/`;

// Section heading, then [sentence, path, lines] in the signed order. Backticks mark code, as in the decisions.
const SIGNED = [
  ["What it does", [
    ["The argument parser routes seven commands: issue, renew, list, install, export, rollback and version.", "crates/cli/src/args.rs", "536-561"],
    ["`issue` proves control of a domain with DNS-01 when `--dns` or `--dns-hook` is given, and with HTTP-01 otherwise.", "crates/cli/src/cmd/issue.rs", "276"],
    ["HTTP-01 is answered by a minimal standalone responder that certway binds itself.", "crates/core/src/challenge.rs", "15-24"],
    ["`install` sets up a systemd timer when systemd is present, and a cron job when only cron is.", "crates/cli/src/env.rs", "270-279"],
    ["In a container, `install` schedules nothing and points to an external scheduler or to `renew --watch` instead.", "crates/cli/src/env.rs", "264-269"],
    ["Editing nginx is opt-in: certway changes an nginx configuration only when `--edit-nginx` is given.", "crates/cli/src/cmd/issue.rs", "115-119"],
  ]],
  ["How it is built", [
    ["The code is a Cargo workspace of two crates, `crates/core` and `crates/cli`.", "Cargo.toml", "1-3"],
    ["The core crate holds the ACME protocol, ARI, crypto, CSR, DNS and HTTP modules.", "crates/core/src/lib.rs", "4-16"],
    ["`certway-core` forbids unsafe code and is not allowed to print; only the binary crate writes output.", "crates/core/src/lib.rs", "1-2"],
    ["HTTP is written by hand over a standard-library TCP stream wrapped in rustls, with no HTTP client library and no async runtime.", "crates/core/src/http.rs", "254-266"],
    ["TLS is rustls with the ring crypto provider and default features turned off.", "Cargo.toml", "12"],
    ["The toolchain is pinned to Rust 1.96.0.", "rust-toolchain.toml", "1-3"],
    ["Release builds are tuned for size: opt-level z, fat LTO, one codegen unit, symbols stripped.", "Cargo.toml", "27-31"],
  ]],
  ["Design choices", [
    ["One exclusive lock per data directory, so a renewal timer that overlaps a manual run cannot place two orders and burn two rate-limit slots.", "crates/cli/src/store/lock.rs", "3-8"],
    ["The lock is released by process exit, never by deleting the file, so a crashed run's lock recovers on its own.", "crates/cli/src/store/lock.rs", "10-15"],
    ["`config.json` is written 0600 because hook command lines often carry a credential.", "crates/cli/src/store/cert.rs", "19-26"],
    ["The certificate directory is 0700; nginx still reads the certificates because its master process opens them as root before dropping privileges.", "crates/cli/src/store/cert.rs", "28-36"],
    ["The ARI renewal-information request is a plain unsigned GET, as RFC 9773 section 4.1 requires.", "crates/core/src/ari.rs", "6-9"],
    ["After editing nginx, validation checks stderr as well as the exit code, because a duplicate server_name passes `nginx -t` with exit code 0.", "crates/cli/src/webserver/nginx/transaction.rs", "23-38"],
  ]],
  ["How it is tested", [
    ["`scripts/test.sh` is the test gate: workspace tests, clippy with warnings as errors, a check that no crate appears twice, and a check that aws-lc never enters the dependency tree.", "scripts/test.sh", "25-42"],
    ["The same script runs the SIGTERM test on the x86_64 musl target, the target the signal handling depends on.", "scripts/test.sh", "44-49"],
    ["Unit tests sit beside the code in both crates; one checks the ARI certificate id against RFC 9773's worked example.", "crates/core/src/ari.rs", "323-324"],
    ["Golden tests compare rendered output byte for byte with stored fixtures, using a stubbed backend instead of a network call.", "crates/cli/tests/golden.rs", "3-12"],
    ["End-to-end issuance tests run against Pebble, Let's Encrypt's test ACME server, through `tests/pebble/run.sh`.", "tests/pebble/run.sh", "57-68"],
  ]],
  ["How it is released", [
    ["Pushing a version tag runs the release workflow.", ".github/workflows/release.yml", "41-45"],
    ["Releases are built with cargo-dist 0.32.0.", "dist-workspace.toml", "7"],
    ["Four targets: x86_64 and aarch64 Linux (musl), and x86_64 and aarch64 macOS.", "dist-workspace.toml", "15"],
    ["There is no Windows build, because the code uses Unix-only standard-library APIs unconditionally.", "dist-workspace.toml", "10-12"],
    ["The installer is a shell script, and no self-updater is installed.", "dist-workspace.toml", "13-19"],
    ["Each release publishes its built artifacts to a GitHub Release.", ".github/workflows/release.yml", "279"],
  ]],
  ["Known limits", [
    ["P-256 ECDSA is the only key type: no RSA and no Ed25519.", "README.md", "326"],
    ["PKCS#12 export is not implemented; `--format pkcs12` prints the equivalent openssl command instead.", "README.md", "327"],
    ["There is no Windows release; use WSL or the server itself.", "README.md", "328"],
    ["Cloudflare is the only built-in DNS provider; any other goes through `--dns-hook`.", "README.md", "329"],
    ["A wildcard name needs DNS-01: without `--dns` or `--dns-hook` it is rejected before any network call.", "crates/cli/src/args.rs", "801-806"],
    ["IP identifiers do not work with DNS-01: the order is created first and fails at the challenge step.", "README.md", "331"],
    ["Any other known command name (check, doctor, import, revoke, delete, account, status) answers \"not built yet\" at v1.0.1.", "crates/cli/src/args.rs", "563-565"],
    ["`install` has no `--json` output.", "README.md", "333"],
  ]],
];

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
// Hydration comments and keys are not content.
const page = () => html("projects/certway/index.html").replace(/<!--.*?-->/g, "").replace(/ data-hk="[^"]*"/g, "");
const text = (fragment) => decode(fragment.replace(/<[^>]*>/g, ""));
const mainOf = (h) => h.slice(h.indexOf('<main'), h.indexOf("</main>"));

/** The sections of the reading body as `{heading, items: [{statement, href, label}]}`, read from the HTML. */
function sections(h) {
  const body = mainOf(h);
  return [...body.matchAll(/<section class="section">(.*?)<\/section>/gs)].map(([, s]) => ({
    heading: text(s.match(/<h2>(.*?)<\/h2>/s)[1]),
    items: [...s.matchAll(/<li class="ref" data-statement>(.*?)<\/li>/gs)].map(([, li]) => ({
      statement: decode(li.match(/<p class="ref-statement">(.*?)<\/p>/s)[1].replace(/<code>(.*?)<\/code>/g, "`$1`")),
      links: [...li.matchAll(/<a [^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gs)].map(([, href, inner]) => ({ href: decode(href), label: text(inner) })),
    })),
  }));
}

test("header band: h1, summary, pin line and the two links", () => {
  const h = page();
  const band = h.match(/<div class="band"[^>]*>(.*?)<\/div>/s)[1];
  assert.deepEqual([...h.matchAll(/<h1[^>]*>(.*?)<\/h1>/g)].map((m) => text(m[1])), ["certway"]);
  assert.equal(text(band.match(/<p class="lead">(.*?)<\/p>/s)[1]), COPY_AT_STEP_3_CERTWAY_SUMMARY);
  assert.equal(text(band.match(/<p class="pin">(.*?)<\/p>/s)[1]).replace(/\s+/g, " ").trim(), "This page describes certway v1.0.1. Every link below points to the code at commit cb74da8.");
  assert.ok(band.includes(`<p class="pin">This page describes certway v1.0.1. Every link below points to the code at commit <a href="https://github.com/MrAryanCode/certway/commit/${SHA}">cb74da8</a>.</p>`));
  const links = [...band.matchAll(/<li><a href="([^"]*)">(.*?)<\/a><\/li>/gs)].map((m) => [text(m[2]), m[1]]);
  assert.deepEqual(links, [
    ["Source on GitHub", "https://github.com/MrAryanCode/certway"],
    ["Release v1.0.1", "https://github.com/MrAryanCode/certway/releases/tag/v1.0.1"],
  ]);
});

test("sections are in the DS-08 order and each holds the signed statements word for word", () => {
  const found = sections(page());
  assert.deepEqual(found.map((s) => s.heading), SIGNED.map(([heading]) => heading));
  for (const [i, [heading, items]] of SIGNED.entries()) {
    assert.deepEqual(found[i].items.map((it) => it.statement), items.map(([sentence]) => sentence), heading);
  }
});

test("each statement has exactly one permalink at the pinned commit, with its path and lines as the link text", () => {
  const found = sections(page());
  for (const [i, [heading, items]] of SIGNED.entries()) {
    for (const [j, [, path, lines]] of items.entries()) {
      const { links } = found[i].items[j];
      const [from, to] = lines.split("-");
      assert.equal(links.length, 1, `${heading} #${j + 1}`);
      assert.equal(links[0].href, `${BLOB}${path}#L${from}${to ? `-L${to}` : ""}`);
      assert.equal(links[0].label, `${path}:${lines}`);
    }
  }
  const labels = found.flatMap((s) => s.items.map((it) => it.links[0].label));
  assert.equal(new Set(labels).size, labels.length, "every link text is unique on the page");
});

test("the constants, the data and the page agree", () => {
  assert.equal(study.sha, SHA);
  assert.equal(study.version, "v1.0.1");
  assert.equal(study.releaseUrl, "https://github.com/MrAryanCode/certway/releases/tag/v1.0.1");
  const total = SIGNED.reduce((n, [, items]) => n + items.length, 0);
  assert.equal(study.statements.length, total);
  assert.equal(sections(page()).reduce((n, s) => n + s.items.length, 0), total);
  assert.ok(study.statements.every((s) => s.permalink.startsWith(BLOB)));
});

test("no section heading stands without a statement, and the probes add no heading", () => {
  const body = mainOf(page());
  assert.equal([...body.matchAll(/<h2[ >]/g)].length, SIGNED.length, "only the six signed h2 exist");
  for (const s of sections(page())) assert.ok(s.items.length > 0, `${s.heading} has a statement`);
  assert.equal([...body.matchAll(/<h[3-6][ >]/g)].length, 0);
  // The probe mounts stay (CR2-B4): their hooks are still in the markup.
  assert.ok(body.includes("data-gpu-status"));
});

test("markup hooks of D-051: field kind 7 on the band, 5 on the body, scan on each h2 row", () => {
  const h = page();
  assert.equal([...h.matchAll(/<div class="band" data-field-kind="7">/g)].length, 1);
  assert.equal([...h.matchAll(/<div class="reading" data-field-kind="5">/g)].length, 1);
  const rows = [...h.matchAll(/<div class="heading-row" data-fx="scan">(.*?)<\/div>/gs)];
  assert.equal(rows.length, SIGNED.length);
  rows.forEach((m, i) => assert.equal(text(m[1].match(/<h2>(.*?)<\/h2>/)[1]), SIGNED[i][0]));
  // The footer's field kind is Layout's (T-010); the case study body is not the footer.
  assert.equal([...h.matchAll(/data-field-kind="/g)].length, 3);
});

test("the page makes no live read: it has no data-fact element", () => {
  assert.ok(!page().includes("data-fact"));
});
