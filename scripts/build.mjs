// Build orchestrator: fetch -> bundle (client + server) -> prerender every route -> OG images -> rename to dist.
// Fail-closed: the GitHub fetch runs first, everything else is written to .stage/, and dist/ appears only
// as the very last step. Any error exits 1 and leaves no dist/.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createBuilder } from "vite";
import { fetchFacts } from "./github.mjs";
import { ogCards, ogPng } from "./og.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
process.chdir(root);
const stage = join(root, ".stage");
const dist = join(root, "dist");

// The build stamp (D-023): the commit and the start time, read once so every page carries the same pair.
// A build without GITHUB_SHA (a local build) has no stamp.
function readBuildStamp() {
  const sha = process.env.GITHUB_SHA;
  if (!sha) return null;
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`GITHUB_SHA is not a full 40-character commit: ${sha}`);
  return { sha, builtAt: new Date().toISOString() };
}

async function main() {
  rmSync(dist, { recursive: true, force: true }); // a failed build must not leave an older dist/ to deploy
  rmSync(stage, { recursive: true, force: true });

  const build = readBuildStamp();
  const facts = await fetchFacts(); // throws on any problem: nothing has been written yet

  const builder = await createBuilder({ root });
  await builder.buildApp(); // client -> .stage/client, ssr -> .stage/server

  const server = await import(pathToFileURL(join(stage, "server", "entry-server.js")).href);
  const out = join(stage, "client");
  const template = readFileSync(join(out, "index.html"), "utf8");
  for (const token of ["<!--ssr-head-->", "<!--ssr-app-->", "<!--ssr-data-->"]) {
    if (!template.includes(token)) throw new Error(`template token missing in built index.html: ${token}`);
  }

  for (const route of server.routes) {
    const page = server.renderPage(route.id, facts, build);
    // Replacer functions: page.app / page.data may contain "$" sequences.
    const html = template
      .replace("<!--ssr-head-->", () => page.head)
      .replace("<!--ssr-app-->", () => page.app)
      .replace("<!--ssr-data-->", () => page.data);
    if (html.includes("<!--ssr-")) throw new Error(`unreplaced token in ${route.file}`);
    const file = join(out, route.file);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, html);
    console.log(`[prerender] ${route.path} -> ${route.file} (${html.length} B)`);
  }

  mkdirSync(join(out, "og"), { recursive: true });
  for (const [slug, [title, line, footer]] of Object.entries(ogCards())) {
    writeFileSync(join(out, "og", `${slug}.png`), await ogPng(title, line, footer));
    console.log(`[og] og/${slug}.png`);
  }

  if (!existsSync(join(out, "404.html"))) throw new Error("404.html was not written");
  renameSync(out, dist); // the only write to dist/
  rmSync(stage, { recursive: true, force: true });
  console.log("[build] dist/ written");
}

try {
  await main();
} catch (err) {
  console.error(`[build] FAILED: ${err?.message ?? err}`);
  rmSync(stage, { recursive: true, force: true });
  rmSync(dist, { recursive: true, force: true });
  process.exitCode = 1;
}
