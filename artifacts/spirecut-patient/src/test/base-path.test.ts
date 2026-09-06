/**
 * Base-path injection smoke test
 *
 * Verifies that the `__TEST_BASE_PATH__` constant injected by vitest.config.ts
 * (via `process.env.BASE_PATH`) matches the expected deployment prefix.
 *
 * How it works
 * ────────────
 * vitest.config.ts reads `process.env.BASE_PATH` at config-evaluation time and
 * bakes the value into every test bundle as `__TEST_BASE_PATH__`.  The CI
 * workflow sets `BASE_PATH` explicitly — once for the production prefix and
 * once for a staging prefix — so both runs exercise the dynamic-injection path
 * rather than silently relying on a hardcoded fallback.
 *
 * Covered guarantees
 * ──────────────────
 * 1. __TEST_BASE_PATH__ is a non-empty string (the define() replacement worked).
 * 2. It starts with "/" (all deployment prefixes must be root-relative).
 * 3. It does not end with "/" (Vite convention: no trailing slash on base).
 * 4. In the production CI run it equals "/spirecut-patient".
 * 5. It matches the value that was passed in via BASE_PATH (round-trip check).
 */

declare const __TEST_BASE_PATH__: string;

describe("__TEST_BASE_PATH__ injection", () => {
  it("is a non-empty string", () => {
    expect(typeof __TEST_BASE_PATH__).toBe("string");
    expect(__TEST_BASE_PATH__.length).toBeGreaterThan(0);
  });

  it("starts with a leading slash", () => {
    expect(__TEST_BASE_PATH__).toMatch(/^\//);
  });

  it("does not end with a trailing slash", () => {
    expect(__TEST_BASE_PATH__).not.toMatch(/\/$/);
  });

  it("equals the BASE_PATH env var (or the known default when unset)", () => {
    // process.env.BASE_PATH is available in the vitest Node environment.
    // When BASE_PATH is not set locally, the config falls back to '/spirecut-patient',
    // which is also what this assertion accepts.
    const expected = process.env.BASE_PATH ?? "/spirecut-patient";
    expect(__TEST_BASE_PATH__).toBe(expected);
  });

  it("equals /spirecut-patient in the production CI run", () => {
    // This assertion is skipped when BASE_PATH is explicitly set to something
    // else (e.g. the staging-base smoke-test run in CI).
    if (
      process.env.BASE_PATH !== undefined &&
      process.env.BASE_PATH !== "/spirecut-patient"
    ) {
      // Running with an alternate base — skip the production-value check.
      return;
    }
    expect(__TEST_BASE_PATH__).toBe("/spirecut-patient");
  });
});
