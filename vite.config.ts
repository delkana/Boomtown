import { defineConfig } from "vite";

export default defineConfig({
  server: {
    // Honor the PORT env var (used by tooling); default to 5173 for `npm run dev`.
    port: Number(process.env.PORT) || 5173,
    open: true,
  },
  build: {
    target: "es2020",
    outDir: "dist",
  },
});
