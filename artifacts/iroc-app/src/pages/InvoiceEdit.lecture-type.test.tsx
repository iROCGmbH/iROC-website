/**
 * Lecture invoice-type selector test: InvoiceEdit
 *
 * Confirms:
 *   1. The invoice type <select> contains an option with value "lecture-eu"
 *      whose label clearly identifies it as the EU variant.
 *   2. The same <select> contains an option with value "lecture-noneu"
 *      whose label clearly identifies it as the Non-EU variant.
 *   3. Selecting "lecture-eu" auto-updates the vatNote preview textarea
 *      to the §3a / §13b Reverse Charge text.
 *   4. Selecting "lecture-noneu" auto-updates the vatNote preview to the
 *      "nicht steuerbar" / "not subject to German VAT" text.
 *
 * A minimal domestic invoice fixture is used so the form initialises
 * cleanly without any pre-selected lecture type.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import InvoiceEdit from "./InvoiceEdit";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ lang: "de" }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/invoices/42/edit", vi.fn()],
  useParams:   () => ({ id: "42" }),
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const MOCK_INVOICE = {
  id:              42,
  invoiceNumber:   "2026-0042",
  status:          "draft",
  invoiceType:     "domestic",
  language:        "de",
  issueDate:       "2026-08-01",
  dueDate:         null,
  orderNumber:     null,
  referenceNumber: null,
  shippingMethod:  null,
  reasonForExport: null,
  termsOfDelivery: null,
  deliveryCosts:   "0.00",
  vatRate:         "19.00",
  notes:           null,
  vatNote:         null,
  websiteCustomerId: null,
  customer:        { name: "", country: null, company: null },
  items:           [],
};

const invoiceRef = { current: MOCK_INVOICE };

vi.mock("@workspace/api-client-react", () => ({
  useListIrocProducts:       () => ({ data: [] }),
  useListIrocProductGroups: () => ({ data: [] }),
  useGetIrocInvoice:         () => ({ data: invoiceRef.current, isLoading: false }),
  getGetIrocInvoiceQueryKey: (id: number) => ["iroc", "invoices", id],
}));

// ── Fetch spy ─────────────────────────────────────────────────────────────────

function installFetchSpy() {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input: RequestInfo | URL) => {
      const url =
        input instanceof Request
          ? input.url
          : input instanceof URL
          ? input.toString()
          : (input as string);

      if (url.includes("/api/iroc/customers-combined"))
        return { ok: true, json: async () => [] } as Response;
      if (url.includes("/api/iroc/inventory"))
        return { ok: true, json: async () => [] } as Response;
      return { ok: true, json: async () => ({}) } as Response;
    });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={makeQueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  invoiceRef.current = MOCK_INVOICE;
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("InvoiceEdit — lecture invoice-type options and vatNote preview", () => {
  it("pre-selects lecture-eu and restores its Reverse Charge vatNote for a saved invoice", async () => {
    installFetchSpy();
    invoiceRef.current = {
      ...MOCK_INVOICE,
      invoiceType: "lecture-eu",
      vatRate: "0.00",
    };
    render(<InvoiceEdit />, { wrapper: Wrapper });

    const typeSelect = await screen.findByDisplayValue(/Dienstleistung.*EU/i) as HTMLSelectElement;
    expect(typeSelect.value).toBe("lecture-eu");

    const vatNote = await screen.findByDisplayValue(/§\s*3a.*§\s*13b/i) as HTMLTextAreaElement;
    expect(vatNote.value).toMatch(/Reverse Charge/i);
  });

  it("renders a lecture-eu option whose label includes 'EU'", async () => {
    installFetchSpy();
    render(<InvoiceEdit />, { wrapper: Wrapper });

    // Form initialises from the domestic fixture — type select shows Domestic
    const typeSelect = await screen.findByDisplayValue(/Inland \(19 % MwSt\.\)/i) as HTMLSelectElement;

    const euOption = Array.from(typeSelect.options).find(
      (o) => o.value === "lecture-eu"
    );
    expect(euOption).toBeDefined();
    expect(euOption!.text.toLowerCase()).toContain("eu");
  });

  it("renders a lecture-noneu option whose label includes 'Non-EU'", async () => {
    installFetchSpy();
    render(<InvoiceEdit />, { wrapper: Wrapper });

    const typeSelect = await screen.findByDisplayValue(/Inland \(19 % MwSt\.\)/i) as HTMLSelectElement;

    const nonEuOption = Array.from(typeSelect.options).find(
      (o) => o.value === "lecture-noneu"
    );
    expect(nonEuOption).toBeDefined();
    expect(nonEuOption!.text.toLowerCase()).toMatch(/n[oi][nc]h?t?[\s\-–]?eu/);
  });

  it("updates the vatNote preview to the §3a / §13b Reverse Charge text when lecture-eu is selected", async () => {
    installFetchSpy();
    render(<InvoiceEdit />, { wrapper: Wrapper });

    const typeSelect = await screen.findByDisplayValue(/Inland \(19 % MwSt\.\)/i);
    fireEvent.change(typeSelect, { target: { value: "lecture-eu" } });

    await waitFor(() => {
      const textarea = screen.getByDisplayValue(/§\s*3a.*§\s*13b/i) as HTMLTextAreaElement;
      expect(textarea.value).toMatch(/Reverse Charge/i);
    });
  });

  it("updates the vatNote preview to the 'nicht steuerbar' text when lecture-noneu is selected", async () => {
    installFetchSpy();
    render(<InvoiceEdit />, { wrapper: Wrapper });

    const typeSelect = await screen.findByDisplayValue(/Inland \(19 % MwSt\.\)/i);
    fireEvent.change(typeSelect, { target: { value: "lecture-noneu" } });

    await waitFor(() => {
      const textarea = screen.getByDisplayValue(/nicht steuerbar/i) as HTMLTextAreaElement;
      expect(textarea.value).toMatch(/§\s*3a/i);
    });
  });

  it("both lecture options are distinct: lecture-eu does not mention 'nicht steuerbar' and lecture-noneu does not mention '§13b'", async () => {
    installFetchSpy();
    const { unmount } = render(<InvoiceEdit />, { wrapper: Wrapper });
    const typeSelect = await screen.findByDisplayValue(/Inland \(19 % MwSt\.\)/i);

    // ── lecture-eu ──
    fireEvent.change(typeSelect, { target: { value: "lecture-eu" } });
    await waitFor(() => {
      expect(screen.getByDisplayValue(/§\s*13b/i)).toBeInTheDocument();
    });
    expect(screen.queryByDisplayValue(/nicht steuerbar/i)).not.toBeInTheDocument();

    unmount();

    // ── lecture-noneu (fresh render) ──
    const { unmount: unmount2 } = render(<InvoiceEdit />, { wrapper: Wrapper });
    const typeSelect2 = await screen.findByDisplayValue(/Inland \(19 % MwSt\.\)/i);
    fireEvent.change(typeSelect2, { target: { value: "lecture-noneu" } });
    await waitFor(() => {
      expect(screen.getByDisplayValue(/nicht steuerbar/i)).toBeInTheDocument();
    });
    expect(screen.queryByDisplayValue(/§\s*13b/i)).not.toBeInTheDocument();
    unmount2();
  });
});
