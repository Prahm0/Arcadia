import { sites } from "@openai/sites-vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sites()],
  build: {
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    emptyOutDir: true,
    lib: {
      entry: "worker/index.js",
      fileName: () => "index.js",
      formats: ["es"],
    },
    outDir: "dist/server",
    target: "es2022",
  },
});
