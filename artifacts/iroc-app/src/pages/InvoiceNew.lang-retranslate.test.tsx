/**
 * Language retranslation test: InvoiceNew
 *
 * Confirms that when the admin adds a product-linked line item and then
 * switches the invoice language (de → en, or en → de), the productName
 * on that item is updated to the new language's name.
 *
 * Also confirms that unlinked (custom) items are left untouched.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import InvoiceNew from "./InvoiceNew";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ lang: "de" }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/invoices/new", vi.fn()],
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const PRODUCT = {
  id: 1,
  nameDe: "Deutsches Produkt",
  nameEn: "English Product",
  descriptionDe: "Deutsche Beschreibung",
  descriptionEn: "English description",
  sku: "SKU-001",
  unitPrice: "200.00",
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

// ── Fetch spy ─────────────────────────────────────────────────────────────────

interface OfferPdfBody {
  language: "de" | "en";
  items: Array<{ productName: string; description: string | null }>;
}

function installFetchSpy() {
  const postBodies: OfferPdfBody[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        input instanceof Request
          ? input.url
          : input instanceof URL
          ? input.toString()
          : (input as string);

      if (url.includes("/api/iroc/invoices/offer-pdf")) {
        postBodies.push(JSON.parse(String(init?.body)) as OfferPdfBody);
        return {
          ok: true,
          blob: async () => new Blob(["%PDF"], { type: "application/pdf" }),
        } as unknown as Response;
      }
      if (url.includes("/api/iroc/customers-combined"))
        return { ok: true, json: async () => [CUSTOMER] } as Response;
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
    }
  );
  return postBodies;
}

if (!URL.createObjectURL) {
  URL.createObjectURL = () => "blob:mock";
  URL.revokeObjectURL = () => {};
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

afterEach(() => vi.restoreAllMocks());

// ── Shared helpers ────────────────────────────────────────────────────────────

/** Find the product <select> on an item row (the one with the product option). */
function getProductSelect() {
  const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
  return selects.find(s =>
    Array.from(s.options).some(o => o.value === String(PRODUCT.id))
  )!;
}

/** Find the invoice-language <select> by its current displayed value. */
function getLangSelect(displayValue: string | RegExp) {
  return screen.getByDisplayValue(displayValue) as HTMLSelectElement;
}

/** Explicitly choose English when a test needs to start from that language. */
async function selectInitialEnglishInvoiceLanguage() {
  await screen.findByRole("heading", { name: /Neue Rechnung/i });
  fireEvent.change(getLangSelect(/Deutsch \(DE\)/i), { target: { value: "en" } });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("InvoiceNew — product names retranslate when invoice language is switched", () => {
  it("keeps linked names and descriptions synchronized through repeated language switches", async () => {
    installFetchSpy();
    render(<InvoiceNew />, { wrapper: Wrapper });

    // Do not select a customer: this keeps the transition independent from
    // destination-country language defaults. The document now starts in the
    // German admin language, so explicitly choose English for this sequence.
    await selectInitialEnglishInvoiceLanguage();
    fireEvent.click(await screen.findByRole("button", { name: /Artikel hinzufügen/i }));
    fireEvent.change(getProductSelect(), { target: { value: String(PRODUCT.id) } });
    await waitFor(() => {
      expect(screen.getByDisplayValue("English Product")).toBeInTheDocument();
      expect(screen.getByDisplayValue("English description")).toBeInTheDocument();
    });

    fireEvent.change(getLangSelect(/Englisch \(EN\)/i), { target: { value: "de" } });
    await waitFor(() => {
      expect(screen.getByDisplayValue("Deutsches Produkt")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Deutsche Beschreibung")).toBeInTheDocument();
    });

    fireEvent.change(getLangSelect(/Deutsch \(DE\)/i), { target: { value: "en" } });
    await waitFor(() => {
      expect(screen.getByDisplayValue("English Product")).toBeInTheDocument();
      expect(screen.getByDisplayValue("English description")).toBeInTheDocument();
    });

    fireEvent.change(getLangSelect(/Englisch \(EN\)/i), { target: { value: "de" } });
    await waitFor(() => {
      expect(screen.getByDisplayValue("Deutsches Produkt")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Deutsche Beschreibung")).toBeInTheDocument();
    });
  });

  it("de → en: linked item's productName updates to nameEn after switching", async () => {
    installFetchSpy();
    render(<InvoiceNew />, { wrapper: Wrapper });

    // 1. Select a customer
    const search = await screen.findByPlaceholderText(/Kunden suchen/i);
    fireEvent.focus(search);
    const custBtn = await screen.findByText(/Max Mustermann/);
    fireEvent.click(custBtn);

    // 2. Add a line item and pick the product (invoiceLang is "de" initially)
    const addBtn = screen.getByRole("button", { name: /Artikel hinzufügen/i });
    fireEvent.click(addBtn);

    const productSelect = getProductSelect();
    fireEvent.change(productSelect, { target: { value: String(PRODUCT.id) } });

    // Product name input should show the German name
    await waitFor(() => {
      expect(screen.getByDisplayValue("Deutsches Produkt")).toBeInTheDocument();
    });

    // 3. Switch invoice language to English
    const langSelect = getLangSelect(/Deutsch \(DE\)/i);
    fireEvent.change(langSelect, { target: { value: "en" } });

    // 4. Product name must update to the English name
    await waitFor(() => {
      expect(screen.getByDisplayValue("English Product")).toBeInTheDocument();
      expect(screen.queryByDisplayValue("Deutsches Produkt")).not.toBeInTheDocument();
    });
  });

  it("en → de: linked item's productName updates to nameDe after switching", async () => {
    installFetchSpy();
    render(<InvoiceNew />, { wrapper: Wrapper });

    // 1. Keep the actually rendered initial language explicit before selecting
    // a customer, whose country would otherwise supply a default.
    await selectInitialEnglishInvoiceLanguage();

    // 2. Select a customer
    const search = await screen.findByPlaceholderText(/Kunden suchen/i);
    fireEvent.focus(search);
    const custBtn = await screen.findByText(/Max Mustermann/);
    fireEvent.click(custBtn);

    // 3. Add item and pick product (invoiceLang is "en")
    const addBtn = screen.getByRole("button", { name: /Artikel hinzufügen/i });
    fireEvent.click(addBtn);

    const productSelect = getProductSelect();
    fireEvent.change(productSelect, { target: { value: String(PRODUCT.id) } });

    // Product name should show the English name
    await waitFor(() => {
      expect(screen.getByDisplayValue("English Product")).toBeInTheDocument();
    });

    // 4. Switch invoice language back to German
    const langSelect = getLangSelect(/Englisch \(EN\)/i);
    fireEvent.change(langSelect, { target: { value: "de" } });

    // 5. Product name must update to the German name
    await waitFor(() => {
      expect(screen.getByDisplayValue("Deutsches Produkt")).toBeInTheDocument();
      expect(screen.queryByDisplayValue("English Product")).not.toBeInTheDocument();
    });
  });

  it("retranslated name appears in the offer-pdf payload", async () => {
    const postBodies = installFetchSpy();
    render(<InvoiceNew />, { wrapper: Wrapper });

    // Select customer
    const search = await screen.findByPlaceholderText(/Kunden suchen/i);
    fireEvent.focus(search);
    const custBtn = await screen.findByText(/Max Mustermann/);
    fireEvent.click(custBtn);

    // Add item and pick product (de)
    const addBtn = screen.getByRole("button", { name: /Artikel hinzufügen/i });
    fireEvent.click(addBtn);
    fireEvent.change(getProductSelect(), { target: { value: String(PRODUCT.id) } });
    await waitFor(() => expect(screen.getByDisplayValue("Deutsches Produkt")).toBeInTheDocument());

    // Switch invoice lang to en
    fireEvent.change(getLangSelect(/Deutsch \(DE\)/i), { target: { value: "en" } });
    await waitFor(() => expect(screen.getByDisplayValue("English Product")).toBeInTheDocument());

    // Trigger offer PDF
    const offerBtn = screen.getByRole("button", { name: /Angebot \(PDF\)/i });
    fireEvent.click(offerBtn);
    await waitFor(() => expect(postBodies.length).toBe(1));

    expect(postBodies[0].language).toBe("en");
    expect(postBodies[0].items[0].productName).toBe("English Product");
    expect(postBodies[0].items[0].description).toBe("English description");
  });

  it("clears a linked product description when the target language has no Product form description", async () => {
    const originalEnglishDescription = PRODUCT.descriptionEn;
    PRODUCT.descriptionEn = "";
    try {
      installFetchSpy();
      render(<InvoiceNew />, { wrapper: Wrapper });

      const search = await screen.findByPlaceholderText(/Kunden suchen/i);
      fireEvent.focus(search);
      fireEvent.click(await screen.findByText(/Max Mustermann/));

      fireEvent.click(await screen.findByRole("button", { name: /Artikel hinzufügen/i }));
      fireEvent.change(getProductSelect(), { target: { value: String(PRODUCT.id) } });
      expect(screen.getByDisplayValue("Deutsche Beschreibung")).toBeInTheDocument();

      fireEvent.change(getLangSelect(/Deutsch \(DE\)/i), { target: { value: "en" } });
      await waitFor(() => {
        expect(screen.queryByDisplayValue("Deutsche Beschreibung")).not.toBeInTheDocument();
      });
    } finally {
      PRODUCT.descriptionEn = originalEnglishDescription;
    }
  });

  it("unlinked custom items are not affected by a language switch", async () => {
    installFetchSpy();
    render(<InvoiceNew />, { wrapper: Wrapper });

    // Keep the actually rendered initial language explicit before adding the
    // custom item, so the switch below is deterministic.
    await selectInitialEnglishInvoiceLanguage();

    // Add a custom item (no product selected) and type a name manually
    const addBtn = await screen.findByRole("button", { name: /Artikel hinzufügen/i });
    fireEvent.click(addBtn);

    const nameInput = screen.getByPlaceholderText("Produktname") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Mein eigener Artikel" } });
    expect(nameInput.value).toBe("Mein eigener Artikel");

    // Switch invoice language
    const langSelect = getLangSelect(/Englisch \(EN\)/i);
    fireEvent.change(langSelect, { target: { value: "de" } });

    // Custom item name must not change
    await waitFor(() => {
      expect(screen.getByDisplayValue("Mein eigener Artikel")).toBeInTheDocument();
    });
  });
});

describe("InvoiceNew — manually edited product name protection", () => {
  it("manually edited linked name is NOT overwritten on language switch", async () => {
    installFetchSpy();
    render(<InvoiceNew />, { wrapper: Wrapper });

    // Select a customer
    const search = await screen.findByPlaceholderText(/Kunden suchen/i);
    fireEvent.focus(search);
    fireEvent.click(await screen.findByText(/Max Mustermann/));

    // Add item and pick product (lang = de)
    fireEvent.click(screen.getByRole("button", { name: /Artikel hinzufügen/i }));
    fireEvent.change(getProductSelect(), { target: { value: String(PRODUCT.id) } });
    await waitFor(() => expect(screen.getByDisplayValue("Deutsches Produkt")).toBeInTheDocument());

    // Manually edit the product name
    const nameInput = screen.getByDisplayValue("Deutsches Produkt") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Deutsches Produkt XL" } });
    await waitFor(() => expect(screen.getByDisplayValue("Deutsches Produkt XL")).toBeInTheDocument());

    // Switch language to English
    fireEvent.change(getLangSelect(/Deutsch \(DE\)/i), { target: { value: "en" } });

    // Manually edited name must be preserved — NOT replaced with "English Product"
    await waitFor(() => {
      expect(screen.getByDisplayValue("Deutsches Produkt XL")).toBeInTheDocument();
      expect(screen.queryByDisplayValue("English Product")).not.toBeInTheDocument();
    });
  });

  it("shows the 'manually edited' notice after editing a linked name", async () => {
    installFetchSpy();
    render(<InvoiceNew />, { wrapper: Wrapper });

    // Select customer and add product item
    const search = await screen.findByPlaceholderText(/Kunden suchen/i);
    fireEvent.focus(search);
    fireEvent.click(await screen.findByText(/Max Mustermann/));
    fireEvent.click(screen.getByRole("button", { name: /Artikel hinzufügen/i }));
    fireEvent.change(getProductSelect(), { target: { value: String(PRODUCT.id) } });
    await waitFor(() => expect(screen.getByDisplayValue("Deutsches Produkt")).toBeInTheDocument());

    // The notice must not appear before editing
    expect(screen.queryByText(/Manuell bearbeitet/i)).not.toBeInTheDocument();

    // Edit the product name
    fireEvent.change(screen.getByDisplayValue("Deutsches Produkt"), { target: { value: "Deutsches Produkt Plus" } });

    // The inline notice must appear
    await waitFor(() => {
      expect(screen.getByText(/Manuell bearbeitet/i)).toBeInTheDocument();
    });
  });

  it("reset button restores canonical name for the current language and removes the notice", async () => {
    installFetchSpy();
    render(<InvoiceNew />, { wrapper: Wrapper });

    // Select customer and add product item
    const search = await screen.findByPlaceholderText(/Kunden suchen/i);
    fireEvent.focus(search);
    fireEvent.click(await screen.findByText(/Max Mustermann/));
    fireEvent.click(screen.getByRole("button", { name: /Artikel hinzufügen/i }));
    fireEvent.change(getProductSelect(), { target: { value: String(PRODUCT.id) } });
    await waitFor(() => expect(screen.getByDisplayValue("Deutsches Produkt")).toBeInTheDocument());

    // Edit the name to trigger the notice
    fireEvent.change(screen.getByDisplayValue("Deutsches Produkt"), { target: { value: "Eigener Name" } });
    await waitFor(() => expect(screen.getByText(/Manuell bearbeitet/i)).toBeInTheDocument());

    // Click the reset button (↩ Zurücksetzen)
    fireEvent.click(screen.getByRole("button", { name: /Zurücksetzen/i }));

    // Canonical German name restored; notice gone
    await waitFor(() => {
      expect(screen.getByDisplayValue("Deutsches Produkt")).toBeInTheDocument();
      expect(screen.queryByText(/Manuell bearbeitet/i)).not.toBeInTheDocument();
    });
  });

  it("editing name back to a canonical value clears the notice without using reset", async () => {
    installFetchSpy();
    render(<InvoiceNew />, { wrapper: Wrapper });

    const search = await screen.findByPlaceholderText(/Kunden suchen/i);
    fireEvent.focus(search);
    fireEvent.click(await screen.findByText(/Max Mustermann/));
    fireEvent.click(screen.getByRole("button", { name: /Artikel hinzufügen/i }));
    fireEvent.change(getProductSelect(), { target: { value: String(PRODUCT.id) } });
    await waitFor(() => expect(screen.getByDisplayValue("Deutsches Produkt")).toBeInTheDocument());

    // Edit to a custom name
    fireEvent.change(screen.getByDisplayValue("Deutsches Produkt"), { target: { value: "Irgendetwas" } });
    await waitFor(() => expect(screen.getByText(/Manuell bearbeitet/i)).toBeInTheDocument());

    // Type the canonical EN name — also counts as canonical so notice should clear
    fireEvent.change(screen.getByDisplayValue("Irgendetwas"), { target: { value: "English Product" } });
    await waitFor(() => {
      expect(screen.queryByText(/Manuell bearbeitet/i)).not.toBeInTheDocument();
    });
  });
});
