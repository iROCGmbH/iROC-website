import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Tori from "./Tori";

const testState = vi.hoisted(() => ({
  lang: "en" as "en" | "de",
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => testState,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const historyResponse = {
  items: [
    {
      record_id: 7,
      record_type: "expense",
      party_name: "ACME GmbH",
      document_number: "SUP-2026-7",
      order_number: null,
      document_date: "2026-07-15",
      category: "service",
      source: "tori",
      currency: "EUR",
      net_amount: "100.00",
      tax_amount: "19.00",
      total_amount: "119.00",
      file_object_path: "/public/expenses/acme.pdf",
      notes: null,
      status: null,
      created_at: "2026-07-15T10:00:00.000Z",
    },
    {
      record_id: 8,
      record_type: "invoice",
      party_name: "Example Clinic",
      document_number: "2026-0008",
      order_number: "ORD-8",
      document_date: "2026-08-02",
      category: "domestic",
      source: "iroc",
      currency: "EUR",
      net_amount: "200.00",
      tax_amount: "38.00",
      total_amount: "238.00",
      file_object_path: null,
      notes: null,
      status: "sent",
      created_at: "2026-08-02T10:00:00.000Z",
    },
  ],
  count: 2,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

describe("Tori finance history", () => {
  it("renders expenses and invoices and sends the exact search value", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("/api/iroc/tori/pending-actions")) {
        return { ok: true, json: async () => [] } as Response;
      }
      if (url.includes("/api/iroc/tori/finance-history")) {
        return { ok: true, json: async () => historyResponse } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });

    render(<Tori />);
    fireEvent.click(screen.getByRole("button", { name: "History" }));

    await waitFor(() => {
      expect(screen.getByText("Document History")).toBeInTheDocument();
      expect(screen.getByText("ACME GmbH")).toBeInTheDocument();
      expect(screen.getByText("Example Clinic")).toBeInTheDocument();
      expect(screen.getByText("Expense")).toBeInTheDocument();
      expect(screen.getByText("Invoice")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Exact search"), { target: { value: "2026-0008" } });

    await waitFor(() => {
      const historyUrls = fetchMock.mock.calls
        .map(([input]) => input instanceof Request ? input.url : String(input))
        .filter(url => url.includes("/api/iroc/tori/finance-history"));
      expect(historyUrls.at(-1)).toContain("search=2026-0008");
    }, { timeout: 1500 });

    fireEvent.click(screen.getByRole("combobox", { name: "Document type" }));
    fireEvent.click(screen.getByRole("option", { name: "Invoices" }));

    await waitFor(() => {
      const historyUrls = fetchMock.mock.calls
        .map(([input]) => input instanceof Request ? input.url : String(input))
        .filter(url => url.includes("/api/iroc/tori/finance-history"));
      expect(historyUrls.at(-1)).toContain("type=invoice");
    }, { timeout: 1500 });
  });
});