// Checks the README's claims that a test can see: its list of site checks and the npm scripts it names.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

// COPY_AT_STEP_3_SITE_CHECKS, design.md DS-00 (signed in D-034). A copy lives here until the site holds the list itself.
const SITE_CHECKS = [
  "Unit tests",
  "Acceptance tests in Chromium, Firefox and WebKit",
  "Accessibility check on every page (axe-core)",
  "Performance check (Lighthouse)",
  "HTML validation (Nu Html Checker)",
  "Link check (lychee)",
];

describe("README.md", () => {
  test("lists the site checks in the order of COPY_AT_STEP_3_SITE_CHECKS", () => {
    const lines = read("README.md").split(/\r?\n/);
    const lead = lines.indexOf("The site goes live only when every one of these checks passes:");
    assert.notEqual(lead, -1, "the sentence that introduces the check list is missing");
    const items = [];
    for (const line of lines.slice(lead + 1)) {
      if (line === "") {
        if (items.length > 0) break;
        continue;
      }
      items.push(line);
    }
    assert.deepEqual(items, SITE_CHECKS.map((check) => `- ${check}`));
  });

  test("names only npm run scripts that package.json defines", () => {
    const scripts = JSON.parse(read("package.json")).scripts;
    const named = [...read("README.md").matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]);
    assert.ok(named.length > 0, "the README names no npm run script");
    for (const name of named) {
      assert.ok(Object.hasOwn(scripts, name), `the README names npm run ${name}, which package.json lacks`);
    }
  });
});
