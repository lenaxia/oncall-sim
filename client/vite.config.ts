import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { execSync } from "child_process";

function getVersion(): string {
  try {
    // e.g. "v1.0.26" or "v1.0.26-3-gabcdef" if commits exist after the tag
    return execSync("git describe --tags --always --dirty", {
      cwd: path.resolve(__dirname, ".."),
      encoding: "utf-8",
    }).trim();
  } catch {
    return "dev";
  }
}

const APP_VERSION = getVersion();

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
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
