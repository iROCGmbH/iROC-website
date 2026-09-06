/**
 * Expenses — duplicate warning text is shown verbatim from the API response
 *
 * What & Why
 * ──────────
 * The 409 handler reads `json.message` from the response body and passes it
 * directly to setDuplicateWarning. If the server changes its message shape or
 * the field name drifts, the admin would see a hardcoded fallback instead of
 * the server's custom explanation — a silent regression.
 *
 * Scenarios tested
 * ────────────────
 *  1. When the 409 body contains a custom `message` string, that exact text
 *     must appear in the duplicate banner (verbatim, character-for-character).
 *  2. When `message` is absent from the 409 body, the English fallback copy
 *     ("A similar expense already exists. Save anyway?") must appear instead.
 *
 * Approach
 * ────────
 *  • Follow the same file-upload + extract path used by the dual-banner and
 *    triple-banner tests — this is the proven, fast route to opening the modal.
 *  • Stub POST /expenses to return 409 with the body under test.
 *  • Click "Save Expense" → POST fires → 409 handled → banner appears.
 *  • Assert the exact message text (or fallback) is in the DOM.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Expenses from "./Expenses";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ lang: "en" }),
}));

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

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

/**
 * Stub fetch so:
 *   - file upload + extraction succeed (opens the modal)
 *   - POST /expenses returns a 409 with the supplied body
 *
 * Ordering: specific URL checks first, generic catch-all last.
 */
function stubFetchWithExtractAnd409(postBody: Record<string, unknown>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();

    if (url.includes("/api/admin/expenses/orphan-sweep-stats")) {
      return { ok: false, status: 204, json: async () => null } as unknown as Response;
    }
    if (url.includes("/api/admin/expenses/datev-settings")) {
      return {
        ok: true,
        json: async () => ({ kontoMap: {}, gegenKonto: "1600" }),
      } as Response;
    }
    if (url.includes("/api/admin/expenses/upload-url")) {
      return {
        ok: true,
        json: async () => ({
          uploadURL: "https://storage.googleapis.com/bucket/expense-receipts/test.pdf?sig=abc",
          objectPath: "/objects/expense-receipts/test.pdf",
        }),
      } as Response;
    }
    if (url.includes("storage.googleapis.com")) {
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    }
    if (url.includes("/api/admin/expenses/extract")) {
      return {
        ok: true,
        json: async () => ({
          fileObjectPath: "/objects/expense-receipts/test.pdf",
          extracted: {
            vendor_name: "Test Vendor",
            invoice_date: "2024-06-01",
            invoice_number: "INV-DUP-001",
            category: "Software",
            net_amount: 100,
            tax_amount: 19,
            gross_amount: 119,
            currency: "EUR",
            confidence: "high",
          },
        }),
      } as Response;
    }
    // POST /expenses → 409 with the provided body
    if (url.match(/\/api\/admin\/expenses$/) && method === "POST") {
      return {
        ok: false,
        status: 409,
        json: async () => postBody,
      } as unknown as Response;
    }
    // Generic expenses list (GET) and all other expense routes
    if (url.includes("/api/admin/expenses")) {
      return { ok: true, json: async () => [] } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });
}

/**
 * Create a fake PDF file that passes the component's 64-byte minimum size check.
 */
function makeFakePdf(): File {
  const content = "A".repeat(100); // 100 bytes > 64-byte minimum
  return new File([content], "receipt.pdf", { type: "application/pdf" });
}

/**
 * Trigger the hidden file input's onChange with a fake file.
 */
function uploadFakeFile(file: File) {
  const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!fileInput) throw new Error("File input not found in DOM");
  Object.defineProperty(fileInput, "files", {
    value: [file],
    writable: true,
    configurable: true,
  });
  fireEvent.change(fileInput);
}

/**
 * Upload a file, wait for the extraction modal, then click "Save Expense".
 */
async function openModalAndSave() {
  uploadFakeFile(makeFakePdf());

  await waitFor(
    () => expect(screen.getByText(/Review Extraction & Save/i)).toBeInTheDocument(),
    { timeout: 8000 },
  );

  fireEvent.click(screen.getByRole("button", { name: /save expense/i }));
}

afterEach(() => {
  vi.restoreAllMocks();
  mockToast.mockReset();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Expenses — duplicate warning text is shown verbatim from the API response", () => {

  it("shows the custom message string from the 409 body verbatim in the duplicate banner", async () => {
    const CUSTOM_MESSAGE =
      "Invoice INV-2024-042 from ACME GmbH was already recorded on 2024-01-10. " +
      "Check expense #17 before saving again.";

    stubFetchWithExtractAnd409({ message: CUSTOM_MESSAGE });
    render(<Expenses />, { wrapper: Wrapper });

    await openModalAndSave();

    // The duplicate banner must appear with the exact custom message text
    await waitFor(
      () => expect(screen.getByText(CUSTOM_MESSAGE)).toBeInTheDocument(),
      { timeout: 5000 },
    );

    // The banner header must also be present
    expect(screen.getByText(/Possible duplicate detected/i)).toBeInTheDocument();
  }, 20000);

  it("shows the exact custom message as a verbatim text node — not paraphrased", async () => {
    const CUSTOM_MESSAGE = "Duplicate: vendor=Medizin GmbH date=2024-02-28 number=REC-999";

    stubFetchWithExtractAnd409({ message: CUSTOM_MESSAGE });
    render(<Expenses />, { wrapper: Wrapper });

    await openModalAndSave();

    await waitFor(
      () => expect(screen.getByText(CUSTOM_MESSAGE)).toBeInTheDocument(),
      { timeout: 5000 },
    );

    // The text node's content must be the custom message exactly
    const msgNode = screen.getByText(CUSTOM_MESSAGE);
    expect(msgNode.textContent).toBe(CUSTOM_MESSAGE);
  }, 20000);

  it("shows the fallback copy when the 409 body has no message field", async () => {
    // 409 body deliberately omits the `message` key
    stubFetchWithExtractAnd409({ error: "conflict" });
    render(<Expenses />, { wrapper: Wrapper });

    await openModalAndSave();

    // English fallback from the component's ?? expression
    await waitFor(
      () =>
        expect(
          screen.getByText(/A similar expense already exists\. Save anyway\?/i),
        ).toBeInTheDocument(),
      { timeout: 5000 },
    );

    // The banner header must also be present
    expect(screen.getByText(/Possible duplicate detected/i)).toBeInTheDocument();
  }, 20000);

  it("shows the fallback copy when the 409 body is completely empty", async () => {
    stubFetchWithExtractAnd409({});
    render(<Expenses />, { wrapper: Wrapper });

    await openModalAndSave();

    await waitFor(
      () =>
        expect(
          screen.getByText(/A similar expense already exists\. Save anyway\?/i),
        ).toBeInTheDocument(),
      { timeout: 5000 },
    );
  }, 20000);

  it("replaces the Save Expense button with Save Anyway after a 409", async () => {
    stubFetchWithExtractAnd409({ message: "This is a duplicate entry." });
    render(<Expenses />, { wrapper: Wrapper });

    await openModalAndSave();

    // After 409, the CTA must switch to the destructive "Save anyway" variant
    await waitFor(
      () => expect(screen.getByRole("button", { name: /save anyway/i })).toBeInTheDocument(),
      { timeout: 5000 },
    );

    // The original "Save Expense" button must no longer be present
    expect(screen.queryByRole("button", { name: /save expense/i })).toBeNull();
  }, 20000);

  it("shows the matching expense details when the 409 body includes them", async () => {
    stubFetchWithExtractAnd409({
      message: "A matching expense was found.",
      duplicate: {
        id: 42,
        vendor_name: "ACME GmbH",
        invoice_date: "2026-01-15",
        invoice_number: "INV-042",
        gross_amount: "119.00",
        currency: "EUR",
      },
    });
    render(<Expenses />, { wrapper: Wrapper });

    await openModalAndSave();

    await waitFor(() => expect(screen.getByText("Matching expense", { exact: true })).toBeInTheDocument());
    expect(screen.getByText("ACME GmbH")).toBeInTheDocument();
    expect(screen.getByText("15.01.2026")).toBeInTheDocument();
    expect(screen.getByText("INV-042")).toBeInTheDocument();
    expect(screen.getByText("119,00 €")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save anyway/i })).toBeInTheDocument();
  }, 20000);

});
