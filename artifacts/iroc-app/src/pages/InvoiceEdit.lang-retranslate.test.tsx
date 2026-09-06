/**
 * Language retranslation test: InvoiceEdit
 *
 * Confirms that when the admin edits an existing invoice and switches the
 * invoice language (de → en, or en → de), product-linked line items have
 * their productName updated to the new language's name.
 *
 * Also confirms that the initial load of the invoice (which calls
 * setInvoiceLang internally) does NOT trigger retranslation — the saved
 * productNames from the DB must be left intact until the admin actively
 * changes the language.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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
  useParams: () => ({ id: "42" }),
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// ── Product and invoice fixtures ──────────────────────────────────────────────

const PRODUCT = {
  id: 7,
  nameDe: "Deutsches Produkt",
  nameEn: "English Product",
  descriptionDe: "Deutsche Beschreibung",
  descriptionEn: "English description",
  sku: "SKU-007",
  unitPrice: "150.00",
  category: "cellenis",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

/** Invoice saved in German with a linked product item. */
const MOCK_INVOICE_DE = {
  id: 42,
  invoiceNumber: "2026-0042",
  status: "draft",
  invoiceType: "domestic",
  language: "de",
  issueDate: "2026-08-01",
  createdAt: "2026-08-01T00:00:00.000Z",
  dueDate: null,
  orderNumber: null,
  referenceNumber: null,
  shippingMethod: null,
  reasonForExport: null,
  termsOfDelivery: null,
  deliveryCosts: "0.00",
  vatRate: "19.00",
  notes: null,
  vatNote: null,
  websiteCustomerId: null,
  customer: { name: "", country: null, company: null },
  items: [
    {
      id: 101,
      productId: PRODUCT.id,
      productName: "Deutsches Produkt",   // saved German name
      sku: "SKU-007",
      description: "Deutsche Beschreibung",
      lotNumber: null,
      hsCode: null,
      countryOfOrigin: null,
      weightKg: null,
      unitPrice: "150.00",
      discountPercent: "0",
      isDemo: false,
      quantity: 2,
    },
  ],
};

/** Invoice saved in English with a linked product item. */
const MOCK_INVOICE_EN = {
  ...MOCK_INVOICE_DE,
  language: "en",
  items: [
    {
      ...MOCK_INVOICE_DE.items[0],
      productName: "English Product",    // saved English name
      description: "English description",
    },
  ],
};

// The vi.mock factory must be synchronous so we use a mutable ref pattern.
const invoiceRef = { current: MOCK_INVOICE_DE as typeof MOCK_INVOICE_DE };
const productsRef = { current: [PRODUCT] };

vi.mock("@workspace/api-client-react", () => ({
  useListIrocProducts: () => ({ data: productsRef.current }),
  useListIrocProductGroups: () => ({ data: [] }),
  useGetIrocInvoice: () => ({ data: invoiceRef.current, isLoading: false }),
  getGetIrocInvoiceQueryKey: (id: number) => ["iroc", "invoices", id],
  getListIrocInvoicesQueryKey: () => ["iroc", "invoices"],
}));

// ── Fetch spy ─────────────────────────────────────────────────────────────────

function installFetchSpy(onPut?: (body: Record<string, unknown>) => void) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        input instanceof Request
          ? input.url
          : input instanceof URL
          ? input.toString()
          : (input as string);
      if (url.includes("/api/iroc/invoices/42") && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        onPut?.(body);
        return { ok: true, json: async () => ({}) } as Response;
      }
      if (url.includes("/api/iroc/customers-combined"))
        return { ok: true, json: async () => [] } as Response;
      if (url.includes("/api/iroc/inventory"))
        return { ok: true, json: async () => [] } as Response;
      if (url.includes("/api/iroc/invoice-items/last-discount"))
        return { ok: true, json: async () => ({ discountPercent: null }) } as Response;
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
  invoiceRef.current = MOCK_INVOICE_DE;
  productsRef.current = [PRODUCT];
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("InvoiceEdit — product names retranslate when invoice language is switched", () => {
  it("de → en: saved German productName updates to English after language switch", async () => {
    invoiceRef.current = MOCK_INVOICE_DE;
    installFetchSpy();
    render(<InvoiceEdit />, { wrapper: Wrapper });

    // Wait for the form to initialize and show the saved German name
    await waitFor(() => {
      expect(screen.getByDisplayValue("Deutsches Produkt")).toBeInTheDocument();
    });

    // Switch invoice language to English
    const langSelect = screen.getByDisplayValue(/Deutsch \(DE\)/i) as HTMLSelectElement;
    fireEvent.change(langSelect, { target: { value: "en" } });

    // Product name must update to English
    await waitFor(() => {
      expect(screen.getByDisplayValue("English Product")).toBeInTheDocument();
      expect(screen.getByDisplayValue("English description")).toBeInTheDocument();
      expect(screen.queryByDisplayValue("Deutsches Produkt")).not.toBeInTheDocument();
      expect(screen.queryByDisplayValue("Deutsche Beschreibung")).not.toBeInTheDocument();
    });
  });

  it("en → de: saved English productName updates to German after language switch", async () => {
    invoiceRef.current = MOCK_INVOICE_EN;
    installFetchSpy();
    render(<InvoiceEdit />, { wrapper: Wrapper });

    // Wait for the English name to appear
    await waitFor(() => {
      expect(screen.getByDisplayValue("English Product")).toBeInTheDocument();
    });

    // Switch invoice language to German
    const langSelect = screen.getByDisplayValue(/Englisch \(EN\)/i) as HTMLSelectElement;
    fireEvent.change(langSelect, { target: { value: "de" } });

    // Product name must update to German
    await waitFor(() => {
      expect(screen.getByDisplayValue("Deutsches Produkt")).toBeInTheDocument();
      expect(screen.queryByDisplayValue("English Product")).not.toBeInTheDocument();
    });
  });

  it("initial load does not retranslate saved productName (en invoice keeps English name)", async () => {
    // Invoice saved in English — loading must NOT retranslate names to German
    // (the default invoiceLang state is "de", but the init effect pre-seeds the
    //  ref and calls setInvoiceLang("en") in one batch, so no retranslation fires)
    invoiceRef.current = MOCK_INVOICE_EN;
    installFetchSpy();
    render(<InvoiceEdit />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByDisplayValue("English Product")).toBeInTheDocument();
    });

    // Give any stray async retranslation a chance to fire
    await new Promise(r => setTimeout(r, 50));

    // Still English — no spurious retranslation on load
    expect(screen.getByDisplayValue("English Product")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Deutsches Produkt")).not.toBeInTheDocument();
  });

  it("switching language twice (de→en→de) ends up with German name", async () => {
    invoiceRef.current = MOCK_INVOICE_DE;
    installFetchSpy();
    render(<InvoiceEdit />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getByDisplayValue("Deutsches Produkt")).toBeInTheDocument());

    // de → en
    fireEvent.change(screen.getByDisplayValue(/Deutsch \(DE\)/i), { target: { value: "en" } });
    await waitFor(() => expect(screen.getByDisplayValue("English Product")).toBeInTheDocument());

    // en → de
    fireEvent.change(screen.getByDisplayValue(/Englisch \(EN\)/i), { target: { value: "de" } });
    await waitFor(() => {
      expect(screen.getByDisplayValue("Deutsches Produkt")).toBeInTheDocument();
      expect(screen.queryByDisplayValue("English Product")).not.toBeInTheDocument();
    });
  });
});

describe("InvoiceEdit — manually edited product name protection", () => {
  it("shows an outdated-catalog hint instead of the manual-edit notice after a product rename", async () => {
    productsRef.current = [{
      ...PRODUCT,
      nameDe: "Deutsches Produkt v2",
      updatedAt: "2026-08-15T00:00:00.000Z",
    }];
    invoiceRef.current = MOCK_INVOICE_DE;
    installFetchSpy();
    render(<InvoiceEdit />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getByDisplayValue("Deutsches Produkt")).toBeInTheDocument());
    fireEvent.change(screen.getByDisplayValue(/Deutsch \(DE\)/i), { target: { value: "en" } });

    await waitFor(() => {
      expect(screen.getByDisplayValue("Deutsches Produkt")).toBeInTheDocument();
      expect(screen.getByText(/Katalogname seit dieser Rechnung geändert/i)).toBeInTheDocument();
      expect(screen.queryByText(/Manuell bearbeitet/i)).not.toBeInTheDocument();
    });
  });

  it("manually edited linked name is NOT overwritten on language switch", async () => {
    invoiceRef.current = MOCK_INVOICE_DE;
    installFetchSpy();
    render(<InvoiceEdit />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getByDisplayValue("Deutsches Produkt")).toBeInTheDocument());

    // Manually edit the product name
    fireEvent.change(screen.getByDisplayValue("Deutsches Produkt"), {
      target: { value: "Deutsches Produkt XL" },
    });
    await waitFor(() => expect(screen.getByDisplayValue("Deutsches Produkt XL")).toBeInTheDocument());

    // Switch language to English
    fireEvent.change(screen.getByDisplayValue(/Deutsch \(DE\)/i), { target: { value: "en" } });

    // Manually edited name must be preserved
    await waitFor(() => {
      expect(screen.getByDisplayValue("Deutsches Produkt XL")).toBeInTheDocument();
      expect(screen.queryByDisplayValue("English Product")).not.toBeInTheDocument();
    });
  });

  it("shows the 'manually edited' notice after editing a linked name", async () => {
    invoiceRef.current = MOCK_INVOICE_DE;
    installFetchSpy();
    render(<InvoiceEdit />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getByDisplayValue("Deutsches Produkt")).toBeInTheDocument());

    // Notice must NOT appear before any editing
    expect(screen.queryByText(/Manuell bearbeitet/i)).not.toBeInTheDocument();

    // Edit the product name
    fireEvent.change(screen.getByDisplayValue("Deutsches Produkt"), {
      target: { value: "Deutsches Produkt Plus" },
    });

    // The inline notice must appear
    await waitFor(() => {
      expect(screen.getByText(/Manuell bearbeitet/i)).toBeInTheDocument();
    });
  });

  it("reset button restores canonical name for current language and removes the notice", async () => {
    invoiceRef.current = MOCK_INVOICE_DE;
    installFetchSpy();
    render(<InvoiceEdit />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getByDisplayValue("Deutsches Produkt")).toBeInTheDocument());

    // Edit to trigger the notice
    fireEvent.change(screen.getByDisplayValue("Deutsches Produkt"), {
      target: { value: "Mein angepasster Name" },
    });
    await waitFor(() => expect(screen.getByText(/Manuell bearbeitet/i)).toBeInTheDocument());

    // Click the reset button
    fireEvent.click(screen.getByRole("button", { name: /Zurücksetzen/i }));

    // Canonical German name restored; notice gone
    await waitFor(() => {
      expect(screen.getByDisplayValue("Deutsches Produkt")).toBeInTheDocument();
      expect(screen.queryByText(/Manuell bearbeitet/i)).not.toBeInTheDocument();
    });
  });

  it("a saved custom name (not matching canonical) is flagged — not overwritten — on language switch", async () => {
    // Invoice saved with a custom product name that doesn't match either canonical name
    const invoiceWithCustomName = {
      ...MOCK_INVOICE_DE,
      items: [
        {
          ...MOCK_INVOICE_DE.items[0],
          productName: "Sonderedition Produkt",  // custom — matches neither nameDe nor nameEn
        },
      ],
    };
    invoiceRef.current = invoiceWithCustomName as typeof MOCK_INVOICE_DE;
    installFetchSpy();
    render(<InvoiceEdit />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getByDisplayValue("Sonderedition Produkt")).toBeInTheDocument());

    // Notice not shown yet (only appears after a language switch detects it)
    // Switch language — retranslation should detect the custom name and skip it
    fireEvent.change(screen.getByDisplayValue(/Deutsch \(DE\)/i), { target: { value: "en" } });

    // Custom name preserved; notice appears
    await waitFor(() => {
      expect(screen.getByDisplayValue("Sonderedition Produkt")).toBeInTheDocument();
      expect(screen.queryByDisplayValue("English Product")).not.toBeInTheDocument();
      expect(screen.getByText(/Manuell bearbeitet/i)).toBeInTheDocument();
    });
  });

  it("preserves a saved custom name after reload, then saves the canonical name after reset", async () => {
    const invoiceWithCustomName = {
      ...MOCK_INVOICE_DE,
      websiteCustomerId: 9,
      customer: { name: "Testkunde", country: "DE", company: null },
      items: [
        {
          ...MOCK_INVOICE_DE.items[0],
          productName: "Sonderedition Produkt", // saved custom name
        },
      ],
    };
    const savedBodies: Record<string, unknown>[] = [];
    invoiceRef.current = invoiceWithCustomName as unknown as typeof MOCK_INVOICE_DE;
    installFetchSpy(body => {
      savedBodies.push(body);
      const savedItems = body.items as Array<Record<string, unknown>>;
      invoiceRef.current = {
        ...invoiceRef.current,
        language: body.language as string,
        items: savedItems.map((item, index) => ({
          ...invoiceRef.current.items[index],
          ...item,
        })),
      };
    });

    const firstRender = render(<InvoiceEdit />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByDisplayValue("Sonderedition Produkt")).toBeInTheDocument();
    });

    // A language switch detects the saved custom name without overwriting it.
    fireEvent.change(screen.getByDisplayValue(/Deutsch \(DE\)/i), { target: { value: "en" } });
    await waitFor(() => {
      expect(screen.getByDisplayValue("Sonderedition Produkt")).toBeInTheDocument();
      expect(screen.getByText(/Manuell bearbeitet/i)).toBeInTheDocument();
    });

    // Save the custom name, then reopen the invoice from the saved PUT payload.
    fireEvent.click(screen.getByRole("button", { name: /^Speichern$/i }));
    await waitFor(() => expect(savedBodies).toHaveLength(1));
    expect((savedBodies[0].items as Array<Record<string, unknown>>)[0].productName)
      .toBe("Sonderedition Produkt");

    firstRender.unmount();
    render(<InvoiceEdit />, { wrapper: Wrapper });
    await waitFor(() => {
      expect(screen.getByDisplayValue("Sonderedition Produkt")).toBeInTheDocument();
    });

    // The reloaded custom name is detected again on the next language switch.
    fireEvent.change(screen.getByDisplayValue(/Englisch \(EN\)/i), { target: { value: "de" } });
    await waitFor(() => {
      expect(screen.getByDisplayValue("Sonderedition Produkt")).toBeInTheDocument();
      expect(screen.queryByDisplayValue("Deutsches Produkt")).not.toBeInTheDocument();
      expect(screen.getByText(/Manuell bearbeitet/i)).toBeInTheDocument();
    });

    // Reset and save: the canonical name for the selected language must be stored.
    fireEvent.click(screen.getByRole("button", { name: /Zurücksetzen/i }));
    await waitFor(() => {
      expect(screen.getByDisplayValue("Deutsches Produkt")).toBeInTheDocument();
      expect(screen.queryByText(/Manuell bearbeitet/i)).not.toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /^Speichern$/i }));
    await waitFor(() => expect(savedBodies).toHaveLength(2));
    expect((savedBodies[1].items as Array<Record<string, unknown>>)[0].productName)
      .toBe("Deutsches Produkt");
    expect(savedBodies[1].language).toBe("de");
  });
});
