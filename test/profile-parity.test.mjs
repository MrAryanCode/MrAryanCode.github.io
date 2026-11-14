// AT-12 (node): the profile README and the site agree (plan P-10, P-06.7, D-027).
// The first test runs tools/check-profile-parity.mjs on the real README named by PROFILE_README and the real
// src/content; it is skipped, with its reason, when the variable is unset (CI has no clone of that repository).
// The other tests run the same tool on two small README texts and a small site folder written to a temp folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { root } from "./helpers.mjs";

const tool = join(root, "tools", "check-profile-parity.mjs");
const run = (...args) => spawnSync(process.execPath, [tool, ...args], { cwd: root, encoding: "utf8" });

const readmeWith = (stack) => `I'm Aryan Miri, a full-stack developer based in Tehran.

**Stack:** ${stack}

## Working with me

- Open to remote full-stack roles, full-time or contract.
- Based in Tehran (UTC+03:30).
- Email: [mraryanmiri@gmail.com](mailto:mraryanmiri@gmail.com) · Telegram: [@aryan_61_04](https://t.me/aryan_61_04)
`;

test("AT-12 profile README parity with the real README", {
  skip: process.env.PROFILE_README ? false : "PROFILE_README is not set (the profile repository is not cloned here)",
}, () => {
  const r = run(process.env.PROFILE_README);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const fact of ["name", "availability", "time zone", "email", "telegram"]) {
    assert.match(r.stdout, new RegExp(`^${fact}: same$`, "m"));
  }
  assert.match(r.stdout, /^stack: covered$/m);
});

test("check-profile-parity: covered stack exits 0, one extra name is missing and exits 1", () => {
  const dir = mkdtempSync(join(tmpdir(), "parity-"));
  try {
    const site = join(dir, "content");
    mkdirSync(site);
    writeFileSync(join(site, "identity.ts"), 'export const identity = { name: "Aryan Miri", availability: "Open to remote full-stack roles, full-time or contract. Based in Tehran (UTC+03:30)." };\n');
    writeFileSync(join(site, "contact.ts"), 'export const contact = { email: "mailto:mraryanmiri@gmail.com", telegram: "https://t.me/aryan_61_04", cv: null };\n');
    writeFileSync(join(site, "skills.ts"), 'export const shipped = [{ label: "certway", url: "https://github.com/MrAryanCode/certway", skills: ["Rust", "TypeScript", { text: "SolidJS" }] }];\nexport const also = "Go · React, Svelte";\n');

    const covered = join(dir, "covered.md");
    writeFileSync(covered, readmeWith("TypeScript, Rust · SolidJS, Go · React, Svelte"));
    const ok = run(covered, site);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /^stack: covered$/m);
    for (const fact of ["name", "availability", "time zone", "email", "telegram"]) assert.match(ok.stdout, new RegExp(`^${fact}: same$`, "m"));

    const extra = join(dir, "extra.md");
    writeFileSync(extra, readmeWith("TypeScript, Rust · SolidJS, Go · React, Svelte, Elixir"));
    const bad = run(extra, site);
    assert.equal(bad.status, 1, bad.stdout + bad.stderr);
    assert.match(bad.stdout, /^stack: missing Elixir$/m);
    assert.doesNotMatch(bad.stdout, /stack: covered/);
    assert.doesNotMatch(bad.stdout, /stack: missing (TypeScript|Rust|SolidJS|Go|React|Svelte)$/m);

    // A label or a URL of skills.ts is not a skill name: a README stack naming a repository label is missing.
    const label = join(dir, "label.md");
    writeFileSync(label, readmeWith("TypeScript, certway"));
    const labelled = run(label, site);
    assert.equal(labelled.status, 1, labelled.stdout + labelled.stderr);
    assert.match(labelled.stdout, /^stack: missing certway$/m);

    // A shared fact that differs is printed `differs` and also exits 1.
    const moved = join(dir, "moved.md");
    writeFileSync(moved, readmeWith("TypeScript").replace("Based in Tehran (UTC+03:30).", "Based in Tehran (Iran time zone)."));
    const diff = run(moved, site);
    assert.equal(diff.status, 1, diff.stdout + diff.stderr);
    assert.match(diff.stdout, /^time zone: differs/m);
    assert.match(diff.stdout, /^name: same$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
