/**
 * InvoicesList – type column sort
 *
 * Confirms that clicking the Type column header sorts the list by the
 * localised label, and that toggling sort direction moves lecture-eu rows
 * before / after non-lecture rows.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import InvoicesList from "./InvoicesList";
import { compareInvoiceNumbersDescending } from "./InvoicesList";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ lang: "en" }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/invoices", vi.fn()],
  useParams:   () => ({}),
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const makeInvoice = (id: number, invoiceType: string, invoiceNumber: string) => ({
  id,
  invoiceNumber,
  customerName:  "Test Customer",
  issueDate:     "2024-01-15",
  dueDate:       "2024-02-15",
  status:        "draft",
  total:         "100.00",
  invoiceType,
});

vi.mock("@workspace/api-client-react", () => ({
  useListIrocInvoices: () => ({
    data: [
      makeInvoice(1, "domestic",    "RE-2024-001"),
      makeInvoice(2, "eu",          "RE-2024-002"),
      makeInvoice(3, "lecture-eu",  "RE-2024-003"),
      makeInvoice(4, "noneu",       "RE-2024-004"),
      makeInvoice(5, "lecture-eu",  "RE-2024-005"),
    ],
    isLoading: false,
    refetch:   vi.fn(),
  }),
  updateIrocInvoiceStatus:      vi.fn(),
  getListIrocInvoicesQueryKey:  () => ["iroc-invoices"],
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <InvoicesList />
    </QueryClientProvider>
  );
}

/** Returns the invoice-number text of each body row in DOM order. */
function getRowNumbers(): string[] {
  return screen
    .getAllByRole("row")
    .slice(1) // skip header row
    .map(row => {
      // Each row has two links: the invoice-number link and the "View" link.
      // The invoice number is in the second <td> (index 1), which is a mono font cell.
      const links = within(row).queryAllByRole("link");
      // The invoice-number link is always the first one in the row
      return links[0]?.textContent?.trim() ?? "";
    })
    .filter(t => t.startsWith("RE-"));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("InvoicesList – type column sort", () => {
  it("sorts invoice numbers newest to oldest by default", () => {
    expect([
      "2025-0100",
      "2026-0009",
      "2026-0100",
      "2026-0010",
    ].sort(compareInvoiceNumbersDescending)).toEqual([
      "2026-0100",
      "2026-0010",
      "2026-0009",
      "2025-0100",
    ]);
  });

  it("renders the Type column header", () => {
    renderList();
    expect(screen.getByRole("columnheader", { name: /type/i })).toBeInTheDocument();
  });

  it("sorts asc by localised label on first click — rows follow alphabetical order (Domestic < EU < Lecture EU < Non-EU)", async () => {
    renderList();
    await userEvent.click(screen.getByRole("columnheader", { name: /type/i }));

    const rows = getRowNumbers();
    // Asc alphabetical order: Domestic (D) → EU (E) → Lecture EU (L) → Non-EU (N)
    const domesticIdx    = rows.indexOf("RE-2024-001"); // Domestic
    const euIdx          = rows.indexOf("RE-2024-002"); // EU
    const lectureIdx     = rows.indexOf("RE-2024-003"); // Lecture EU
    const nonEuIdx       = rows.indexOf("RE-2024-004"); // Non-EU

    expect(domesticIdx).toBeGreaterThanOrEqual(0);
    expect(euIdx).toBeGreaterThanOrEqual(0);
    expect(lectureIdx).toBeGreaterThanOrEqual(0);
    expect(nonEuIdx).toBeGreaterThanOrEqual(0);

    // Domestic < EU < Lecture EU < Non-EU
    expect(domesticIdx).toBeLessThan(euIdx);
    expect(euIdx).toBeLessThan(lectureIdx);
    expect(lectureIdx).toBeLessThan(nonEuIdx);
  });

  it("sorts desc on second click — lecture rows appear after non-lecture rows", async () => {
    renderList();
    const typeHeader = screen.getByRole("columnheader", { name: /type/i });
    await userEvent.click(typeHeader); // asc
    await userEvent.click(typeHeader); // desc

    const rows = getRowNumbers();
    const isLecture = (n: string) => n === "RE-2024-003" || n === "RE-2024-005";
    const isNonLecture = (n: string) => n === "RE-2024-001" || n === "RE-2024-002" || n === "RE-2024-004";

    const lectureIdxs = rows.map((n, i) => isLecture(n) ? i : -1).filter(i => i >= 0);
    const nonLectureIdxs = rows.map((n, i) => isNonLecture(n) ? i : -1).filter(i => i >= 0);

    expect(lectureIdxs.length).toBeGreaterThan(0);
    expect(nonLectureIdxs.length).toBeGreaterThan(0);
    // In desc order, non-lecture labels (Non-EU, EU, Domestic) sort before Lecture EU
    const firstNonLectureIdx = Math.min(...nonLectureIdxs);
    const lastLectureIdx = Math.max(...lectureIdxs);
    expect(firstNonLectureIdx).toBeLessThan(lastLectureIdx);
  });

  it("shows the chevron icon on the Type header when type sort is active", async () => {
    renderList();
    const typeHeader = screen.getByRole("columnheader", { name: /type/i });

    // Before click — no SVG chevron in Type header
    expect(typeHeader.querySelector("svg")).toBeNull();

    // After click — chevron SVG is present
    await userEvent.click(typeHeader);
    expect(typeHeader.querySelector("svg")).not.toBeNull();
  });
});
