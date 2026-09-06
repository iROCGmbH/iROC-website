/**
 * ProductDetail – service category survives an edit/refetch cycle.
 *
 * A service product must keep its localized violet badge after saving an
 * unrelated field. The stock card must remain hidden because service products
 * do not track inventory.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ProductDetail from "./ProductDetail";

const { useQuery, useMutation } = await vi.importActual<typeof import("@tanstack/react-query")>(
  "@tanstack/react-query",
);

type Product = {
  id: number;
  sku: string;
  nameEn: string;
  nameDe: string;
  descriptionEn: string | null;
  descriptionDe: string | null;
  unitPrice: string;
  unitPriceBrutto: string | null;
  purchasePrice: string | null;
  purchaseDiscount: string | null;
  purchaseCurrency: string | null;
  purchaseRawPrice: string | null;
  recommendedPrice: string | null;
  stockQuantity: number;
  lowStockThreshold: number;
  category: string;
  createdAt: string;
};

let productStore: Product;
let lastUpdatePayload: Record<string, unknown> | undefined;

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ lang: "en" }),
}));

vi.mock("wouter", () => ({
  useParams: () => ({ id: "42" }),
  useLocation: () => ["/products/42", vi.fn()],
  Link: ({ children, href }: { children: React.ReactNode; href?: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@workspace/api-client-react", () => ({
  useListIrocProductGroups: () => ({
    data: [{
      id: 7,
      key: "services",
      nameEn: "Services",
      nameDe: "Dienstleistungen",
      sortOrder: 3,
      isService: true,
    }],
  }),
  useGetIrocProduct: (
    id: number,
    options?: { query?: { queryKey?: readonly unknown[]; enabled?: boolean } },
  ) => useQuery({
    queryKey: options?.query?.queryKey ?? ["iroc-product", id],
    queryFn: async () => productStore,
    enabled: options?.query?.enabled,
  }),
  useUpdateIrocProduct: (options?: {
    mutation?: {
      onSuccess?: (data: Product) => void;
    };
  }) => useMutation({
    mutationFn: async ({ data }: { id: number; data: Record<string, unknown> }) => {
      lastUpdatePayload = data;
      productStore = { ...productStore, ...data } as Product;
      return productStore;
    },
    onSuccess: options?.mutation?.onSuccess,
  }),
  useDeleteIrocProduct: () => useMutation({
    mutationFn: async () => undefined,
  }),
  useAdjustIrocProductStock: () => useMutation({
    mutationFn: async () => productStore,
  }),
  getGetIrocProductQueryKey: (id: number) => ["iroc-product", id],
}));

function makeProduct(): Product {
  return {
    id: 42,
    sku: "SERVICE-042",
    nameEn: "Initial consultation",
    nameDe: "Erstberatung",
    descriptionEn: null,
    descriptionDe: null,
    unitPrice: "150.00",
    unitPriceBrutto: null,
    purchasePrice: null,
    purchaseDiscount: null,
    purchaseCurrency: null,
    purchaseRawPrice: null,
    recommendedPrice: null,
    stockQuantity: 42,
    lowStockThreshold: 5,
    category: "services",
    createdAt: "2026-08-26T00:00:00.000Z",
  };
}

function renderProduct() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ProductDetail />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  productStore = makeProduct();
  lastUpdatePayload = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ProductDetail – service product after editing", () => {
  it("keeps the violet Services badge and hidden stock card after saving a name change", async () => {
    const user = userEvent.setup();
    renderProduct();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Initial consultation" })).toBeInTheDocument();
    });

    const initialBadge = screen.getByText("Services");
    expect(initialBadge).toHaveClass("border-violet-400/60", "text-violet-600");
    expect(screen.queryByText("Stock")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Adjust Stock" })).not.toBeInTheDocument();
    expect(screen.queryByText("42")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const englishName = screen.getByDisplayValue("Initial consultation");
    await user.clear(englishName);
    await user.type(englishName, "Updated consultation");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Updated consultation" })).toBeInTheDocument();
    });

    expect(lastUpdatePayload?.category).toBe("services");
    const updatedBadge = screen.getByText("Services");
    expect(updatedBadge).toHaveClass("border-violet-400/60", "text-violet-600");
    expect(screen.queryByText("Other")).not.toBeInTheDocument();
    expect(screen.queryByText("Stock")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Adjust Stock" })).not.toBeInTheDocument();
    expect(screen.queryByText("42")).not.toBeInTheDocument();
  });
});