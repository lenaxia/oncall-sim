import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { readFileSync } from "fs";

const pkg = JSON.parse(
  readFileSync(path.resolve(__dirname, "package.json"), "utf-8"),
) as { version: string };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../shared"),
    },
  },
  server: {
    port: 3001,
    strictPort: true,
    proxy: {
      // k8s mode: forward LLM proxy requests to sidecar
      "/llm": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      // legacy server proxy retained during migration; removed after Phase H
      "/api": {
        target: "http://localhost:3003",
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    include: ["js-yaml", "zod"],
  },
});
