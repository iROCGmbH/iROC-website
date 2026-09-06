/**
 * VAT rate reset test: InvoiceEdit
 *
 * Confirms that vatRateOverride resets correctly when the admin switches the
 * invoice type on an existing invoice:
 *
 *   – A domestic invoice saved with 7 % loads with 7 % selected.
 *   – Switching to EU hides the VAT selector (rate forced to 0 %).
 *   – Switching back to domestic shows 19 % (not 7 %, because EU set prev → 0,
 *     and 0 is not a valid domestic rate).
 *   – The same forced-0 and domestic restore behavior applies to non-EU invoices.
 *   – A 7 % domestic invoice that stays on domestic keeps 7 %.
 *
 * Query strategy: use getByDisplayValue on option text rather than ARIA
 * roles, because the <Label> elements in InvoiceEdit are not linked to the
 * <select> elements via htmlFor/id and therefore carry no accessible name.
 *
 * • Type select:     identified by the currently-selected option text.
 * • VAT rate select: identified by option text unique to it
 *                    (/Regelsteuersatz/ for 19 %, /Ermäßigter/ for 7 %).
 *                    The selector is only rendered when type = "domestic".
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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

/**
 * Domestic invoice saved with 7 % reduced VAT rate.
 * No pre-selected customer so the component initialises cleanly. The taxable
 * line item also keeps the VAT reset covered when a saved invoice has content.
 */
const MOCK_INVOICE_7PCT = {
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
  vatRate:         "7.00",   // ← 7 % reduced rate saved on the invoice
  notes:           null,
  vatNote:         null,
  websiteCustomerId: null,
  customer:        { name: "", country: null, company: null },
  items: [
    {
      id:              1,
      productId:       null,
      productName:     "iROC Device",
      sku:             null,
      description:     null,
      lotNumber:       null,
      hsCode:          null,
      countryOfOrigin: null,
      weightKg:        null,
      unitPrice:       "1000.00",
      discountPercent: null,
      isDemo:          false,
      quantity:        1,
    },
  ],
};

vi.mock("@workspace/api-client-react", () => ({
  useListIrocProducts:       () => ({ data: [] }),
  useListIrocProductGroups: () => ({ data: [] }),
  useGetIrocInvoice:         () => ({ data: MOCK_INVOICE_7PCT, isLoading: false }),
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
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("InvoiceEdit — VAT rate selector resets on invoice-type switch", () => {
  it("loads the saved 7 % rate and shows it selected in the VAT rate selector", async () => {
    installFetchSpy();
    render(<InvoiceEdit />, { wrapper: Wrapper });

    // The VAT-rate selector is uniquely identified by the "Ermäßigter" option
    // being selected (7 %) — this only appears when the saved rate was 7.
    const vatSelect = await screen.findByDisplayValue(/Ermäßigter/i);
    expect(vatSelect).toBeInTheDocument();
    expect((vatSelect as HTMLSelectElement).value).toBe("7");
  });

  it("hides the VAT rate selector when switching domestic (7 %) → EU", async () => {
    installFetchSpy();
    render(<InvoiceEdit />, { wrapper: Wrapper });

    // Confirm 7 % is loaded
    await screen.findByDisplayValue(/Ermäßigter/i);

    // Switch to EU
    const typeSelect = screen.getByDisplayValue(/Inland \(19 % MwSt\.\)/i);
    fireEvent.change(typeSelect, { target: { value: "eu" } });

    // VAT selector must disappear (rate forced to 0)
    await waitFor(() => {
      expect(screen.queryByDisplayValue(/Ermäßigter/i)).not.toBeInTheDocument();
      expect(screen.queryByDisplayValue(/Regelsteuersatz/i)).not.toBeInTheDocument();
    });
  });

  it("restores the VAT selector at 19 % (not 7 %) when switching EU → domestic", async () => {
    // Critical regression guard: once EU forces prev → 0,
    // switching back to domestic must yield 19 %, not silently reuse 7 %.
    installFetchSpy();
    render(<InvoiceEdit />, { wrapper: Wrapper });

    // 1. Invoice loads with 7 %
    await screen.findByDisplayValue(/Ermäßigter/i);

    // 2. Switch to EU — prev becomes 0
    const typeSelect = screen.getByDisplayValue(/Inland \(19 % MwSt\.\)/i);
    fireEvent.change(typeSelect, { target: { value: "eu" } });
    await waitFor(() => {
      expect(screen.queryByDisplayValue(/Ermäßigter/i)).not.toBeInTheDocument();
    });

    // 3. Switch back to domestic — prev is 0 (not 7 or 19) → must default to 19
    const typeSelectEu = screen.getByDisplayValue("EU – Waren / Reverse Charge (0 %)");
    fireEvent.change(typeSelectEu, { target: { value: "domestic" } });

    const vatSelectBack = await screen.findByDisplayValue(/Regelsteuersatz/i);
    expect((vatSelectBack as HTMLSelectElement).value).toBe("19");
  });

  it("hides the VAT rate selector when switching domestic (7 %) → export", async () => {
    installFetchSpy();
    render(<InvoiceEdit />, { wrapper: Wrapper });

    await screen.findByDisplayValue(/Ermäßigter/i);

    const typeSelect = screen.getByDisplayValue(/Inland \(19 % MwSt\.\)/i);
    fireEvent.change(typeSelect, { target: { value: "export" } });

    await waitFor(() => {
      expect(screen.queryByDisplayValue(/Ermäßigter/i)).not.toBeInTheDocument();
      expect(screen.queryByDisplayValue(/Regelsteuersatz/i)).not.toBeInTheDocument();
    });
  });

  it("hides the VAT rate selector when switching domestic (7 %) → noneu", async () => {
    installFetchSpy();
    render(<InvoiceEdit />, { wrapper: Wrapper });

    await screen.findByDisplayValue(/Ermäßigter/i);

    const typeSelect = screen.getByDisplayValue(/Inland \(19 % MwSt\.\)/i);
    fireEvent.change(typeSelect, { target: { value: "noneu" } });

    await waitFor(() => {
      expect(screen.queryByDisplayValue(/Ermäßigter/i)).not.toBeInTheDocument();
      expect(screen.queryByDisplayValue(/Regelsteuersatz/i)).not.toBeInTheDocument();
    });
  });

  it("sets the effective VAT rate to 0 % when switching domestic (7 %) → lecture-eu", async () => {
    installFetchSpy();
    render(<InvoiceEdit />, { wrapper: Wrapper });

    await screen.findByDisplayValue(/Ermäßigter/i);
    const typeSelect = screen.getByDisplayValue(/Inland \(19 % MwSt\.\)/i);
    fireEvent.change(typeSelect, { target: { value: "lecture-eu" } });

    await waitFor(() => {
      expect(screen.queryByDisplayValue(/Ermäßigter/i)).not.toBeInTheDocument();
      expect(screen.getByText(/MwSt\.\s*\(0%\):/i)).toBeInTheDocument();
    });
  });

  it("sets the effective VAT rate to 0 % when switching domestic (7 %) → lecture-noneu", async () => {
    installFetchSpy();
    render(<InvoiceEdit />, { wrapper: Wrapper });

    await screen.findByDisplayValue(/Ermäßigter/i);
    const typeSelect = screen.getByDisplayValue(/Inland \(19 % MwSt\.\)/i);
    fireEvent.change(typeSelect, { target: { value: "lecture-noneu" } });

    await waitFor(() => {
      expect(screen.queryByDisplayValue(/Ermäßigter/i)).not.toBeInTheDocument();
      expect(screen.getByText(/MwSt\.\s*\(0%\):/i)).toBeInTheDocument();
    });
  });

  it("resets VAT to 0 % for domestic → lecture-noneu with a pre-filled taxable item", async () => {
    installFetchSpy();
    render(<InvoiceEdit />, { wrapper: Wrapper });

    const itemName = await screen.findByDisplayValue("iROC Device");
    const itemRow = itemName.closest("tr");
    expect(itemRow).not.toBeNull();
    expect(within(itemRow!).getByDisplayValue("1000.00")).toBeInTheDocument();
    expect(screen.getByText(/Zwischensumme:/i).parentElement).toHaveTextContent(/1\.000,00/);

    const typeSelect = screen.getByDisplayValue(/Inland \(19 % MwSt\.\)/i);
    fireEvent.change(typeSelect, { target: { value: "lecture-noneu" } });

    await waitFor(() => {
      expect(screen.getByText(/MwSt\.\s*\(0%\):/i)).toBeInTheDocument();
    });
  });

  it("restores the VAT selector at 19 % when switching noneu → domestic", async () => {
    installFetchSpy();
    render(<InvoiceEdit />, { wrapper: Wrapper });

    await screen.findByDisplayValue(/Ermäßigter/i);

    const typeSelect = screen.getByDisplayValue(/Inland \(19 % MwSt\.\)/i);
    fireEvent.change(typeSelect, { target: { value: "noneu" } });
    await waitFor(() => {
      expect(screen.queryByDisplayValue(/Ermäßigter/i)).not.toBeInTheDocument();
    });

    const noneuTypeSelect = screen.getByDisplayValue("Nicht-EU Standardrechnung (0 %)");
    fireEvent.change(noneuTypeSelect, { target: { value: "domestic" } });

    const vatSelectBack = await screen.findByDisplayValue(/Regelsteuersatz/i);
    expect((vatSelectBack as HTMLSelectElement).value).toBe("19");
  });

  it("restores the VAT selector at 19 % when switching export → domestic", async () => {
    installFetchSpy();
    render(<InvoiceEdit />, { wrapper: Wrapper });

    await screen.findByDisplayValue(/Ermäßigter/i);

    const typeSelect = screen.getByDisplayValue(/Inland \(19 % MwSt\.\)/i);
    fireEvent.change(typeSelect, { target: { value: "export" } });
    await waitFor(() => {
      expect(screen.queryByDisplayValue(/Ermäßigter/i)).not.toBeInTheDocument();
    });

    // Use the exact text of the Export option to avoid ambiguity
    const typeSelectExport = screen.getByDisplayValue(/Export.*Handelsrechnung/i);
    fireEvent.change(typeSelectExport, { target: { value: "domestic" } });

    const vatSelectBack = await screen.findByDisplayValue(/Regelsteuersatz/i);
    expect((vatSelectBack as HTMLSelectElement).value).toBe("19");
  });

  it("keeps 7 % when the admin leaves the invoice type on domestic", async () => {
    installFetchSpy();
    render(<InvoiceEdit />, { wrapper: Wrapper });

    // No type switch performed — 7 % must remain throughout
    const vatSelect = await screen.findByDisplayValue(/Ermäßigter/i);
    expect((vatSelect as HTMLSelectElement).value).toBe("7");
  });
});
