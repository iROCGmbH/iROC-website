import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DatevExport from "./DatevExport";

const mockToast = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ lang: "en" }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

const EXPORTED_INVOICE = {
  id: 42,
  invoiceNumber: "INV-2026-042",
  issueDate: "2026-08-01",
  total: "500.00",
  vatRate: "19.00",
  status: "sent" as const,
  invoiceType: null,
  customerName: "Example Customer",
};

const SKIPPED_INVOICE_NUMBER = "INV-2026-043";

afterEach(() => {
  vi.restoreAllMocks();
  mockToast.mockClear();
});

describe("DatevExport ZIP download skipped-invoice warning", () => {
  it("shows which invoices were omitted from the downloaded ZIP", async () => {
    const user = userEvent.setup();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:datev-test"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });

    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();

        if (url.includes("/api/iroc/datev/settings")) {
          return { ok: true, json: async () => ({}) } as Response;
        }
        if (url.includes("/api/iroc/datev/exported-ids")) {
          return { ok: true, json: async () => ({ ids: [] }) } as Response;
        }
        if (url.includes("/api/iroc/datev/exports")) {
          return { ok: true, json: async () => [] } as Response;
        }
        if (url.includes("/api/admin/expenses")) {
          return { ok: true, json: async () => [] } as Response;
        }
        if (method === "GET" && url.includes("/api/iroc/datev/invoices")) {
          return { ok: true, json: async () => [EXPORTED_INVOICE] } as Response;
        }
        if (method === "POST" && url.includes("/api/iroc/datev/download")) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({
              "Content-Disposition": 'attachment; filename="DATEV_Export_test.zip"',
              "X-DATEV-Skipped": SKIPPED_INVOICE_NUMBER,
            }),
            blob: async () => new Blob(["zip"], { type: "application/zip" }),
          } as Response;
        }

        throw new Error(`Unmocked fetch: ${method} ${url}`);
      },
    );

    render(<DatevExport />);

    await screen.findByText(EXPORTED_INVOICE.invoiceNumber);
    await user.click(screen.getByRole("button", { name: /Download ZIP \(Preview\)/i }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(SKIPPED_INVOICE_NUMBER);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Some invoices were skipped");
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: "ZIP downloaded",
      description: `Skipped (no line items): ${SKIPPED_INVOICE_NUMBER}`,
    }));
  });
});