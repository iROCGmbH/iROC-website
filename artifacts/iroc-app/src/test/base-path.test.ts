/**
 * Base-path injection smoke test.
 *
 * vitest.config.ts reads BASE_PATH from the environment at config-load time
 * and injects it as the compile-time constant __TEST_BASE_PATH__
 * (falling back to '/iroc-app' when BASE_PATH is not set).
 *
 * These tests assert equality between the injected constant and the value
 * that vitest.config.ts would have computed — i.e. process.env.BASE_PATH at
 * test-run time, falling back to '/iroc-app'.  Any mismatch proves that the
 * injection pipeline is broken.
 *
 * The CI workflow exercises this test twice:
 *   1. BASE_PATH=/iroc-app          → expects __TEST_BASE_PATH__ === '/iroc-app'
 *   2. BASE_PATH=/iroc-app-staging  → expects __TEST_BASE_PATH__ === '/iroc-app-staging'
 */

declare const __TEST_BASE_PATH__: string;

// Mirror the fallback logic in vitest.config.ts so the assertion stays in sync.
const expectedBasePath = process.env.BASE_PATH ?? "/iroc-app";

describe("__TEST_BASE_PATH__ injection", () => {
  it("equals the BASE_PATH environment variable (or the default fallback)", () => {
    expect(__TEST_BASE_PATH__).toBe(expectedBasePath);
  });

  it("is a non-empty string starting with a forward slash", () => {
    expect(typeof __TEST_BASE_PATH__).toBe("string");
    expect(__TEST_BASE_PATH__).toMatch(/^\//);
    expect(__TEST_BASE_PATH__.length).toBeGreaterThan(1);
  });
});
