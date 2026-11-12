import { FontaineTransform } from "fontaine";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// One Solid compiler setup, two environments. `ssr: true` makes vite-plugin-solid emit
// hydratable DOM code for the client environment and SSR code for the server environment.
export default defineConfig({
  base: "/", // user site at the domain root; assets must resolve from any URL depth, including 404.html
  plugins: [
    solid({ ssr: true }),
    // Metric-matched fallback faces for the two page fonts. Object form only: the array form would
    // apply the sans metrics to Geist Mono as well.
    FontaineTransform.vite({
      fallbacks: { Geist: ["Segoe UI", "Helvetica Neue", "Arial"], "Geist Mono": ["Courier New"] },
    }),
  ],
  build: { target: "es2022" },
  worker: { format: "es" }, // module workers: new Worker(new URL(...), { type: "module" })
  environments: {
    client: {
      build: { outDir: ".stage/client", emptyOutDir: true },
    },
    ssr: {
      build: {
        outDir: ".stage/server",
        emptyOutDir: true,
        rollupOptions: { input: "src/entry-server.tsx" },
      },
    },
  },
  builder: {}, // enables the multi-environment builder (createBuilder / vite build --app)
});
