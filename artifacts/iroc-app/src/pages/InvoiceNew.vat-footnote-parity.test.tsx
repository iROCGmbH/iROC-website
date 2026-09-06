/**
 * VAT footnote parity tests for the new-invoice form.
 *
 * The textarea is the admin's source of truth before saving. Every supported
 * regular invoice type and invoice language must show the shared legal text,
 * and resetting a manual edit must submit null so the PDF can recompute it.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { computeDefaultVatNote } from "@workspace/api-zod";
import InvoiceNew from "./InvoiceNew";

const createState = vi.hoisted(() => ({ mutate: vi.fn() }));

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
  useCreateIrocInvoice: () => ({ mutate: createState.mutate, isPending: false }),
}));

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

function installFetchSpy() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const url = input instanceof Request
      ? input.url
      : input instanceof URL
      ? input.toString()
      : String(input);
    if (url.includes("/api/iroc/customers-combined")) {
      return { ok: true, json: async () => [CUSTOMER] } as Response;
    }
    if (url.includes("/api/iroc/inventory")) {
      return {
        ok: true,
        json: async () => [
          { id: 1, productId: PRODUCT.id, lotNumber: "LOT-1", quantityReceived: 5, quantityUsed: 0 },
        ],
      } as Response;
    }
    if (url.includes("/api/iroc/invoices/next-number")) {
      return { ok: true, json: async () => ({ nextNumber: "2026-9999" }) } as Response;
    }
    if (url.includes("/api/iroc/invoice-items/last-discount")) {
      return { ok: true, json: async () => ({ discountPercent: null }) } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 0 } },
    })}>
      {children}
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  createState.mutate.mockReset();
});

describe("InvoiceNew — VAT footnote shown in the form", () => {
  it.each([
    ["domestic", "de"],
    ["eu", "de"],
    ["export", "de"],
    ["noneu", "de"],
    ["domestic", "en"],
    ["eu", "en"],
    ["export", "en"],
    ["noneu", "en"],
  ] as const)(
    "shows the shared default for %s invoices in %s",
    async (invoiceType, invoiceLang) => {
      installFetchSpy();
      render(<InvoiceNew />, { wrapper: Wrapper });

      const typeSelect = await screen.findByDisplayValue(/Inland \(19 % MwSt\.\)/i) as HTMLSelectElement;
      // The invoice language defaults from the customer context, so do not
      // assume the initially selected label. Identify this select by its
      // stable DE/EN option values instead.
      const languageSelect = (screen.getAllByRole("combobox") as HTMLSelectElement[])
        .find(select => Array.from(select.options).some(option => option.value === "de")
          && Array.from(select.options).some(option => option.value === "en"));
      expect(languageSelect).toBeDefined();

      fireEvent.change(typeSelect, { target: { value: invoiceType } });
      fireEvent.change(languageSelect!, { target: { value: invoiceLang } });

      await waitFor(() => {
        const textarea = (screen.getAllByRole("textbox") as HTMLTextAreaElement[])
          .find(element => element.value === computeDefaultVatNote(invoiceType, invoiceLang));
        expect(textarea).toBeDefined();
        expect(textarea!.value).toBe(computeDefaultVatNote(invoiceType, invoiceLang));
      });
    },
  );

  it("submits null after a manual footnote edit is reset, while showing the default again", async () => {
    installFetchSpy();
    render(<InvoiceNew />, { wrapper: Wrapper });

    const search = await screen.findByPlaceholderText(/Kunden suchen/i);
    fireEvent.focus(search);
    fireEvent.click(await screen.findByText(/Max Mustermann/));

    fireEvent.click(screen.getByRole("button", { name: /Artikel hinzufügen/i }));
    const productSelect = (screen.getAllByRole("combobox") as HTMLSelectElement[]).find(select =>
      Array.from(select.options).some(option => option.value === String(PRODUCT.id)),
    );
    expect(productSelect).toBeDefined();
    fireEvent.change(productSelect!, { target: { value: String(PRODUCT.id) } });

    const vatTextarea = screen.getByDisplayValue("** Steuerpflichtige Lieferung.") as HTMLTextAreaElement;
    fireEvent.change(vatTextarea, { target: { value: "Manually edited VAT note" } });
    fireEvent.click(screen.getByRole("button", { name: /Zurücksetzen/i }));

    await waitFor(() => {
      expect((screen.getByDisplayValue("** Steuerpflichtige Lieferung.") as HTMLTextAreaElement).value)
        .toBe("** Steuerpflichtige Lieferung.");
    });

    fireEvent.click(screen.getByRole("button", { name: /Erstellen/i }));
    await waitFor(() => expect(createState.mutate).toHaveBeenCalledTimes(1));
    expect(createState.mutate.mock.calls[0][0].data.vatNote).toBeNull();
  });
});