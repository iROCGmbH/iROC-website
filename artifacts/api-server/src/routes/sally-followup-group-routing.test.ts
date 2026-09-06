/**
 * Unit tests for Sally's lead follow-up email brand routing.
 *
 * These templates share the group → subject helpers with first-contact emails,
 * but are separate code paths and need their own regression coverage.
 */
import { describe, it, expect } from "vitest";
import {
  monthlyReminderEmail,
  weekFollowupEmail,
} from "../lib/sally-cron.js";

const CASES = [
  { group: "spirecut", fragment: "Spirecut" },
  { group: "ministem", fragment: "MiniStem" },
  { group: "cellenis", fragment: "Cellenis" },
  { group: "", fragment: "iROC Produkte" },
] as const;

describe("Sally follow-up email subjects — brand-group routing", () => {
  describe.each([
    ["4-week follow-up", weekFollowupEmail],
    ["2-month reminder", monthlyReminderEmail],
  ] as const)("%s", (_templateName, buildEmail) => {
    it.each(CASES)(
      'keeps the "$group" group label in the subject',
      ({ group, fragment }) => {
        const { subject } = buildEmail(
          "Test Doctor",
          group,
          "both",
          "Sally",
          "sally@example.com",
        );

        expect(subject).toContain(fragment);
      },
    );
  });
});