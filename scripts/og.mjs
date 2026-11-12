// Open Graph PNGs at build time: satori lays the card out as SVG (text becomes paths), sharp rasterises it.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import satori from "satori";
import sharp from "sharp";

// Resolve fonts from the project root (the build script runs with the root as working directory).
const require = createRequire(join(process.cwd(), "package.json"));
const font = (pkg, file) => readFileSync(require.resolve(`${pkg}/files/${file}`));
// Static WOFF, one entry per weight (satori draws a variable font at its default instance only).
// Geist 400 first: satori uses the first font for a family that is not registered.
const fonts = [
  { name: "Geist", data: font("@fontsource/geist", "geist-latin-400-normal.woff"), weight: 400, style: "normal" },
  { name: "Geist", data: font("@fontsource/geist", "geist-latin-500-normal.woff"), weight: 500, style: "normal" },
  { name: "Geist", data: font("@fontsource/geist", "geist-latin-600-normal.woff"), weight: 600, style: "normal" },
  { name: "Geist Mono", data: font("@fontsource/geist-mono", "geist-mono-latin-400-normal.woff"), weight: 400, style: "normal" },
  { name: "Geist Mono", data: font("@fontsource/geist-mono", "geist-mono-latin-500-normal.woff"), weight: 500, style: "normal" },
  { name: "Geist Mono", data: font("@fontsource/geist-mono", "geist-mono-latin-700-normal.woff"), weight: 700, style: "normal" },
];

export async function ogSvg(title, line, footer) {
  return satori(
    {
      type: "div",
      props: {
        style: { width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center",
          padding: "80px", background: "#0d1117", color: "#e6edf3", fontFamily: "Geist" },
        children: [
          { type: "div", props: { style: { fontSize: 72, fontWeight: 600, letterSpacing: "-0.03em" }, children: title } },
          { type: "div", props: { style: { fontSize: 36, marginTop: 24, color: "#9198a1" }, children: line } },
          { type: "div", props: { style: { fontSize: 28, marginTop: 48, fontFamily: "Geist Mono", fontWeight: 500 }, children: footer } },
        ],
      },
    },
    { width: 1200, height: 630, fonts },
  );
}

export async function ogPng(title, line, footer) {
  return sharp(Buffer.from(await ogSvg(title, line, footer))).png().toBuffer();
}

/**
 * One card per route id: [title, line, footer]. The text is static and never uses the GitHub facts
 * (P-04): a card is cached by link previews, so it must not go stale. Only characters in the latin
 * subset of the Geist files may appear (satori draws any other character as a box and does not throw).
 */
export function ogCards() {
  return {
    home: ["Aryan Miri", "Full-stack developer, remote", "mraryancode.github.io"],
    certway: ["certway", "Case study", "mraryancode.github.io"],
    report: ["Engineering report", "How this site is prerendered and tested", "mraryancode.github.io"],
  };
}
