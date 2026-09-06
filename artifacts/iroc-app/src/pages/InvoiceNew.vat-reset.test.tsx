/**
 * VAT rate reset test: InvoiceNew
 *
 * Confirms the vatRateOverride state resets correctly when the admin
 * switches the invoice type:
 *
 *   domestic → EU / export / noneu   → VAT selector hidden, effective rate 0
 *   EU / export / noneu → domestic    → VAT selector shows 19 % (not 0)
 *   domestic (7 %) → EU → domestic   → VAT selector shows 19 % (not 7 %,
 *                                        because EU forced 0 which is not a
 *                                        valid domestic rate)
 *
 * Query strategy: use getByDisplayValue on option text rather than ARIA
 * roles, because the <Label> elements in InvoiceNew are not linked to the
 * <select> elements via htmlFor/id and therefore carry no accessible name.
 *
 * • Type select:     identified by the currently-selected option text
 *                    (e.g. "Domestic (19% VAT)").
 * • VAT rate select: identified by option text unique to it
 *                    (/Regelsteuersatz/ for 19 %, /Ermäßigter/ for 7 %).
 *                    The selector is only rendered when type = "domestic",
 *                    so its presence / absence acts as the assertion.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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

/**
 * Returns the type <select> by its currently-displayed option.
 * Pass the exact option text that should be selected right now.
 */
function getTypeSelectByValue(optionText: string | RegExp) {
  return screen.getByDisplayValue(optionText);
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("InvoiceNew — VAT rate selector resets on invoice-type switch", () => {
  it("shows the VAT rate selector with 19 % on the initial domestic state", async () => {
    installFetchSpy();
    render(<InvoiceNew />, { wrapper: Wrapper });

    // The VAT-rate selector is uniquely identified by the "Regelsteuersatz" option
    const vatSelect = await screen.findByDisplayValue(/Regelsteuersatz/i);
    expect(vatSelect).toBeInTheDocument();
    expect((vatSelect as HTMLSelectElement).value).toBe("19");
  });

  it("hides the VAT rate selector when switching domestic → EU", async () => {
    installFetchSpy();
    render(<InvoiceNew />, { wrapper: Wrapper });

    // Selector visible initially
    await screen.findByDisplayValue(/Regelsteuersatz/i);

    // Switch to EU
    const typeSelect = getTypeSelectByValue(/Inland \(19 % MwSt\.\)/i);
    fireEvent.change(typeSelect, { target: { value: "eu" } });

    // VAT selector must disappear (0 % forced for non-domestic)
    await waitFor(() => {
      expect(screen.queryByDisplayValue(/Regelsteuersatz/i)).not.toBeInTheDocument();
      expect(screen.queryByDisplayValue(/Ermäßigter/i)).not.toBeInTheDocument();
    });
  });

  it("hides the VAT rate selector when switching domestic → export", async () => {
    installFetchSpy();
    render(<InvoiceNew />, { wrapper: Wrapper });

    await screen.findByDisplayValue(/Regelsteuersatz/i);

    const typeSelect = getTypeSelectByValue(/Inland \(19 % MwSt\.\)/i);
    fireEvent.change(typeSelect, { target: { value: "export" } });

    await waitFor(() => {
      expect(screen.queryByDisplayValue(/Regelsteuersatz/i)).not.toBeInTheDocument();
      expect(screen.queryByDisplayValue(/Ermäßigter/i)).not.toBeInTheDocument();
    });
  });

  it("hides the VAT rate selector when switching domestic → noneu", async () => {
    installFetchSpy();
    render(<InvoiceNew />, { wrapper: Wrapper });

    await screen.findByDisplayValue(/Regelsteuersatz/i);

    const typeSelect = getTypeSelectByValue(/Inland \(19 % MwSt\.\)/i);
    fireEvent.change(typeSelect, { target: { value: "noneu" } });

    await waitFor(() => {
      expect(screen.queryByDisplayValue(/Regelsteuersatz/i)).not.toBeInTheDocument();
      expect(screen.queryByDisplayValue(/Ermäßigter/i)).not.toBeInTheDocument();
    });
  });

  it("sets the effective VAT rate to 0 % when switching domestic → lecture-eu", async () => {
    installFetchSpy();
    render(<InvoiceNew />, { wrapper: Wrapper });

    const typeSelect = await screen.findByDisplayValue(/Inland \(19 % MwSt\.\)/i);
    fireEvent.change(typeSelect, { target: { value: "lecture-eu" } });

    await waitFor(() => {
      expect(screen.queryByDisplayValue(/Regelsteuersatz/i)).not.toBeInTheDocument();
      expect(screen.getByText(/MwSt\.\s*\(0%\):/i)).toBeInTheDocument();
    });
  });

  it("sets the effective VAT rate to 0 % when switching domestic → lecture-noneu", async () => {
    installFetchSpy();
    render(<InvoiceNew />, { wrapper: Wrapper });

    const typeSelect = await screen.findByDisplayValue(/Inland \(19 % MwSt\.\)/i);
    fireEvent.change(typeSelect, { target: { value: "lecture-noneu" } });

    await waitFor(() => {
      expect(screen.queryByDisplayValue(/Regelsteuersatz/i)).not.toBeInTheDocument();
      expect(screen.getByText(/MwSt\.\s*\(0%\):/i)).toBeInTheDocument();
    });
  });

  it("resets VAT to 0 % for domestic → lecture-eu with a non-empty taxable item", async () => {
    installFetchSpy();
    render(<InvoiceNew />, { wrapper: Wrapper });

    fireEvent.click(await screen.findByRole("button", { name: /Artikel hinzufügen/i }));
    const itemRow = screen.getByPlaceholderText("Produktname").closest("tr");
    expect(itemRow).not.toBeNull();
    const itemPrice = within(itemRow!).getByDisplayValue("0.00");
    fireEvent.change(itemPrice, { target: { value: "100.00" } });

    await waitFor(() => {
      expect(screen.getByText(/Zwischensumme:/i).parentElement).toHaveTextContent(/100,00/);
    });

    const typeSelect = screen.getByDisplayValue(/Inland \(19 % MwSt\.\)/i);
    fireEvent.change(typeSelect, { target: { value: "lecture-eu" } });

    await waitFor(() => {
      expect(screen.getByText(/MwSt\.\s*\(0%\):/i)).toBeInTheDocument();
    });
  });

  it("restores the VAT selector at 19 % when switching noneu → domestic", async () => {
    installFetchSpy();
    render(<InvoiceNew />, { wrapper: Wrapper });

    const typeSelect = await screen.findByDisplayValue(/Inland \(19 % MwSt\.\)/i);
    fireEvent.change(typeSelect, { target: { value: "noneu" } });
    await waitFor(() => {
      expect(screen.queryByDisplayValue(/Regelsteuersatz/i)).not.toBeInTheDocument();
    });

    const noneuTypeSelect = screen.getByDisplayValue("Nicht-EU Standardrechnung (0 %)");
    fireEvent.change(noneuTypeSelect, { target: { value: "domestic" } });

    const vatSelect = await screen.findByDisplayValue(/Regelsteuersatz/i);
    expect((vatSelect as HTMLSelectElement).value).toBe("19");
  });

  it("restores the VAT selector at 19 % (not 0 %) when switching EU → domestic", async () => {
    installFetchSpy();
    render(<InvoiceNew />, { wrapper: Wrapper });

    // Switch to EU
    const typeSelect = await screen.findByDisplayValue(/Inland \(19 % MwSt\.\)/i);
    fireEvent.change(typeSelect, { target: { value: "eu" } });
    await waitFor(() => {
      expect(screen.queryByDisplayValue(/Regelsteuersatz/i)).not.toBeInTheDocument();
    });

    // Switch back to domestic
    const typeSelectEu = screen.getByDisplayValue("EU – Waren / Reverse Charge (0 %)");
    fireEvent.change(typeSelectEu, { target: { value: "domestic" } });

    // VAT selector must reappear with 19 % (not 0, which is not a valid domestic rate)
    const vatSelect = await screen.findByDisplayValue(/Regelsteuersatz/i);
    expect((vatSelect as HTMLSelectElement).value).toBe("19");
  });

  it("restores the VAT selector at 19 % when switching export → domestic", async () => {
    installFetchSpy();
    render(<InvoiceNew />, { wrapper: Wrapper });

    const typeSelect = await screen.findByDisplayValue(/Inland \(19 % MwSt\.\)/i);
    fireEvent.change(typeSelect, { target: { value: "export" } });
    await waitFor(() => {
      expect(screen.queryByDisplayValue(/Regelsteuersatz/i)).not.toBeInTheDocument();
    });

    // Use the exact text of the Export option to avoid ambiguity
    const typeSelectExport = screen.getByDisplayValue(/Export.*Handelsrechnung/i);
    fireEvent.change(typeSelectExport, { target: { value: "domestic" } });

    const vatSelect = await screen.findByDisplayValue(/Regelsteuersatz/i);
    expect((vatSelect as HTMLSelectElement).value).toBe("19");
  });

  it("keeps 7 % when admin selects it and stays on domestic", async () => {
    installFetchSpy();
    render(<InvoiceNew />, { wrapper: Wrapper });

    const vatSelect = await screen.findByDisplayValue(/Regelsteuersatz/i);
    fireEvent.change(vatSelect, { target: { value: "7" } });

    // Selector now shows the 7 % option
    await screen.findByDisplayValue(/Ermäßigter/i);
    expect((screen.getByDisplayValue(/Ermäßigter/i) as HTMLSelectElement).value).toBe("7");
  });

  it("does NOT restore 7 % after domestic(7 %) → EU → domestic; resets to 19 %", async () => {
    // This is the critical regression guard: once EU forces the rate to 0,
    // switching back to domestic must default to 19 %, not silently reuse
    // the previous 7 % (which was discarded when EU set prev → 0).
    installFetchSpy();
    render(<InvoiceNew />, { wrapper: Wrapper });

    // 1. Select 7 % on the domestic form
    const vatSelect = await screen.findByDisplayValue(/Regelsteuersatz/i);
    fireEvent.change(vatSelect, { target: { value: "7" } });
    await screen.findByDisplayValue(/Ermäßigter/i);

    // 2. Switch to EU — rate is forced to 0, VAT selector disappears
    const typeSelect = screen.getByDisplayValue(/Inland \(19 % MwSt\.\)/i);
    fireEvent.change(typeSelect, { target: { value: "eu" } });
    await waitFor(() => {
      expect(screen.queryByDisplayValue(/Ermäßigter/i)).not.toBeInTheDocument();
      expect(screen.queryByDisplayValue(/Regelsteuersatz/i)).not.toBeInTheDocument();
    });

    // 3. Switch back to domestic — prev is 0 (not 7 or 19), so must become 19
    const typeSelectEu = screen.getByDisplayValue("EU – Waren / Reverse Charge (0 %)");
    fireEvent.change(typeSelectEu, { target: { value: "domestic" } });

    const vatSelectBack = await screen.findByDisplayValue(/Regelsteuersatz/i);
    expect((vatSelectBack as HTMLSelectElement).value).toBe("19");
  });
});
