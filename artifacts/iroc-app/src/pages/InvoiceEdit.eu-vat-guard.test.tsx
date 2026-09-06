/**
 * InvoiceEdit — EU VAT guard: API 400 surfaces in the form's error state
 *
 * What & Why
 * ──────────
 * The API rejects PUT /iroc/invoices/:id when invoiceType is a zero-VAT type
 * but vatRate is non-zero.  This test confirms that InvoiceEdit renders the
 * exact error message from the API response body in a visible alert element,
 * rather than swallowing the 400 or showing a generic failure message.
 *
 * Strategy
 * ────────
 * 1. Render InvoiceEdit with a draft invoice that has a customer + one item
 *    already loaded (so the save button is enabled without further interaction).
 * 2. Wait for the form to finish initialising by polling for the item's
 *    product-name input value (items render as <input> elements).
 * 3. Intercept PUT via a fetch spy and return HTTP 400 +
 *    { error: "<the guard message>" }.
 * 4. Click Save and assert the guard message appears in role="alert".
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
  useLanguage: () => ({ lang: "en" }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/invoices/55/edit", vi.fn()],
  useParams:   () => ({ id: "55" }),
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

/**
 * Draft invoice fixture: domestic, 19 % VAT, customer + one item set so that
 * the save button is immediately enabled when the component renders.
 */
const MOCK_INVOICE = {
  id:              55,
  invoiceNumber:   "2026-0055",
  status:          "draft",
  invoiceType:     "domestic",
  language:        "en",
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
  websiteCustomerId: 10,
  customer: { name: "Anna Muster", country: "Frankreich", company: null },
  items: [
    {
      id: 1,
      productId: null,
      productName: "iROC Device",
      sku: null,
      description: null,
      lotNumber: null,
      hsCode: null,
      countryOfOrigin: null,
      weightKg: null,
      unitPrice: "1000.00",
      discountPercent: null,
      isDemo: false,
      quantity: 1,
    },
  ],
};

vi.mock("@workspace/api-client-react", () => ({
  useListIrocProducts:          () => ({ data: [] }),
  useListIrocProductGroups: () => ({ data: [] }),
  useGetIrocInvoice:            () => ({ data: MOCK_INVOICE, isLoading: false }),
  getGetIrocInvoiceQueryKey:    (id: number) => ["iroc", "invoices", id],
  getListIrocInvoicesQueryKey:  () => ["iroc", "invoices"],
}));

// ── Constants ─────────────────────────────────────────────────────────────────

/** The exact guard message the API returns for EU + non-zero VAT. */
const EU_VAT_ERROR =
  "Invoice type 'eu' requires a 0 % VAT rate. The saved VAT rate (19 %) is incompatible with this type.";

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

/**
 * Build a fetch spy that:
 *   - succeeds for GET side-effect calls (customers-combined, inventory)
 *   - returns the supplied response for the first PUT to invoices/55
 *   - falls back to a 200 {} for subsequent PUT calls
 */
function installFetchSpy(
  firstPutResponse: Partial<Response> & { ok: boolean },
  secondPutResponse?: Partial<Response> & { ok: boolean },
) {
  let putCallCount = 0;
  return vi.spyOn(globalThis, "fetch").mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"   ? input
        : input instanceof URL      ? input.toString()
        : (input as Request).url;
      const method =
        init?.method?.toUpperCase() ??
        (input instanceof Request ? input.method.toUpperCase() : "GET");

      if (url.includes("/api/iroc/customers-combined"))
        return { ok: true, status: 200, json: async () => [] } as unknown as Response;
      if (url.includes("/api/iroc/inventory"))
        return { ok: true, status: 200, json: async () => [] } as unknown as Response;

      if (method === "PUT" && url.includes("/api/iroc/invoices/55")) {
        putCallCount++;
        if (putCallCount === 1) return firstPutResponse as unknown as Response;
        return (secondPutResponse ?? { ok: true, status: 200, json: async () => ({}) }) as unknown as Response;
      }

      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    },
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("InvoiceEdit — EU VAT guard surfaced in the form", () => {
  it("renders the API error message when PUT returns 400 with the EU VAT incompatibility body", async () => {
    installFetchSpy({
      ok:         false,
      status:     400,
      statusText: "Bad Request",
      json:       async () => ({ error: EU_VAT_ERROR }),
    });

    render(<InvoiceEdit />, { wrapper: Wrapper });

    // Items are rendered as <input> elements — poll for the product-name value.
    await screen.findByDisplayValue("iROC Device");

    // Click Save — the PUT fires and returns 400.
    const saveButton = screen.getByRole("button", { name: /save/i });
    fireEvent.click(saveButton);

    // The guard message must appear in a role="alert" element.
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(EU_VAT_ERROR);
    });
  });

  it("clears the previous error when the admin retries a save that succeeds", async () => {
    installFetchSpy(
      // First PUT → 400 with guard error
      {
        ok:         false,
        status:     400,
        statusText: "Bad Request",
        json:       async () => ({ error: EU_VAT_ERROR }),
      },
      // Second PUT → 200 (navigate away is absorbed by wouter mock)
      {
        ok:     true,
        status: 200,
        json:   async () => ({ ...MOCK_INVOICE, vatRate: "0.00" }),
      },
    );

    render(<InvoiceEdit />, { wrapper: Wrapper });
    await screen.findByDisplayValue("iROC Device");

    const saveButton = screen.getByRole("button", { name: /save/i });

    // First save → error appears
    fireEvent.click(saveButton);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(EU_VAT_ERROR),
    );

    // Second save → succeeds; error must no longer be shown
    fireEvent.click(saveButton);
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
  });

  it("submits 0 % VAT after changing a reduced-rate domestic invoice to EU", async () => {
    let submittedPayload: Record<string, unknown> | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string" ? input
          : input instanceof URL ? input.toString()
          : (input as Request).url;
        const method =
          init?.method?.toUpperCase() ??
          (input instanceof Request ? input.method.toUpperCase() : "GET");

        if (method === "PUT" && url.includes("/api/iroc/invoices/55")) {
          submittedPayload = JSON.parse(String(init?.body));
          return { ok: true, status: 200, json: async () => MOCK_INVOICE } as unknown as Response;
        }
        return { ok: true, status: 200, json: async () => [] } as unknown as Response;
      },
    );

    render(<InvoiceEdit />, { wrapper: Wrapper });
    const vatSelect = await screen.findByDisplayValue(/Standard rate/i);
    fireEvent.change(vatSelect, { target: { value: "7" } });
    await screen.findByDisplayValue(/Reduced rate/i);

    fireEvent.change(screen.getByDisplayValue("Domestic (19% VAT)"), {
      target: { value: "eu" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(submittedPayload).not.toBeNull());
    expect(submittedPayload).toMatchObject({
      invoiceType: "eu",
      vatRate: "0.00",
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
