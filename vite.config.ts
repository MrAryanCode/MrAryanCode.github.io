import { FontaineTransform } from "fontaine";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { variantFor } from "./scripts/variant.mjs";

// One Solid compiler setup, two environments. `ssr: true` makes vite-plugin-solid emit
// hydratable DOM code for the client environment and SSR code for the server environment.
// The function form receives the Vite mode: "production" for a plain build, "test" for the hook variant.
export default defineConfig(({ mode }) => {
  const v = variantFor(mode);
  return {
    base: "/", // user site at the domain root; assets must resolve from any URL depth, including 404.html
    plugins: [
      solid({ ssr: true }),
      // Metric-matched fallback faces for the two page fonts. Object form only: the array form would
      // apply the sans metrics to Geist Mono as well.
      FontaineTransform.vite({
        fallbacks: { Geist: ["Segoe UI", "Helvetica Neue", "Arial"], "Geist Mono": ["Courier New"] },
      }),
    ],
    // Replaced at build time in every environment (client, ssr, worker). false removes the guarded import.
    define: { __SEEK_HOOK__: JSON.stringify(v.test) },
    build: { target: "es2022" },
    worker: { format: "es" }, // module workers: new Worker(new URL(...), { type: "module" })
    environments: {
      client: {
        build: { outDir: `${v.stage}/client`, emptyOutDir: true },
      },
      ssr: {
        build: {
          outDir: `${v.stage}/server`,
          emptyOutDir: true,
          rollupOptions: { input: "src/entry-server.tsx" },
        },
      },
    },
    builder: {}, // enables the multi-environment builder (createBuilder / vite build --app)
  };
});
