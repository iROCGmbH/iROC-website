import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ProductsList from "./ProductsList";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ lang: "en" }),
}));

vi.mock("wouter", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href?: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@workspace/api-client-react", () => ({
  useListIrocProducts: () => ({
    data: [{
      id: 1,
      sku: "TEST-BRUTTO-001",
      nameEn: "Gross price test product",
      nameDe: "Testprodukt Bruttopreis",
      descriptionEn: null,
      descriptionDe: null,
      unitPrice: "100.00",
      unitPriceBrutto: "119.00",
      purchasePrice: null,
      purchaseDiscount: null,
      purchaseCurrency: "EUR",
      purchaseRawPrice: null,
      recommendedPrice: null,
      stockQuantity: 0,
      lowStockThreshold: 5,
      category: "cellenis",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }],
    isLoading: false,
  }),
  useListIrocProductGroups: () => ({ data: [] }),
  useCreateIrocProduct: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateIrocProduct: () => ({ mutate: mocks.update, isPending: false }),
  useDeleteIrocProduct: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateIrocProductGroup: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateIrocProductGroup: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteIrocProductGroup: () => ({ mutate: vi.fn(), isPending: false }),
  getListIrocProductsQueryKey: () => ["iroc-products"],
  getListIrocProductGroupsQueryKey: () => ["iroc-product-groups"],
}));

vi.mock("@/lib/admin-fetch", () => ({
  adminDelete: vi.fn(),
}));

function renderList() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProductsList />
    </QueryClientProvider>,
  );
}

async function submitGrossPrice(value: string) {
  const user = userEvent.setup();
  renderList();

  await user.click(screen.getByTitle("Edit"));
  const dialog = await screen.findByRole("dialog");
  const grossPriceInput = within(dialog).getAllByRole("spinbutton")[1];
  await user.clear(grossPriceInput);
  if (value) await user.type(grossPriceInput, value);
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
}

beforeEach(() => {
  mocks.update.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ProductsList gross price form", () => {
  it("sends a non-empty gross price when an admin sets it", async () => {
    await submitGrossPrice("121.50");

    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      id: 1,
      data: expect.objectContaining({ unitPriceBrutto: "121.5" }),
    }));
  });

  it("sends null when an admin clears an existing gross price", async () => {
    await submitGrossPrice("");

    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      id: 1,
      data: expect.objectContaining({ unitPriceBrutto: null }),
    }));
  });
});