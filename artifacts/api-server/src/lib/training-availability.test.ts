import { describe, expect, it } from "vitest";
import { isTrainingDateAvailable } from "./training-availability";

const now = new Date("2026-08-27T10:00:00");

function trainingDate(overrides: Partial<Parameters<typeof isTrainingDateAvailable>[0]> = {}) {
  return {
    date: "2026-09-18",
    isActive: true,
    registeredCount: 0,
    maxParticipants: 10,
    ...overrides,
  };
}

describe("isTrainingDateAvailable", () => {
  it("allows active dates more than 21 days away with capacity", () => {
    expect(isTrainingDateAvailable(trainingDate(), now)).toBe(true);
  });

  it("closes dates inside the website's 21-day registration window", () => {
    expect(isTrainingDateAvailable(trainingDate({ date: "2026-09-17" }), now)).toBe(false);
  });

  it("rejects inactive, full, and malformed dates", () => {
    expect(isTrainingDateAvailable(trainingDate({ isActive: false }), now)).toBe(false);
    expect(isTrainingDateAvailable(trainingDate({ registeredCount: 10 }), now)).toBe(false);
    expect(isTrainingDateAvailable(trainingDate({ date: "not-a-date" }), now)).toBe(false);
  });
});