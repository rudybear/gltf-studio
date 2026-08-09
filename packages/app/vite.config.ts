import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// BASE_PATH: configurable Vite `base` so a future GitHub Pages deploy (a
// project site served from `/<repo>/`) doesn't need a code change — leave
// unset for local dev/preview (defaults to "/").
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
  server: {
    port: 5173
  },
  preview: {
    port: 4173
  }
});
