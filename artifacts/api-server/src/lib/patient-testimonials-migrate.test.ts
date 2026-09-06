import { beforeEach, describe, expect, it, vi } from "vitest";

const mockQuery = vi.hoisted(() => vi.fn());
const loggerInfo = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => ({
  pool: { query: mockQuery },
}));

vi.mock("./logger", () => ({
  logger: { info: loggerInfo, error: vi.fn() },
}));

import { runPatientTestimonialsMigrations } from "./patient-testimonials-migrate";

describe("runPatientTestimonialsMigrations", () => {
  beforeEach(() => {
    mockQuery.mockReset().mockResolvedValue(undefined);
    loggerInfo.mockClear();
  });

  it("provisions the final bilingual table before routes can accept traffic", async () => {
    await runPatientTestimonialsMigrations();

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const statement = mockQuery.mock.calls[0][0] as string;
    expect(statement).toContain("CREATE TABLE IF NOT EXISTS patient_testimonials");
    expect(statement).toContain("procedure_de text NOT NULL DEFAULT ''");
    expect(statement).toContain("procedure_en text NOT NULL DEFAULT ''");
    expect(statement).toContain("patient_testimonials_public_order_idx");
    expect(loggerInfo).toHaveBeenCalledWith("Patient testimonial migrations completed");
  });

  it("keeps the legacy procedure-to-bilingual-column conversion idempotent", async () => {
    await runPatientTestimonialsMigrations();

    const statement = mockQuery.mock.calls[0][0] as string;
    expect(statement).toContain("information_schema.columns");
    expect(statement).toContain("SET procedure_de = procedure");
    expect(statement).toContain("DROP COLUMN procedure");
  });
});