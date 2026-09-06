/**
 * Expenses — duplicate warning override completes the save
 *
 * A duplicate response must not trap an admin in the review modal. After the
 * first POST returns 409, clicking "Save anyway" must resubmit with the API's
 * duplicate-override flag, close the modal, and refresh the expenses list.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Expenses from "./Expenses";
import { EXPENSES_KEY } from "@/lib/query-keys";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ lang: "en" }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
}

function renderExpenses(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <Expenses />
    </QueryClientProvider>,
  );
}

function makeFakePdf(): File {
  return new File(["A".repeat(100)], "receipt.pdf", { type: "application/pdf" });
}

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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Expenses — Save anyway duplicate override", () => {
  it("resubmits edited data with the duplicate override and clears the duplicate banner", async () => {
    const submittedBodies: Record<string, unknown>[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
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
      if (url.match(/\/api\/admin\/expenses$/) && method === "POST") {
        submittedBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        if (submittedBodies.length === 1) {
          return {
            ok: false,
            status: 409,
            json: async () => ({ message: "Matching expense already exists." }),
          } as unknown as Response;
        }
        return { ok: true, status: 201, json: async () => ({ id: 123 }) } as Response;
      }
      if (url.includes("/api/admin/expenses")) {
        return { ok: true, json: async () => [] } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });

    const queryClient = makeQueryClient();
    const invalidateExpenses = vi.spyOn(queryClient, "invalidateQueries");
    renderExpenses(queryClient);

    uploadFakeFile(makeFakePdf());
    await waitFor(() =>
      expect(screen.getByText(/Review Extraction & Save/i)).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /save expense/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /save anyway/i })).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByDisplayValue("Test Vendor"), {
      target: { value: "Updated Vendor" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save anyway/i }));

    await waitFor(() => expect(submittedBodies).toHaveLength(2));
    expect(submittedBodies[0]).not.toHaveProperty("skipDuplicateCheck");
    expect(submittedBodies[1]).toMatchObject({
      vendor_name: "Updated Vendor",
      skipDuplicateCheck: true,
    });

    await waitFor(() =>
      expect(screen.queryByText(/Review Extraction & Save/i)).not.toBeInTheDocument(),
    );
    expect(screen.queryByText(/Possible duplicate detected/i)).not.toBeInTheDocument();
    expect(invalidateExpenses).toHaveBeenCalledWith({ queryKey: EXPENSES_KEY });
  }, 20000);

  it("keeps the modal open and replaces the warning when an edited override is also rejected", async () => {
    const submittedBodies: Record<string, unknown>[] = [];
    const firstMessage = "Matching expense already exists.";
    const secondMessage = "The edited expense still matches expense #17.";

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
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
              invoice_number: "INV-DUP-003",
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
      if (url.match(/\/api\/admin\/expenses$/) && method === "POST") {
        submittedBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return {
          ok: false,
          status: 409,
          json: async () => ({
            message: submittedBodies.length === 1 ? firstMessage : secondMessage,
          }),
        } as unknown as Response;
      }
      if (url.includes("/api/admin/expenses")) {
        return { ok: true, json: async () => [] } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });

    const queryClient = makeQueryClient();
    renderExpenses(queryClient);

    uploadFakeFile(makeFakePdf());
    await waitFor(() =>
      expect(screen.getByText(/Review Extraction & Save/i)).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /save expense/i }));
    await waitFor(() =>
      expect(screen.getByText(firstMessage)).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByDisplayValue("Test Vendor"), {
      target: { value: "Updated Vendor" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save anyway/i }));

    await waitFor(() => expect(submittedBodies).toHaveLength(2));
    expect(submittedBodies[1]).toMatchObject({
      vendor_name: "Updated Vendor",
      skipDuplicateCheck: true,
    });
    expect(screen.getByText(secondMessage)).toBeInTheDocument();
    expect(screen.queryByText(firstMessage)).not.toBeInTheDocument();
    expect(screen.getByText(/Review Extraction & Save/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save anyway/i })).toBeInTheDocument();
  }, 20000);

  it("removes the stale override action when the forced save fails", async () => {
    const submittedBodies: Record<string, unknown>[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
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
              invoice_number: "INV-DUP-002",
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
      if (url.match(/\/api\/admin\/expenses$/) && method === "POST") {
        submittedBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        if (submittedBodies.length === 1) {
          return {
            ok: false,
            status: 409,
            json: async () => ({ message: "Matching expense already exists." }),
          } as unknown as Response;
        }
        if (submittedBodies.length === 2) {
          return {
            ok: false,
            status: 503,
            json: async () => ({ error: "Temporary expense service failure." }),
          } as unknown as Response;
        }
        return { ok: true, status: 201, json: async () => ({ id: 456 }) } as Response;
      }
      if (url.includes("/api/admin/expenses")) {
        return { ok: true, json: async () => [] } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });

    const queryClient = makeQueryClient();
    const invalidateExpenses = vi.spyOn(queryClient, "invalidateQueries");
    renderExpenses(queryClient);

    uploadFakeFile(makeFakePdf());
    await waitFor(() =>
      expect(screen.getByText(/Review Extraction & Save/i)).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /save expense/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /save anyway/i })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /save anyway/i }));
    await waitFor(() => expect(submittedBodies).toHaveLength(2));
    expect(screen.getByText("Temporary expense service failure.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save anyway/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save expense/i })).toBeInTheDocument();
    expect(screen.getByText(/Review Extraction & Save/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /save expense/i }));
    await waitFor(() => expect(submittedBodies).toHaveLength(3));
    expect(submittedBodies[2]).not.toHaveProperty("skipDuplicateCheck");
    await waitFor(() =>
      expect(screen.queryByText(/Review Extraction & Save/i)).not.toBeInTheDocument(),
    );
    expect(invalidateExpenses).toHaveBeenCalledWith({ queryKey: EXPENSES_KEY });
  }, 20000);
});
