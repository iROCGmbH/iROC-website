import path from "path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Read BASE_PATH from the environment the same way vite.config.ts does.
// If not set (e.g. bare `vitest` run) fall back to the known deployment default
// so tests remain runnable locally without extra env setup.
const basePath = process.env.BASE_PATH ?? "/spirecut-patient";

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
    },
  },
});
