/**
 * Invoice-language independence test: InvoiceNew
 *
 * The form separates two languages:
 *   – UI language (admin labels, dropdowns)   → useLanguage().lang
 *   – Invoice language (PDF content: vatNote, product names, payload) → invoiceLang select
 *
 * Confirms, with the two languages deliberately DIFFERENT:
 *   1. UI "en" + invoice "de": vatNote preview is German, product name from
 *      the picker is nameDe, and the offer-pdf payload carries language "de"
 *      with the German productName — while form labels stay English.
 *   2. UI "de" + invoice "en": the mirror case.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import InvoiceNew from "./InvoiceNew";

// ── Mutable UI language (hoisted so the mock factory can close over it) ──────
const uiLangRef = vi.hoisted(() => ({ current: "en" as "en" | "de" }));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ lang: uiLangRef.current }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/invoices/new", vi.fn()],
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const PRODUCT = {
  id: 1,
  nameDe: "Deutscher Produktname",
  nameEn: "English Product Name",
  descriptionDe: "Deutsche Beschreibung",
  descriptionEn: "English description",
  sku: "SKU-1",
  unitPrice: "100.00",
  category: "cellenis",
};

vi.mock("@workspace/api-client-react", () => ({
  useListIrocProducts: () => ({ data: [PRODUCT] }),
  useListIrocProductGroups: () => ({ data: [] }),
  useCreateIrocInvoice: () => ({ mutate: vi.fn(), isPending: false }),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CUSTOMER = {
  source: "website",
  id: 10,
  customerNr: "2026-0001",
  salutation: "Herr",
  title: null,
  name: "Max Mustermann",
  company: null,
  email: "max@example.com",
  country: "DE",
  city: "München",
  isEu: false,
  vatId: null,
  irocCustomerId: null,
};

// ── Fetch spy: also captures the offer-pdf POST body ─────────────────────────

interface OfferPdfBody {
  language: "de" | "en";
  vatNote: string | null;
  items: Array<{ productName: string }>;
}

function installFetchSpy(customers: typeof CUSTOMER[] = [CUSTOMER]) {
  const offerBodies: OfferPdfBody[] = [];
  const spy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        input instanceof Request
          ? input.url
          : input instanceof URL
          ? input.toString()
          : (input as string);

      if (url.includes("/api/iroc/invoices/offer-pdf")) {
        offerBodies.push(JSON.parse(String(init?.body)) as OfferPdfBody);
        return {
          ok: true,
          blob: async () => new Blob(["%PDF"], { type: "application/pdf" }),
        } as unknown as Response;
      }
      if (url.includes("/api/iroc/customers-combined"))
        return { ok: true, json: async () => customers } as Response;
      if (url.includes("/api/iroc/inventory"))
        return {
          ok: true,
          json: async () => [
            { id: 1, productId: PRODUCT.id, lotNumber: "LOT-1", quantityReceived: 5, quantityUsed: 0 },
          ],
        } as Response;
      if (url.includes("/api/iroc/invoices/next-number"))
        return { ok: true, json: async () => ({ nextNumber: "2026-9999" }) } as Response;
      if (url.includes("/api/iroc/invoice-items/last-discount"))
        return { ok: true, json: async () => ({ discountPercent: null }) } as Response;
      return { ok: true, json: async () => ({}) } as Response;
    });
  return { spy, offerBodies };
}

// jsdom lacks URL.createObjectURL
if (!URL.createObjectURL) {
  URL.createObjectURL = () => "blob:mock";
  URL.revokeObjectURL = () => {};
}

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

// ── Shared flow: select customer, add item, pick product ─────────────────────

async function selectCustomerAndProduct(
  searchPlaceholder: RegExp,
  customerName: RegExp = /Max Mustermann/,
) {
  const search = await screen.findByPlaceholderText(searchPlaceholder);
  fireEvent.focus(search);
  // Dropdown renders "[salutation] [title] name" → match by regex
  const custBtn = await screen.findByText(customerName);
  fireEvent.click(custBtn);

  // Add an item row
  const addBtn = screen.getByRole("button", { name: /Add Item|Artikel hinzufügen/i });
  fireEvent.click(addBtn);

  // Pick the product in the row's product select (has "Custom Item…"/"Eigene Position…" option)
  const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
  const productSelect = selects.find(s =>
    Array.from(s.options).some(o => o.value === String(PRODUCT.id)),
  )!;
  expect(productSelect).toBeDefined();
  fireEvent.change(productSelect, { target: { value: String(PRODUCT.id) } });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("InvoiceNew — invoice language independent of UI language", () => {
  it("UI en + invoice de: vatNote, product name, and offer payload are German; labels stay English", async () => {
    uiLangRef.current = "en";
    const { offerBodies } = installFetchSpy();
    render(<InvoiceNew />, { wrapper: Wrapper });

    // UI is English → labels in English
    expect(await screen.findByText("Language *")).toBeInTheDocument();
    expect(screen.getByText("Type *")).toBeInTheDocument();

    // No customer is selected yet, so the safe default is English.
    expect(screen.getByDisplayValue("English (EN)")).toBeInTheDocument();

    await selectCustomerAndProduct(/Search customer/i);

    // A German customer switches the invoice language to German despite English UI.
    await waitFor(() => {
      expect(screen.getByDisplayValue("German (DE)")).toBeInTheDocument();
      expect(
        screen.getByDisplayValue("** Steuerpflichtige Lieferung."),
      ).toBeInTheDocument();
    });
    // Labels still English
    expect(screen.getByText("Language *")).toBeInTheDocument();

    // Product name filled from nameDe because invoice language is de
    await waitFor(() => {
      expect(screen.getByDisplayValue("Deutscher Produktname")).toBeInTheDocument();
    });

    // Offer PDF payload must carry language "de" and the German product name
    const offerBtn = screen.getByRole("button", { name: /Offer \(PDF\)/i });
    fireEvent.click(offerBtn);
    await waitFor(() => expect(offerBodies.length).toBe(1));
    expect(offerBodies[0].language).toBe("de");
    expect(offerBodies[0].items[0].productName).toBe("Deutscher Produktname");
    // Generated defaults are not persisted; the PDF recomputes the note from
    // invoice language and type.
    expect(offerBodies[0].vatNote).toBeNull();
  });

  it("UI de + invoice en: vatNote, product name, and offer payload are English; labels stay German", async () => {
    uiLangRef.current = "de";
    const { offerBodies } = installFetchSpy();
    render(<InvoiceNew />, { wrapper: Wrapper });

    // UI is German → labels in German
    expect(await screen.findByText("Sprache *")).toBeInTheDocument();
    expect(screen.getByText("Typ *")).toBeInTheDocument();

    // A German customer defaults to German regardless of the admin UI language.
    await selectCustomerAndProduct(/Kunden suchen/i);
    expect(screen.getByDisplayValue("Deutsch (DE)")).toBeInTheDocument();

    // Explicitly override the customer-based default to English.
    const langSelect = screen.getByDisplayValue("Deutsch (DE)") as HTMLSelectElement;
    fireEvent.change(langSelect, { target: { value: "en" } });

    // vatNote must switch to English despite German UI
    await waitFor(() => {
      expect(screen.getByDisplayValue("** Subject to VAT.")).toBeInTheDocument();
    });
    // Labels still German
    expect(screen.getByText("Sprache *")).toBeInTheDocument();

    // Product name filled from nameEn because invoice language is en
    await waitFor(() => {
      expect(screen.getByDisplayValue("English Product Name")).toBeInTheDocument();
    });

    // Offer PDF payload must carry language "en" and the English product name
    const offerBtn = screen.getByRole("button", { name: /Angebot \(PDF\)/i });
    fireEvent.click(offerBtn);
    await waitFor(() => expect(offerBodies.length).toBe(1));
    expect(offerBodies[0].language).toBe("en");
    expect(offerBodies[0].items[0].productName).toBe("English Product Name");
    // Generated defaults are not persisted; the PDF recomputes the note from
    // invoice language and type.
    expect(offerBodies[0].vatNote).toBeNull();
  });

  it("defaults Austria to German and a non-German destination to English", async () => {
    uiLangRef.current = "en";
    const austrianCustomer = { ...CUSTOMER, country: "Österreich" };
    installFetchSpy([austrianCustomer]);
    render(<InvoiceNew />, { wrapper: Wrapper });

    await selectCustomerAndProduct(/Search customer/i);
    expect(screen.getByDisplayValue("German (DE)")).toBeInTheDocument();
  });

  it("keeps a manual language override when the customer changes", async () => {
    uiLangRef.current = "en";
    const swissCustomer = { ...CUSTOMER, id: 11, name: "Anna Beispiel", country: "Switzerland" };
    installFetchSpy([swissCustomer]);
    render(<InvoiceNew />, { wrapper: Wrapper });

    const langSelect = await screen.findByDisplayValue("English (EN)") as HTMLSelectElement;
    fireEvent.change(langSelect, { target: { value: "de" } });

    await selectCustomerAndProduct(/Search customer/i, /Anna Beispiel/);

    expect(screen.getByDisplayValue("German (DE)")).toBeInTheDocument();
  });

  it("submits the selected customer-based language in the invoice payload", async () => {
    uiLangRef.current = "en";
    const { offerBodies } = installFetchSpy([{ ...CUSTOMER, country: "Switzerland" }]);
    render(<InvoiceNew />, { wrapper: Wrapper });

    await selectCustomerAndProduct(/Search customer/i);
    expect(screen.getByDisplayValue("English (EN)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Offer \(PDF\)/i }));
    await waitFor(() => expect(offerBodies).toHaveLength(1));
    expect(offerBodies[0].language).toBe("en");
  });
});
