/**
 * DatevExport — history remains visible when an older metadata request resolves
 * after a successful email export.
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

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const INVOICE = {
  id: 310,
  invoiceNumber: "INV-2026-0310",
  issueDate: `${new Date().toISOString().slice(0, 7)}-09`,
  total: "119.00",
  vatRate: "19.00",
  status: "sent",
  invoiceType: "domestic",
  customerName: "History Test Clinic",
};

const EXPORT_RECORD = {
  id: 987,
  exportedAt: "2026-08-22T10:30:00.000Z",
  bookkeeperEmail: "accounting@example.test",
  invoiceCount: 1,
  status: "sent" as const,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DatevExport — export history refresh", () => {
  it("shows the sent export immediately and ignores an older empty history response", async () => {
    const initialHistory = deferred<Response>();
    const user = userEvent.setup();
    let exportsRequestCount = 0;

    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof URL ? input.toString() : String(input);
        const method = (init?.method ?? "GET").toUpperCase();

        if (url.includes("/api/iroc/datev/settings")) {
          return { ok: true, json: async () => ({}) } as Response;
        }
        if (url.includes("/api/iroc/datev/exported-ids")) {
          return { ok: true, json: async () => ({ ids: [INVOICE.id] }) } as Response;
        }
        if (url.includes("/api/iroc/datev/exports")) {
          exportsRequestCount++;
          if (exportsRequestCount === 1) return initialHistory.promise;
          return { ok: true, json: async () => [EXPORT_RECORD] } as Response;
        }
        if (method === "GET" && url.includes("/api/iroc/datev/invoices")) {
          return { ok: true, json: async () => [INVOICE] } as Response;
        }
        if (url.includes("/api/admin/expenses")) {
          return { ok: true, json: async () => [] } as Response;
        }
        if (method === "POST" && url.includes("/api/iroc/datev/export")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ exported: 1, skipped: [], exportRecord: EXPORT_RECORD }),
          } as Response;
        }
        throw new Error(`Unmocked fetch: ${method} ${url}`);
      },
    );

    render(<DatevExport />);
    await waitFor(() => expect(screen.getByText(INVOICE.invoiceNumber)).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText("buchhaltung@kanzlei.de"), EXPORT_RECORD.bookkeeperEmail);
    await user.click(screen.getByRole("button", { name: /Export.*invoice.*via Email/i }));

    await waitFor(() => {
      expect(screen.getByText(EXPORT_RECORD.bookkeeperEmail)).toBeInTheDocument();
      expect(screen.getByText("Export History")).toBeInTheDocument();
    });

    // Resolve the page-load request last. Its stale empty response must not
    // remove the row that the successful export has already made visible.
    initialHistory.resolve({ ok: true, json: async () => [] } as Response);
    await waitFor(() => expect(exportsRequestCount).toBeGreaterThanOrEqual(2));
    expect(screen.getByText(EXPORT_RECORD.bookkeeperEmail)).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });
});
