import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// BASE_PATH: configurable Vite `base`. The editor always lives one level
// below whatever site root it's served from — `/app/` locally (dev server
// and `vite preview`, matching this repo's own e2e config) and
// `/<repo>/app/` once deployed as a GitHub Pages PROJECT site, where a
// hand-written landing page (see `/site/`) occupies the actual root and
// the deploy workflow (`.github/workflows/deploy.yml`) sets BASE_PATH to
// the deeper path at build time — no code change needed for that move.
export default defineConfig({
  base: process.env.BASE_PATH ?? "/app/",
  plugins: [react()],
  server: {
    port: 5173
  },
  preview: {
    port: 4173
  }
});
