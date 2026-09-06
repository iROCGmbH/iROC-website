/**
 * InvoiceDetail – type label in the detail view
 *
 * Confirms that lecture-eu and lecture-noneu invoices render human-readable
 * labels ("Vortrag EU" / "Vortrag Nicht-EU" in German, "Lecture EU" /
 * "Lecture Non-EU" in English) in the type row, and that no raw type string
 * (e.g. "lecture-eu") ever leaks through.
 *
 * The standard types (domestic, eu, export, noneu) are also exercised so
 * getInvoiceTypeLabel() is confirmed end-to-end in the detail view.
 *
 * A final suite simulates a type mutation resolving (domestic → lecture-eu,
 * etc.) and confirms the detail view reflects the new label without any
 * manual re-render call.  The test is authoritative: it fails if the component
 * stops registering an onSuccess handler or stops invalidating the invoice
 * query after a status/type update.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import InvoiceDetail from "./InvoiceDetail";
import { IROC_DASHBOARD_QUERY_KEY } from "@/lib/query-keys";

// ── Mutable state read by the hoisted mock factories ─────────────────────────
// NOTE: these must be `let`, not `const`, so the mock factory sees the updated
// value on each render call (the factory closes over the variable, not a
// snapshot of it).

let mockInvoiceType = "domestic";
let mockLang: "de" | "en" = "de";
let mockInvoiceLanguage: "de" | "en" = "de";
let mockInvoiceStatus = "draft";

type MockInvoiceItem = {
  id: number;
  productId: number | null;
  productName: string;
  sku: string | null;
  description: string | null;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  discountPercent: string;
  isDemo: boolean;
  lotNumber: string | null;
  hsCode: string | null;
  countryOfOrigin: string | null;
  weightKg: string | null;
};

const STABLE_ITEMS: never[] = [];
let mockInvoiceItems: MockInvoiceItem[] = STABLE_ITEMS;

// Captured by the useUpdateIrocInvoiceStatus mock so tests can fire it directly.
let capturedOnSuccess: (() => void) | undefined;
let capturedMutate: ReturnType<typeof vi.fn> | undefined;
let capturedCorrectionMutate: ReturnType<typeof vi.fn> | undefined;

// Stable customer / items references: the InvoiceDetail useEffect depends on
// invoice.items identity.  A new [] on every call would trigger an infinite
// re-render loop.  We reuse the same stable objects so the effect only fires once.
const STABLE_CUSTOMER = {
  name:       "Test Kunde",
  salutation: null,
  title:      null,
  company:    null,
  address:    null,
  postalCode: null,
  city:       null,
  country:    "Germany",
  email:      null,
  phone:      null,
  vatId:      null,
};

// Helper used inside both the mock factory and the test helpers.
function buildMockInvoice() {
  return {
    id:              1,
    invoiceNumber:   "RE-2024-0001",
    status:          mockInvoiceStatus,
    invoiceType:     mockInvoiceType,
    language:        mockInvoiceLanguage,
    issueDate:       "2024-01-15",
    dueDate:         "2024-02-15",
    orderNumber:     null,
    shippingMethod:  null,
    termsOfDelivery: null,
    notes:           null,
    vatNote:         null,
    total:           "100.00",
    subtotal:        "84.03",
    vatAmount:       "15.97",
    vatRate:         "0.19",
    deliveryCosts:   "0.00",
    customer:        STABLE_CUSTOMER,
    items:           mockInvoiceItems,
  };
}

// ── Module mocks ──────────────────────────────────────────────────────────────
//
// useGetIrocInvoice is mocked via the real useQuery hook (async factory so we
// can import it).  This means:
//   • data is available immediately via initialData → existing synchronous
//     assertions keep working.
//   • queryClient.invalidateQueries() triggers a real refetch → the queryFn
//     reads the current mockInvoiceType → the component re-renders via React
//     Query's own reactivity, without any manual rerender() call.

vi.mock("@workspace/api-client-react", async () => {
  const { useQuery } = await import("@tanstack/react-query");

  return {
    useGetIrocInvoice: (id: number, opts?: { query?: Record<string, unknown> }) => {
      const queryKey = (opts?.query?.queryKey as unknown[]) ?? ["iroc", "invoices", id];
      // Spread component opts (e.g. enabled) but always use our queryFn so
      // the component cannot accidentally override it.
      const { queryFn: _ignored, ...restOpts } = (opts?.query ?? {}) as Record<string, unknown>;
      return useQuery({
        queryKey,
        queryFn:     () => Promise.resolve(buildMockInvoice()),
        initialData: buildMockInvoice(),
        ...restOpts,
      });
    },
    useUpdateIrocInvoiceStatus: (opts?: { mutation?: { onSuccess?: () => void } }) => {
      capturedOnSuccess = opts?.mutation?.onSuccess;
      capturedMutate = vi.fn();
      return { mutate: capturedMutate, isPending: false };
    },
    useDeleteIrocInvoice:      () => ({ mutate: vi.fn(), isPending: false }),
    useCreateIrocInvoiceCorrection: () => {
      capturedCorrectionMutate = vi.fn();
      return { mutate: capturedCorrectionMutate, isPending: false };
    },
    useListIrocProducts:       () => ({ data: [] }),
    getGetIrocInvoiceQueryKey: (id: number) => ["iroc", "invoices", id],
    getListIrocInvoicesQueryKey: () => ["iroc", "invoices"],
  };
});

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ lang: mockLang }),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/invoices/1", vi.fn()],
  useParams:   () => ({ id: "1" }),
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Creates a QueryClient with staleTime: Infinity so that the initialData is
 * never refetched in the background during synchronous label tests – the
 * assertion sees exactly what was rendered from the seed data.
 */
function renderDetail() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <InvoiceDetail />
    </QueryClientProvider>
  );
}

/**
 * Creates a QueryClient with staleTime: 0 for the edit-survival tests so that
 * calling invalidateQueries() immediately triggers a refetch through the mocked
 * queryFn, which reads the updated mockInvoiceType.
 */
function renderDetailForEdit() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  const ui = render(
    <QueryClientProvider client={qc}>
      <InvoiceDetail />
    </QueryClientProvider>
  );
  return { ...ui, qc };
}

// ── Tests – German ────────────────────────────────────────────────────────────

describe("InvoiceDetail – type label (German)", () => {
  beforeEach(() => {
    mockLang = "de";
    mockInvoiceLanguage = "de";
  });

  it("shows 'Vortrag EU' for a lecture-eu invoice", () => {
    mockInvoiceType = "lecture-eu";
    renderDetail();
    expect(screen.getByText("Vortrag EU")).toBeInTheDocument();
  });

  it("shows 'Vortrag Nicht-EU' for a lecture-noneu invoice", () => {
    mockInvoiceType = "lecture-noneu";
    renderDetail();
    expect(screen.getByText("Vortrag Nicht-EU")).toBeInTheDocument();
  });

  it("does not render the raw string 'lecture-eu'", () => {
    mockInvoiceType = "lecture-eu";
    renderDetail();
    expect(screen.queryByText("lecture-eu")).not.toBeInTheDocument();
  });

  it("does not render the raw string 'lecture-noneu'", () => {
    mockInvoiceType = "lecture-noneu";
    renderDetail();
    expect(screen.queryByText("lecture-noneu")).not.toBeInTheDocument();
  });

  it("shows 'Inland' for a domestic invoice", () => {
    mockInvoiceType = "domestic";
    renderDetail();
    expect(screen.getByText("Inland")).toBeInTheDocument();
  });

  it("shows 'EU' for an eu invoice", () => {
    mockInvoiceType = "eu";
    renderDetail();
    expect(screen.getByText("EU")).toBeInTheDocument();
  });

  it("shows 'Export' for an export invoice", () => {
    mockInvoiceType = "export";
    renderDetail();
    expect(screen.getByText("Export")).toBeInTheDocument();
  });

  it("shows 'Nicht-EU' for a noneu invoice", () => {
    mockInvoiceType = "noneu";
    renderDetail();
    expect(screen.getByText("Nicht-EU")).toBeInTheDocument();
  });
});

// ── Tests – English ───────────────────────────────────────────────────────────

describe("InvoiceDetail – type label (English)", () => {
  beforeEach(() => {
    mockLang = "en";
    mockInvoiceLanguage = "en";
  });

  it("shows 'Lecture EU' for a lecture-eu invoice", () => {
    mockInvoiceType = "lecture-eu";
    renderDetail();
    expect(screen.getByText("Lecture EU")).toBeInTheDocument();
  });

  it("shows 'Lecture Non-EU' for a lecture-noneu invoice", () => {
    mockInvoiceType = "lecture-noneu";
    renderDetail();
    expect(screen.getByText("Lecture Non-EU")).toBeInTheDocument();
  });

  it("does not render the raw string 'lecture-eu' in English", () => {
    mockInvoiceType = "lecture-eu";
    renderDetail();
    expect(screen.queryByText("lecture-eu")).not.toBeInTheDocument();
  });

  it("does not render the raw string 'lecture-noneu' in English", () => {
    mockInvoiceType = "lecture-noneu";
    renderDetail();
    expect(screen.queryByText("lecture-noneu")).not.toBeInTheDocument();
  });

  it("shows 'Domestic' for a domestic invoice", () => {
    mockInvoiceType = "domestic";
    renderDetail();
    expect(screen.getByText("Domestic")).toBeInTheDocument();
  });

  it("shows 'Non-EU' for a noneu invoice", () => {
    mockInvoiceType = "noneu";
    renderDetail();
    expect(screen.getByText("Non-EU")).toBeInTheDocument();
  });
});

// ── Tests – type label survives an edit ───────────────────────────────────────
//
// These tests confirm that after a type mutation resolves (onSuccess fires →
// the invoice query is invalidated → React Query refetches → the queryFn
// returns the updated invoiceType), the detail view re-renders with the correct
// new label — without any manual rerender() call.
//
// The tests will FAIL if:
//   • the component stops wiring up an onSuccess handler on updateStatusMutation
//   • onSuccess stops calling queryClient.invalidateQueries for the invoice key
//   • the type row stops using getInvoiceTypeLabel() and starts using a raw string

describe("InvoiceDetail – type label survives an edit", () => {
  beforeEach(() => {
    mockLang = "de";
    mockInvoiceStatus = "draft";
    capturedOnSuccess = undefined;
    capturedMutate = undefined;
  });

  it("wires up an onSuccess handler on the update mutation (domestic → lecture-eu)", async () => {
    mockInvoiceType = "domestic";
    renderDetailForEdit();

    // The component must register an onSuccess handler; if it doesn't, the
    // invalidation step below would never be triggered in production either.
    expect(capturedOnSuccess).toBeDefined();
    expect(screen.getByText("Inland")).toBeInTheDocument();

    // Simulate the mutation resolving: switch the type the server would now
    // return, then fire onSuccess (which calls queryClient.invalidateQueries).
    // React Query detects the invalidation, refetches via the queryFn (which
    // now reads the updated mockInvoiceType), and re-renders the component.
    mockInvoiceType = "lecture-eu";
    capturedOnSuccess!();

    await waitFor(() =>
      expect(screen.getByText("Vortrag EU")).toBeInTheDocument()
    );
    expect(screen.queryByText("Inland")).not.toBeInTheDocument();
  });

  it("label updates from lecture-eu to lecture-noneu after mutation resolves", async () => {
    mockInvoiceType = "lecture-eu";
    renderDetailForEdit();

    expect(capturedOnSuccess).toBeDefined();
    expect(screen.getByText("Vortrag EU")).toBeInTheDocument();

    mockInvoiceType = "lecture-noneu";
    capturedOnSuccess!();

    await waitFor(() =>
      expect(screen.getByText("Vortrag Nicht-EU")).toBeInTheDocument()
    );
    expect(screen.queryByText("Vortrag EU")).not.toBeInTheDocument();
  });

  it("no raw type string leaks through after the type changes (eu → export)", async () => {
    mockInvoiceType = "eu";
    renderDetailForEdit();

    expect(capturedOnSuccess).toBeDefined();
    expect(screen.getByText("EU")).toBeInTheDocument();

    mockInvoiceType = "export";
    capturedOnSuccess!();

    await waitFor(() =>
      expect(screen.getByText("Export")).toBeInTheDocument()
    );
    // The raw type key must never surface in the UI.
    expect(screen.queryByText("export")).not.toBeInTheDocument();
  });
});

describe("InvoiceDetail – dashboard freshness after status changes", () => {
  beforeEach(() => {
    mockLang = "en";
    mockInvoiceLanguage = "en";
    mockInvoiceType = "domestic";
    mockInvoiceStatus = "sent";
    capturedOnSuccess = undefined;
    capturedMutate = undefined;
    vi.stubGlobal("confirm", vi.fn(() => true));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("invalidates the dashboard after paid and cancelled detail actions", async () => {
    const { qc } = renderDetailForEdit();
    const invalidateQueries = vi.spyOn(qc, "invalidateQueries");

    fireEvent.click(screen.getByRole("button", { name: "Mark Paid" }));
    expect(capturedMutate).toHaveBeenCalledWith({
      id: 1,
      data: { status: "paid" },
    });
    capturedOnSuccess!();
    await waitFor(() =>
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: IROC_DASHBOARD_QUERY_KEY })
    );

    invalidateQueries.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Cancel Invoice" }));
    expect(capturedMutate).toHaveBeenCalledWith({
      id: 1,
      data: { status: "cancelled" },
    });
    capturedOnSuccess!();
    await waitFor(() =>
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: IROC_DASHBOARD_QUERY_KEY })
    );
  });
});

describe("InvoiceDetail – returned-product correction flow", () => {
  beforeEach(() => {
    mockLang = "en";
    mockInvoiceLanguage = "en";
    mockInvoiceStatus = "sent";
    mockInvoiceItems = [{
      id: 42, productId: 7, productName: "Returned instrument", sku: "SKU-42",
      description: null, quantity: 2, unitPrice: "100.00", lineTotal: "200.00",
      discountPercent: "0", isDemo: false, lotNumber: null, hsCode: null,
      countryOfOrigin: null, weightKg: null,
    }];
  });

  afterEach(() => { mockInvoiceItems = STABLE_ITEMS; });

  it("is offered only for finalized invoices and sends selected quantities and reason", () => {
    renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "Invoice correction" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Invoice correction for returned products");
    const create = screen.getByRole("button", { name: "Create invoice correction" });
    expect(create).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Returned quantity Returned instrument"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Reason for correction"), { target: { value: "Returned unopened" } });
    fireEvent.click(create);
    expect(capturedCorrectionMutate).toHaveBeenCalledWith({
      id: 1, data: { reason: "Returned unopened", items: [{ invoiceItemId: 42, quantity: 1 }] },
    });
  });

  it("does not offer the correction action for drafts", () => {
    mockInvoiceStatus = "draft";
    renderDetail();
    expect(screen.queryByRole("button", { name: "Invoice correction" })).not.toBeInTheDocument();
  });
});

describe("InvoiceDetail – email defaults follow invoice language", () => {
  beforeEach(() => {
    mockInvoiceType = "domestic";
    mockInvoiceStatus = "sent";
  });

  it("prefills German email text for a German invoice in the English admin UI", () => {
    mockLang = "en";
    mockInvoiceLanguage = "de";
    renderDetail();

    fireEvent.click(screen.getByRole("button", { name: "Send Email" }));

    expect(screen.getByRole("dialog")).toHaveTextContent("Send Invoice by Email");
    expect(screen.getByDisplayValue("Rechnung RE-2024-0001")).toBeInTheDocument();
    expect(screen.getByDisplayValue(/im Anhang finden Sie Ihre Rechnung RE-2024-0001/)).toBeInTheDocument();
  });

  it("prefills English email text for an English invoice in the German admin UI", () => {
    mockLang = "de";
    mockInvoiceLanguage = "en";
    renderDetail();

    fireEvent.click(screen.getByRole("button", { name: "Per E-Mail" }));

    expect(screen.getByRole("dialog")).toHaveTextContent("Rechnung per E-Mail senden");
    expect(screen.getByDisplayValue("Invoice RE-2024-0001")).toBeInTheDocument();
    expect(screen.getByDisplayValue(/Please find attached invoice RE-2024-0001/)).toBeInTheDocument();
  });
});

describe("InvoiceDetail – unlink product", () => {
  afterEach(() => {
    mockInvoiceItems = STABLE_ITEMS;
    vi.unstubAllGlobals();
  });

  it("confirms the action, sends a null product ID, refreshes related queries, and restores the warning", async () => {
    mockLang = "de";
    mockInvoiceLanguage = "de";
    mockInvoiceStatus = "draft";
    mockInvoiceItems = [{
      id: 42,
      productId: 7,
      productName: "Verknüpfter Artikel",
      sku: "SKU-42",
      description: null,
      quantity: 1,
      unitPrice: "100.00",
      lineTotal: "100.00",
      discountPercent: "0",
      isDemo: false,
      lotNumber: null,
      hsCode: null,
      countryOfOrigin: null,
      weightKg: null,
    }];

    const confirmMock = vi.fn(() => true);
    const fetchMock = vi.fn(async () => {
      mockInvoiceItems = [{ ...mockInvoiceItems[0], productId: null }];
      return { ok: true, text: async () => "" };
    });
    vi.stubGlobal("confirm", confirmMock);
    vi.stubGlobal("fetch", fetchMock);

    const { qc } = renderDetailForEdit();
    const invalidateQueries = vi.spyOn(qc, "invalidateQueries");

    fireEvent.click(screen.getByRole("button", { name: "Produktverknüpfung entfernen" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/iroc/invoices/1/items/42",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ productId: null }),
      }),
    ));
    expect(confirmMock).toHaveBeenCalledWith(
      "Produktverknüpfung für „Verknüpfter Artikel“ entfernen?",
    );
    await waitFor(() => expect(screen.getByText("Keine Produktverknüpfung")).toBeInTheDocument());
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["iroc", "invoices", 1] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["iroc", "invoices"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: IROC_DASHBOARD_QUERY_KEY });
  });
});
