/**
 * DatevExport — successful export makes the invoice visibly "Already exported"
 *
 * The page initially receives an empty exported-ID set.  After the real export
 * POST succeeds, it calls loadExportMeta(), which must consume the newly
 * persisted ID and render the badge on the matching invoice row.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DatevExport from "./DatevExport";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ lang: "en" }),
}));

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

const INVOICE = {
  id: 3091,
  invoiceNumber: "INV-2026-3091",
  issueDate: `${new Date().toISOString().slice(0, 7)}-09`,
  total: "119.00",
  vatRate: "19.00",
  status: "sent",
  invoiceType: "domestic",
  customerName: "Badge Test Clinic",
};

function installFetchSpy() {
  let exportCompleted = false;
  const requests: { method: string; url: string }[] = [];

  vi.spyOn(globalThis, "fetch").mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        input instanceof Request
          ? input.url
          : input instanceof URL
            ? input.toString()
            : (input as string);
      const method = (
        init?.method ??
        (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      requests.push({ method, url });

      if (url.includes("/api/iroc/datev/settings")) {
        return { ok: true, json: async () => ({}) } as Response;
      }

      if (url.includes("/api/iroc/datev/exported-ids")) {
        return {
          ok: true,
          json: async () => ({ ids: exportCompleted ? [INVOICE.id] : [] }),
        } as Response;
      }

      if (url.includes("/api/iroc/datev/exports")) {
        return { ok: true, json: async () => [] } as Response;
      }

      if (method === "GET" && url.includes("/api/iroc/datev/invoices")) {
        return { ok: true, json: async () => [INVOICE] } as Response;
      }

      if (url.includes("/api/admin/expenses")) {
        return { ok: true, json: async () => [] } as Response;
      }

      if (method === "POST" && url.includes("/api/iroc/datev/export")) {
        exportCompleted = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({ exported: 1, skipped: [] }),
        } as Response;
      }

      throw new Error(`Unmocked fetch: ${method} ${url}`);
    },
  );

  return { requests };
}

afterEach(() => {
  vi.restoreAllMocks();
  mockToast.mockClear();
});

describe("DatevExport — exported badge after successful email export", () => {
  it("renders Already exported after the successful export refreshes exported IDs", async () => {
    const user = userEvent.setup();
    const { requests } = installFetchSpy();

    render(<DatevExport />);

    await waitFor(() =>
      expect(screen.getByText(INVOICE.invoiceNumber)).toBeInTheDocument(),
    );
    expect(screen.queryByText("Already exported")).not.toBeInTheDocument();

    const emailInput = screen.getByPlaceholderText("buchhaltung@kanzlei.de");
    await user.type(emailInput, "tax@firm.example");

    await user.click(
      screen.getByRole("button", { name: /Export.*invoice.*via Email/i }),
    );

    await waitFor(() =>
      expect(screen.getByText("Already exported")).toBeInTheDocument(),
    );

    const exportRequestIndex = requests.findIndex(
      ({ method, url }) =>
        method === "POST" && url.includes("/api/iroc/datev/export"),
    );
    expect(exportRequestIndex).toBeGreaterThanOrEqual(0);

    const exportedIdsRefreshIndex = requests.findIndex(
      ({ method, url }, index) =>
        index > exportRequestIndex &&
        method === "GET" &&
        url.includes("/api/iroc/datev/exported-ids"),
    );
    expect(exportedIdsRefreshIndex).toBeGreaterThan(exportRequestIndex);
  });
});