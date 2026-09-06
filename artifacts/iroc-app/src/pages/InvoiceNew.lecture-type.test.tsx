/**
 * Lecture invoice-type selector test: InvoiceNew
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
 * Query strategy:
 *   – Type select: identified by its currently-displayed option text
 *     ("Domestic (19% VAT)" on first render).
 *   – vatNote textarea: identified by getByDisplayValue matching
 *     the auto-generated footnote text; checked after each type switch.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
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

vi.mock("@workspace/api-client-react", () => ({
  useListIrocProducts:  () => ({ data: [] }),
  useListIrocProductGroups: () => ({ data: [] }),
  useCreateIrocInvoice: () => ({ mutate: vi.fn(), isPending: false }),
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
      if (url.includes("/api/iroc/invoices/next-number"))
        return { ok: true, json: async () => ({ nextNumber: "2026-9999" }) } as Response;
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

describe("InvoiceNew — lecture invoice-type options and vatNote preview", () => {
  it("renders a lecture-eu option whose label includes 'EU'", async () => {
    installFetchSpy();
    render(<InvoiceNew />, { wrapper: Wrapper });

    // Wait for the form to mount (next-number fetch resolves)
    const typeSelect = await screen.findByDisplayValue(/Inland \(19 % MwSt\.\)/i);

    // Query via DOM: find the option element directly
    const selectEl = typeSelect as HTMLSelectElement;
    const euOption = Array.from(selectEl.options).find(
      (o) => o.value === "lecture-eu"
    );
    expect(euOption).toBeDefined();
    // Label must clearly identify it as the EU lecture variant
    expect(euOption!.text.toLowerCase()).toContain("eu");
  });

  it("renders a lecture-noneu option whose label includes 'Non-EU'", async () => {
    installFetchSpy();
    render(<InvoiceNew />, { wrapper: Wrapper });

    const typeSelect = await screen.findByDisplayValue(/Inland \(19 % MwSt\.\)/i) as HTMLSelectElement;

    const nonEuOption = Array.from(typeSelect.options).find(
      (o) => o.value === "lecture-noneu"
    );
    expect(nonEuOption).toBeDefined();
    // Label must clearly identify it as the Non-EU lecture variant
    expect(nonEuOption!.text.toLowerCase()).toMatch(/n[oi][nc]h?t?[\s\-–]?eu/);
  });

  it("updates the vatNote preview to the §3a / §13b Reverse Charge text when lecture-eu is selected", async () => {
    installFetchSpy();
    render(<InvoiceNew />, { wrapper: Wrapper });

    const typeSelect = await screen.findByDisplayValue(/Inland \(19 % MwSt\.\)/i);
    const languageSelect = (screen.getAllByRole("combobox") as HTMLSelectElement[])
      .find(select => Array.from(select.options).some(option => option.value === "de")
        && Array.from(select.options).some(option => option.value === "en"));
    expect(languageSelect).toBeDefined();
    fireEvent.change(languageSelect!, { target: { value: "de" } });
    fireEvent.change(typeSelect, { target: { value: "lecture-eu" } });

    // vatNote textarea should now contain the §3a §13b Reverse Charge footnote (German, lang="de")
    await waitFor(() => {
      const textarea = screen.getByDisplayValue(/§\s*3a.*§\s*13b/i) as HTMLTextAreaElement;
      expect(textarea.value).toMatch(/Reverse Charge/i);
    });
  });

  it("updates the vatNote preview to the 'nicht steuerbar' text when lecture-noneu is selected", async () => {
    installFetchSpy();
    render(<InvoiceNew />, { wrapper: Wrapper });

    const typeSelect = await screen.findByDisplayValue(/Inland \(19 % MwSt\.\)/i);
    const languageSelect = (screen.getAllByRole("combobox") as HTMLSelectElement[])
      .find(select => Array.from(select.options).some(option => option.value === "de")
        && Array.from(select.options).some(option => option.value === "en"));
    expect(languageSelect).toBeDefined();
    fireEvent.change(languageSelect!, { target: { value: "de" } });
    fireEvent.change(typeSelect, { target: { value: "lecture-noneu" } });

    // vatNote textarea should now contain the "nicht steuerbar" footnote (German, lang="de")
    await waitFor(() => {
      const textarea = screen.getByDisplayValue(/nicht steuerbar/i) as HTMLTextAreaElement;
      expect(textarea.value).toMatch(/§\s*3a/i);
    });
  });

  it("both lecture options are distinct: lecture-eu does not mention 'nicht steuerbar' and lecture-noneu does not mention '§13b'", async () => {
    installFetchSpy();
    const { unmount } = render(<InvoiceNew />, { wrapper: Wrapper });
    const typeSelect = await screen.findByDisplayValue(/Inland \(19 % MwSt\.\)/i);
    const languageSelect = (screen.getAllByRole("combobox") as HTMLSelectElement[])
      .find(select => Array.from(select.options).some(option => option.value === "de")
        && Array.from(select.options).some(option => option.value === "en"));
    expect(languageSelect).toBeDefined();
    fireEvent.change(languageSelect!, { target: { value: "de" } });

    // ── lecture-eu ──
    fireEvent.change(typeSelect, { target: { value: "lecture-eu" } });
    await waitFor(() => {
      expect(screen.getByDisplayValue(/§\s*13b/i)).toBeInTheDocument();
    });
    expect(screen.queryByDisplayValue(/nicht steuerbar/i)).not.toBeInTheDocument();

    unmount();

    // ── lecture-noneu (fresh render) ──
    const { unmount: unmount2 } = render(<InvoiceNew />, { wrapper: Wrapper });
    const typeSelect2 = await screen.findByDisplayValue(/Inland \(19 % MwSt\.\)/i);
    const languageSelect2 = (screen.getAllByRole("combobox") as HTMLSelectElement[])
      .find(select => Array.from(select.options).some(option => option.value === "de")
        && Array.from(select.options).some(option => option.value === "en"));
    expect(languageSelect2).toBeDefined();
    fireEvent.change(languageSelect2!, { target: { value: "de" } });
    fireEvent.change(typeSelect2, { target: { value: "lecture-noneu" } });
    await waitFor(() => {
      expect(screen.getByDisplayValue(/nicht steuerbar/i)).toBeInTheDocument();
    });
    expect(screen.queryByDisplayValue(/§\s*13b/i)).not.toBeInTheDocument();
    unmount2();
  });
});
