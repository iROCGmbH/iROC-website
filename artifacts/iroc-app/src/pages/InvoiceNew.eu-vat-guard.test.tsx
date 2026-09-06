/**
 * InvoiceNew — EU VAT guard: API 400 surfaces in the form's error state
 *
 * What & Why
 * ──────────
 * The API rejects POST /iroc/invoices when invoiceType is a zero-VAT type
 * but vatRate is non-zero.  This test confirms that InvoiceNew renders the
 * error message from the API (via React Query's mutation error) in a visible
 * alert element rather than leaving the admin with no feedback.
 *
 * Strategy
 * ────────
 * The `useCreateIrocInvoice` mutation is mocked at module level with a
 * mutable state object.  Each test updates that object before rendering so
 * the component picks up the desired mutation state on mount.  This avoids
 * needing to drive the full customer-selection + form-submission flow, which
 * is exercised separately in the API-server integration tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import InvoiceNew from "./InvoiceNew";

// ── Mutable mutation state ────────────────────────────────────────────────────

/**
 * The mock factory reads from this object each time the hook is called so
 * individual tests can control the returned mutation state.
 */
const mutationState = {
  mutate:    vi.fn(),
  isPending: false,
  isError:   false,
  error:     null as Error | null,
};

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ lang: "en" }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/invoices/new", vi.fn()],
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@workspace/api-client-react", () => ({
  useListIrocProducts:  () => ({ data: [] }),
  useListIrocProductGroups: () => ({ data: [] }),
  useCreateIrocInvoice: () => ({ ...mutationState }),
}));

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * The error message as it arrives from customFetch's ApiError: the HTTP
 * status prefix is prepended to the `error` field from the response body.
 */
const EU_VAT_ERROR =
  "HTTP 400 Bad Request: Invoice type 'eu' requires a 0 % VAT rate. The saved VAT rate (19 %) is incompatible with this type.";

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

beforeEach(() => {
  // Reset to a clean idle state before each test.
  mutationState.mutate    = vi.fn();
  mutationState.isPending = false;
  mutationState.isError   = false;
  mutationState.error     = null;
});

afterEach(() => vi.restoreAllMocks());

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("InvoiceNew — EU VAT guard surfaced in the form", () => {
  it("renders the API error message when the create mutation errors with the EU VAT guard body", () => {
    // Arrange: mutation is in an error state with the EU guard message.
    mutationState.isError = true;
    mutationState.error   = new Error(EU_VAT_ERROR);

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true, status: 200, json: async () => [],
    } as unknown as Response);

    render(<InvoiceNew />, { wrapper: Wrapper });

    // The guard message must appear in a role="alert" element.
    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent(/Invoice type 'eu' requires a 0 % VAT rate/);
  });

  it("does not render an alert element when the form is in its initial idle state", () => {
    // mutationState is reset to idle by beforeEach.
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true, status: 200, json: async () => [],
    } as unknown as Response);

    render(<InvoiceNew />, { wrapper: Wrapper });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
