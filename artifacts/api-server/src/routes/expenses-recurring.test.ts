import { describe, expect, it } from "vitest";
import { nextRecurringDueDate } from "./expenses.js";

describe("nextRecurringDueDate", () => {
  it("advances fixed-day cadences", () => {
    expect(nextRecurringDueDate("2026-01-15", 1, "day")).toBe("2026-01-16");
    expect(nextRecurringDueDate("2026-01-15", 2, "week")).toBe("2026-01-29");
    expect(nextRecurringDueDate("2026-01-15", 3, "week")).toBe("2026-02-05");
  });

  it("keeps month-end reminders in the target month", () => {
    expect(nextRecurringDueDate("2026-01-31", 1, "month")).toBe("2026-02-28");
    expect(nextRecurringDueDate("2024-01-31", 1, "month")).toBe("2024-02-29");
    expect(nextRecurringDueDate("2025-11-30", 1, "quarter")).toBe("2026-02-28");
    expect(nextRecurringDueDate("2025-02-28", 2, "year")).toBe("2027-02-28");
  });
});