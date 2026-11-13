// Usage: node scripts/check-markers.mjs <absent|present> <dir>... [--markers <file>]
// absent : exit 1 if any "absent" marker appears in any file NAME or file CONTENT (including .map files) under any <dir>.
//          Image and font files are matched by name only (see BINARY).
// present: exit 1 if any "present" marker appears in NO file name or content under <dir> (the positive control).
// Exit 0: clean. Exit 1: a leak (absent) or a missing marker (present). Exit 2: bad arguments, a missing or empty
// <dir>, or an unreadable or invalid markers file. A missing folder therefore never passes silently.
// Markers live in scripts/seek-markers.json: { "absent": [...], "present": [...] }; each entry is
// { "text": "..." } (plain substring) or { "regex": "..." } (JavaScript RegExp source, no flags).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Images and fonts are compared by file NAME only: a 3-byte marker such as fx= can occur by chance in compressed bytes.
const BINARY = /[.](png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|pdf|wasm|mp4|webm)$/i;

const fail2 = (msg) => {
  console.error(`[check] FAILED: ${msg}`);
  process.exit(2);
};

const args = process.argv.slice(2);
let markersFile = join(dirname(fileURLToPath(import.meta.url)), "seek-markers.json");
const mi = args.indexOf("--markers");
if (mi > -1) markersFile = args.splice(mi, 2)[1] ?? "";
const [mode, ...dirs] = args;
if (!["absent", "present"].includes(mode) || dirs.length === 0) {
  fail2("usage: node scripts/check-markers.mjs <absent|present> <dir>... [--markers <file>]");
}

let list;
try {
  list = JSON.parse(readFileSync(markersFile, "utf8"))[mode];
} catch (err) {
  fail2(`cannot read markers file ${markersFile}: ${err.message}`);
}
if (!Array.isArray(list) || list.length === 0) fail2(`${markersFile} has no "${mode}" markers`);
const markers = list.map((m) => {
  if (typeof m?.text === "string" && m.text) return { label: m.text, test: (s) => s.includes(m.text) };
  if (typeof m?.regex === "string" && m.regex) {
    try {
      const re = new RegExp(m.regex);
      return { label: `/${m.regex}/`, test: (s) => re.test(s) };
    } catch (err) {
      fail2(`bad regex ${m.regex}: ${err.message}`);
    }
  }
  return fail2(`bad marker entry ${JSON.stringify(m)}`);
});

let bad = 0;
for (const dir of dirs) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) fail2(`${dir} is not a directory`);
  const files = [];
  (function walk(d) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else files.push(p);
    }
  })(dir);
  if (files.length === 0) fail2(`${dir} contains no files`);

  const hits = new Map(markers.map((m) => [m.label, []]));
  for (const f of files) {
    const rel = relative(dir, f).split("\\").join("/");
    const text = BINARY.test(f) ? "" : readFileSync(f).toString("latin1");
    for (const m of markers) if (m.test(rel) || m.test(text)) hits.get(m.label).push(rel);
  }
  let here = 0;
  for (const m of markers) {
    const h = hits.get(m.label);
    if (mode === "absent") {
      for (const rel of h) {
        console.error(`[check] LEAK marker ${m.label} in ${dir}/${rel}`);
        here++;
      }
    } else if (h.length === 0) {
      console.error(`[check] MISSING marker ${m.label} in every file of ${dir}`);
      here++;
    } else {
      console.log(`[check] present ${m.label} in ${h.join(", ")}`);
    }
  }
  console.log(`[check] ${mode} ${dir}: ${files.length} files, ${markers.length} markers, failures=${here}`);
  bad += here;
}
process.exit(bad ? 1 : 0);
