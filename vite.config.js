import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));

// `base: "./"` keeps every emitted asset reference relative, so the build can be
// served from a GitHub Pages project subpath without a rebuild.
//
// Two entries. `index.html` is the landing page and `editor.html` is the
// editor, so the two never share a bundle and the landing page cannot pull the
// background-removal model into its graph. The editor's own `?tool=` deep links
// moved with it; `src/landing/main-landing.js` forwards anything that arrives
// at the root with a query string, which is what those links look like.
export default defineConfig({
  base: "./",
  plugins: [svelte()],
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        landing: here("index.html"),
        editor: here("editor.html"),
      },
    },
    // The background-removal model loader is large; keep it out of the main chunk.
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
  },
});
