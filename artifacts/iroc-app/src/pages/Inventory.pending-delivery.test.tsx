/**
 * Inventory — receiving the final pending lot
 *
 * Pending lots belong only in "Awaiting Delivery" until the server confirms
 * receipt. The mutation must then refresh both collections: the delivery queue
 * disappears and the received lot appears in the main inventory table. The
 * same state must survive a fresh page mount.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import Inventory from "./Inventory";
import { adminGet, adminPatch } from "@/lib/admin-fetch";

const state = vi.hoisted(() => ({
  pending: true,
  lang: "en" as "de" | "en",
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ lang: state.lang }),
}));

vi.mock("wouter", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@workspace/api-client-react", () => ({
  useListIrocProducts: () => ({
    data: [{
      id: 7,
      sku: "DELIVERY-7",
      nameEn: "Delivery Product",
      nameDe: "Lieferprodukt",
      descriptionEn: "Exact English product description",
      descriptionDe: "Exakte deutsche Produktbeschreibung",
      category: "spirecut",
      purchasePrice: "12.00",
      purchaseDiscount: "0",
    }],
  }),
  useListIrocProductGroups: () => ({ data: [] }),
}));

vi.mock("@/lib/admin-fetch", () => ({
  adminGet: vi.fn(),
  adminPost: vi.fn(),
  adminDelete: vi.fn(),
  adminPatch: vi.fn(),
}));

const pendingLot = {
  lot_id: 31,
  product_id: 7,
  lot_number: "DELIVERY-LOT-31",
  purchase_date: "2026-08-23",
  quantity_received: 6,
  description: "Received with supplier invoice",
  product_sku: "DELIVERY-7",
  product_name_de: "Lieferprodukt",
  product_name_en: "Delivery Product",
  vendor_name: "Test Supplier",
  invoice_number: "SUP-31",
  invoice_date: "2026-08-23",
  expense_id: 9,
};

const receivedLot = {
  id: 31,
  productId: 7,
  productSku: "DELIVERY-7",
  productNameEn: "Delivery Product",
  productNameDe: "Lieferprodukt",
  productDescriptionEn: "Exact English product description",
  productDescriptionDe: "Exakte deutsche Produktbeschreibung",
  productCategory: "spirecut",
  productPurchasePrice: "12.00",
  lotNumber: "DELIVERY-LOT-31",
  purchaseDate: "2026-08-23",
  expirationDate: null,
  description: "Received with supplier invoice",
  quantityReceived: 6,
  quantityUsed: 0,
};

beforeEach(() => {
  state.pending = true;
  state.lang = "en";
  vi.mocked(adminGet).mockImplementation(async (path) => {
    if (path === "/api/admin/inventory-lots/pending") {
      return state.pending ? [pendingLot] : [];
    }
    if (path === "/api/iroc/inventory") {
      return state.pending ? [] : [receivedLot];
    }
    return [];
  });
  vi.mocked(adminPatch).mockImplementation(async (path) => {
    if (path !== "/api/admin/inventory-lots/31/receive") {
      throw new Error(`Unexpected patch path: ${path}`);
    }
    state.pending = false;
    return { ok: true, lot: { id: 31 } };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Inventory — final pending delivery receipt", () => {
  it("removes Awaiting Delivery, shows the received stock, and retains that state after a page refresh", async () => {
    const page = render(<Inventory />);

    const receiveButton = await screen.findByRole("button", { name: "Mark as Received" });
    expect(screen.getByText("Awaiting Delivery")).toBeInTheDocument();
    expect(screen.getByText("No inventory records")).toBeInTheDocument();

    fireEvent.click(receiveButton);

    await waitFor(() => {
      expect(screen.queryByText("Awaiting Delivery")).not.toBeInTheDocument();
      expect(screen.getByText("DELIVERY-LOT-31")).toBeInTheDocument();
    });
    expect(screen.getByText("DELIVERY-LOT-31").closest("tr")).toHaveTextContent("6");
    expect(screen.getByText("Exact English product description")).toBeInTheDocument();
    expect(screen.getByText("Lot note: Received with supplier invoice")).toBeInTheDocument();
    expect(adminGet).toHaveBeenCalledWith("/api/admin/inventory-lots/pending", "test-token");
    expect(adminGet).toHaveBeenCalledWith("/api/iroc/inventory", "test-token");

    page.unmount();
    render(<Inventory />);

    await waitFor(() => {
      expect(screen.queryByText("Awaiting Delivery")).not.toBeInTheDocument();
      expect(screen.getByText("DELIVERY-LOT-31")).toBeInTheDocument();
    });
  });

  it("shows the Product form description in the selected UI language", async () => {
    state.pending = false;
    const page = render(<Inventory />);

    expect(await screen.findByText("Exact English product description")).toBeInTheDocument();
    expect(screen.queryByText("Exakte deutsche Produktbeschreibung")).not.toBeInTheDocument();

    state.lang = "de";
    page.rerender(<Inventory />);

    expect(await screen.findByText("Exakte deutsche Produktbeschreibung")).toBeInTheDocument();
    expect(screen.queryByText("Exact English product description")).not.toBeInTheDocument();
    expect(screen.getByText("LOT-Notiz: Received with supplier invoice")).toBeInTheDocument();
  });

  it("explains that another admin already received the lot and refreshes both collections", async () => {
    vi.mocked(adminPatch).mockImplementation(async (path) => {
      if (path !== "/api/admin/inventory-lots/31/receive") {
        throw new Error(`Unexpected patch path: ${path}`);
      }
      state.pending = false;
      throw new Error("Lot not found or already received");
    });
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    render(<Inventory />);
    fireEvent.click(await screen.findByRole("button", { name: "Mark as Received" }));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith("This delivery has already been marked as received.");
      expect(screen.queryByText("Awaiting Delivery")).not.toBeInTheDocument();
      expect(screen.getByText("DELIVERY-LOT-31")).toBeInTheDocument();
    });
    expect(adminGet).toHaveBeenCalledWith("/api/admin/inventory-lots/pending", "test-token");
    expect(adminGet).toHaveBeenCalledWith("/api/iroc/inventory", "test-token");
  });
});