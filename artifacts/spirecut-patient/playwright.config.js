// @ts-check
import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright e2e configuration for the Spirecut patient site.
 * Targets the running dev server proxied at localhost:80/spirecut-patient/.
 * Uses the nix-store Chromium pre-installed in the Replit environment.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:80',
    launchOptions: {
      // Allow the caller to override via env var; fall back to the Nix-store
      // Chromium that is pre-installed in the Replit environment.
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
        '/nix/store/0n9rl5l9syy808xi9bk4f6dhnfrvhkww-playwright-browsers-chromium/chromium-1080/chrome-linux/chrome',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
    headless: true,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
