// The single place that maps a Vite mode to the build's folders. Imported by vite.config.ts and scripts/build.mjs.
// "test" is the only mode that gets the test-only seek hook and its own folders; every other mode (production,
// development) uses the deploy layout. scripts/build.mjs rejects every mode except production and test.
export function variantFor(mode) {
  const test = mode === "test";
  return { test, stage: test ? ".stage-test" : ".stage", dist: test ? "dist-test" : "dist" };
}
