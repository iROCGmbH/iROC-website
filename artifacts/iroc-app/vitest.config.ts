import path from "path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Read BASE_PATH from the environment the same way vite.config.ts does.
// If not set (e.g. bare `vitest` run) fall back to the known default so tests
// remain runnable locally without extra env setup.
const basePath = process.env.BASE_PATH ?? '/iroc-app';

export default defineConfig({
  plugins: [react()],
  // Inject BASE_PATH as a build-time constant so tests can read it via
  // __TEST_BASE_PATH__ without any jsdom/base-URL side-effects.
  define: {
    __TEST_BASE_PATH__: JSON.stringify(basePath),
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // The source-only localized picker lives outside this artifact and
      // therefore cannot walk up to this artifact's React dependency.
      "react/jsx-runtime": path.resolve(import.meta.dirname, "node_modules/react/jsx-runtime.js"),
      "react/jsx-dev-runtime": path.resolve(import.meta.dirname, "node_modules/react/jsx-dev-runtime.js"),
      "react": path.resolve(import.meta.dirname, "node_modules/react"),
      "react-dom": path.resolve(import.meta.dirname, "node_modules/react-dom"),
    },
    // App imports the shared date-picker source directly. Resolve React from
    // this artifact, rather than walking upward from that source directory,
    // where pnpm intentionally has no hoisted React package.
    dedupe: ["react", "react-dom"],
  },
});
