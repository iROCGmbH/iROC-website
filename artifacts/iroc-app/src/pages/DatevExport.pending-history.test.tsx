/**
 * DatevExport — crash-left exports remain visible and explain recovery.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import DatevExport from "./DatevExport";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ lang: "en" }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const PENDING_EXPORT = {
  id: 412,
  exportedAt: "2026-08-23T10:30:00.000Z",
  bookkeeperEmail: "bookkeeper@example.test",
  invoiceCount: 1,
  invoiceNumbers: ["INV-2026-0412"],
  status: "pending" as const,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DatevExport — pending export history", () => {
  it("visibly marks a crash-left export as pending and explains the safe recovery path", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input: RequestInfo | URL) => {
        const url = input instanceof URL ? input.toString() : String(input);
        if (url.includes("/api/iroc/datev/settings")) {
          return { ok: true, json: async () => ({}) } as Response;
        }
        if (url.includes("/api/iroc/datev/exported-ids")) {
          return { ok: true, json: async () => ({ ids: [412] }) } as Response;
        }
        if (url.includes("/api/iroc/datev/exports")) {
          return {
            ok: true,
            json: async () => ({ exports: [PENDING_EXPORT], hasMore: false }),
          } as Response;
        }
        if (url.includes("/api/iroc/datev/invoices")) {
          return { ok: true, json: async () => [] } as Response;
        }
        if (url.includes("/api/admin/expenses")) {
          return { ok: true, json: async () => [] } as Response;
        }
        throw new Error(`Unmocked fetch: ${url}`);
      },
    );

    render(<DatevExport />);

    await waitFor(() => {
      expect(screen.getByText(PENDING_EXPORT.bookkeeperEmail)).toBeInTheDocument();
      expect(screen.getByText("Pending")).toBeInTheDocument();
    });
    expect(screen.getByTitle(
      "Export started, delivery status unknown. Confirm non-delivery before choosing “Export anyway”.",
    )).toBeInTheDocument();
  });
});