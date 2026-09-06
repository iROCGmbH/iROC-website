import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Tori from "./Tori";

const testState = vi.hoisted(() => ({ lang: "en" as "en" | "de" }));

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ token: "test-token" }) }));
vi.mock("@/hooks/use-language", () => ({ useLanguage: () => testState }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const unconfirmedDraft = {
  id: 41,
  product_name: "Spirecut",
  product_sku: "SP-1",
  vendor_email: "supplier@example.test",
  vendor_country: "Germany",
  quantity_to_order: 10,
  contract_price: "20.00",
  sales_milestone_achieved: false,
  email_to: "supplier@example.test",
  email_subject: "Reorder",
  email_body_markdown: "Body",
  status: "unconfirmed",
  email_send_error: "unconfirmed",
  email_sent_at: null,
  email_message_id: null,
  send_attempt_id: "attempt-1271",
  send_claimed_at: "2026-01-01T00:00:00Z",
  email_last_attempt_at: "2026-01-01T00:00:00Z",
  send_attempt_count: 1,
  delivery_provider: "smtp",
  email_content_sha256: "hash",
  reconciled_at: null,
  reconciliation_action: null,
  created_at: "2026-01-01T00:00:00Z",
  stock_quantity: 0,
  low_stock_threshold: 2,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  testState.lang = "en";
});

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

describe("Tori reorder delivery recovery", () => {
  it.each([
    ["en", "Delivery unconfirmed — do not retry", "Confirm delivery for Spirecut", "Confirm non-delivery and allow retry for Spirecut"],
    ["de", "Zustellung unbestätigt – nicht erneut senden", "Zustellung für Spirecut bestätigen", "Nichtzustellung bestätigen und erneuten Versuch für Spirecut erlauben"],
  ] as const)("offers keyboard-operable, accessible recovery in %s", async (lang, status, confirmName, retryName) => {
    testState.lang = lang;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("/pending-actions")) return { ok: true, json: async () => [] } as Response;
      if (url.includes("/products?low_stock=true")) return { ok: true, json: async () => [] } as Response;
      if (url.endsWith("/reorder-queue")) return { ok: true, json: async () => [unconfirmedDraft] } as Response;
      if (url.includes("/reconcile")) {
        return { ok: true, json: async () => ({ ...unconfirmedDraft, status: "approved" }) } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });

    render(<Tori />);
    fireEvent.click(screen.getByRole("button", { name: lang === "de" ? "Bestellwarteschlange" : "Reorder Queue" }));

    expect(await screen.findByText(status)).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: confirmName });
    expect(screen.getByRole("button", { name: retryName })).toBeEnabled();
    confirm.focus();
    fireEvent.keyDown(confirm, { key: "Enter", code: "Enter" });
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/iroc/tori/reorder-queue/41/reconcile",
        expect.objectContaining({ method: "PATCH" }),
      );
    });
  });
});