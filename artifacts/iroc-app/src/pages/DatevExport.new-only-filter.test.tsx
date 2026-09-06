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

const EXPORTED_INVOICE = {
  id: 901,
  invoiceNumber: "INV-2026-0901",
  issueDate: "2026-08-01",
  total: "119.00",
  vatRate: "19.00",
  status: "sent" as const,
  invoiceType: "domestic",
  customerName: "Already Exported Clinic",
};

const NEW_INVOICE = {
  id: 902,
  invoiceNumber: "INV-2026-0902",
  issueDate: "2026-08-02",
  total: "238.00",
  vatRate: "19.00",
  status: "paid" as const,
  invoiceType: "domestic",
  customerName: "New Clinic",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DatevExport — New only filter", () => {
  it("hides exported rows, recalculates the selection summary, and resets for a new range", async () => {
    const user = userEvent.setup();

    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input: RequestInfo | URL) => {
        const url = input instanceof URL ? input.toString() : String(input);
        if (url.includes("/api/iroc/datev/settings")) {
          return { ok: true, json: async () => ({}) } as Response;
        }
        if (url.includes("/api/iroc/datev/exported-ids")) {
          return { ok: true, json: async () => ({ ids: [EXPORTED_INVOICE.id] }) } as Response;
        }
        if (url.includes("/api/iroc/datev/exports")) {
          return { ok: true, json: async () => [] } as Response;
        }
        if (url.includes("/api/iroc/datev/invoices")) {
          return { ok: true, json: async () => [EXPORTED_INVOICE, NEW_INVOICE] } as Response;
        }
        if (url.includes("/api/admin/expenses")) {
          return { ok: true, json: async () => [] } as Response;
        }
        throw new Error(`Unmocked fetch: ${url}`);
      },
    );

    render(<DatevExport />);

    await waitFor(() => expect(screen.getByText(EXPORTED_INVOICE.invoiceNumber)).toBeInTheDocument());
    expect(screen.getByText(NEW_INVOICE.invoiceNumber)).toBeInTheDocument();
    expect(screen.getByText("2 selected")).toBeInTheDocument();

    const newOnlyButton = screen.getByRole("button", { name: "New only" });
    await user.click(newOnlyButton);

    await waitFor(() => {
      expect(screen.queryByText(EXPORTED_INVOICE.invoiceNumber)).not.toBeInTheDocument();
    });
    expect(screen.getByText(NEW_INVOICE.invoiceNumber)).toBeInTheDocument();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(newOnlyButton).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Last Month" }));
    await waitFor(() => expect(newOnlyButton).toHaveAttribute("aria-pressed", "false"));
  });
});