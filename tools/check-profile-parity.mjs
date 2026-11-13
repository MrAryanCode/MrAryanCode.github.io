// Compares the GitHub profile README with the site's content modules (plan P-06.7, AT-12, D-027).
// Usage: node tools/check-profile-parity.mjs <profile README path> [site content dir]
// The content dir defaults to src/content. It reads local files only.
//
// Shared facts, each printed as `<fact>: same` or `<fact>: differs ...`:
//   name, availability, time zone, email, telegram.
// A fact is `same` when the README's value appears word for word in a string of the site's content modules
// (identity.ts, contact.ts, skills.ts, working.ts). The modules are read as data: every string in every export
// counts, so the check does not depend on how a module names its fields.
// The stack is printed as `stack: covered` or as one `stack: missing <name>` line per missing name: the README's
// `**Stack:**` line is split on `,` and `·`, and each trimmed name must be a skill name of src/content/skills.ts.
// The site may name more than the README (subset rule, D-027).
// Exit 1 on any `differs` or `missing`, exit 0 otherwise.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const [readmeArg, contentArg] = process.argv.slice(2);
if (!readmeArg) {
  console.error("usage: node tools/check-profile-parity.mjs <profile README path> [site content dir]");
  process.exit(2);
}
const readme = readFileSync(resolve(readmeArg), "utf8");
const contentDir = resolve(contentArg ?? join(root, "src", "content"));

/** Every string inside a value, however deeply it is nested in arrays and objects. */
function strings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => strings(v, out));
  return out;
}

async function moduleStrings(name) {
  const file = join(contentDir, name);
  if (!existsSync(file)) return null;
  return strings(await import(pathToFileURL(file).href));
}

const skillsStrings = await moduleStrings("skills.ts");
if (skillsStrings === null) {
  console.error(`no skills.ts in ${contentDir}`);
  process.exit(2);
}
const siteStrings = [...skillsStrings];
for (const name of ["identity.ts", "contact.ts", "working.ts"]) siteStrings.push(...((await moduleStrings(name)) ?? []));

// Skill names: the strings of skills.ts, and every name of a string that lists names (`Go · React, Svelte`).
const skillNames = new Set(skillsStrings.flatMap((s) => [s.trim(), ...s.split(/[,·]/).map((n) => n.trim())]));

const first = (re) => readme.match(re)?.[1]?.trim() ?? null;
const facts = [
  ["name", first(/I'm ([^,.]+)/)],
  ["availability", first(/^[-*]\s+(Open to .+)$/m)],
  ["time zone", first(/^[-*]\s+(Based in .+)$/m)],
  ["email", first(/\(mailto:([^)\s]+)\)/)],
  ["telegram", first(/Telegram:\s*\[[^\]]*\]\((https:\/\/t\.me\/[^)\s]+)\)/)],
];

let failed = false;
for (const [label, value] of facts) {
  if (value === null) {
    console.log(`${label}: differs (the README has no ${label})`);
    failed = true;
  } else if (siteStrings.some((s) => s.includes(value))) {
    console.log(`${label}: same`);
  } else {
    console.log(`${label}: differs (the README says ${JSON.stringify(value)}, the site has no such text)`);
    failed = true;
  }
}

const stackLine = first(/^\*\*Stack:\*\*\s*(.+)$/m);
if (stackLine === null) {
  console.log("stack: missing (the README has no **Stack:** line)");
  failed = true;
} else {
  const names = stackLine.split(/[,·]/).map((n) => n.trim()).filter(Boolean);
  const missing = names.filter((n) => !skillNames.has(n));
  if (missing.length === 0) console.log("stack: covered");
  else {
    for (const n of missing) console.log(`stack: missing ${n}`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
