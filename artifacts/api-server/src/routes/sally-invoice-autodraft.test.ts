/**
 * Integration tests: Sally auto-drafted invoices (#496)
 *
 * What & Why
 * ──────────
 * Reviewed-complete orders trigger invoice auto-drafting from two paths at
 * once (post-review setImmediate + cron sweep), so creation must be:
 *   1. Deduplicated — concurrent runs create exactly ONE invoice per order
 *      (partial unique index on iroc_invoices.source_order_id).
 *   2. Atomic — a failing line-item insert must roll back the invoice header,
 *      otherwise a header-only invoice would permanently block regeneration.
 *   3. Dispatch emails must be queued as SEPARATE reviewable rows: billing
 *      (invoice + delivery note) and distinct shipping (delivery note ONLY),
 *      each deduplicated by the partial unique index.
 *
 * Gemini is mocked (fixed line parses); everything else runs against the real
 * dev database (tables/indexes created by the idempotent startup migrations).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import {
  pool as bootstrapPool,
  provisionMigrationBackedTestSchema,
  withDatabaseUrlsScopedToSchema,
} from "@workspace/db";

// ── Mock Gemini line parsing (dynamic import in sally-invoice.ts) ─────────────
const geminiState = vi.hoisted(() => ({ lines: [] as unknown[] }));
vi.mock("@workspace/integrations-gemini-ai", () => ({
  ai: {
    models: {
      generateContent: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify(geminiState.lines) }] } }],
      }),
    },
  },
}));

const EMAIL = "sally-autodraft-test@example.com";
const SHIP_EMAIL = "sally-autodraft-shipping@example.com";
const TEST_SCHEMA = `sally_invoice_autodraft_${process.pid}_${Date.now()}`;
const sharedDatabaseUrl = process.env.DATABASE_URL_INTERNAL ?? process.env.DATABASE_URL;
if (!sharedDatabaseUrl) throw new Error("A database URL is required");

let pool: typeof bootstrapPool;
let buildImpressumSignature: typeof import("../lib/impressum-signature.js").buildImpressumSignature;
let generateDraftInvoiceForOrder: typeof import("../lib/sally-invoice.js").generateDraftInvoiceForOrder;
let queueInvoiceDispatchEmail: typeof import("../lib/sally-invoice.js").queueInvoiceDispatchEmail;
let renderInvoiceAttachments: typeof import("../lib/sally-invoice.js").renderInvoiceAttachments;
let canonicalCountry: typeof import("../lib/sally-invoice.js").canonicalCountry;
let wcId: number;
let productId: number;
let productPrice: string;
const PRODUCT_SKU = "SALLY-DESC-TEST";

async function cleanup() {
  await pool.query(
    `DELETE FROM sally_email_queue WHERE related_invoice_id IN
       (SELECT id FROM iroc_invoices WHERE website_customer_id IN
         (SELECT id FROM website_customers WHERE email = $1))`,
    [EMAIL],
  );
  await pool.query(
    `DELETE FROM iroc_invoice_items WHERE invoice_id IN
       (SELECT id FROM iroc_invoices WHERE website_customer_id IN
         (SELECT id FROM website_customers WHERE email = $1))`,
    [EMAIL],
  );
  await pool.query(
    `DELETE FROM iroc_invoices WHERE website_customer_id IN
       (SELECT id FROM website_customers WHERE email = $1)`,
    [EMAIL],
  );
  await pool.query("DELETE FROM iroc_orders WHERE contact_email = $1", [EMAIL]);
  await pool.query("DELETE FROM iroc_notifications WHERE type = 'sally_invoice' AND message LIKE '%autodraft-test%'");
  await pool.query("DELETE FROM website_customers WHERE email IN ($1, $2)", [EMAIL, SHIP_EMAIL]);
  await pool.query("DELETE FROM iroc_products WHERE sku = $1", [PRODUCT_SKU]);
}

async function createOrder(products: string): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO iroc_orders
       (website_customer_id, customer_type, contact_email, instrument, products, delivery_address,
        approval_token, status, approved_at, sally_review_status, contact_language)
     VALUES ($1, 'existing', $2, 'spirecut', $3, 'Teststr. 1, 10115 Berlin',
             'autodraft-tok-' || md5(random()::text), 'approved', NOW(), 'complete', 'de')
     RETURNING id`,
    [wcId, EMAIL, products],
  );
  return rows[0].id;
}

beforeAll(async () => {
  await provisionMigrationBackedTestSchema(bootstrapPool, TEST_SCHEMA);
  await withDatabaseUrlsScopedToSchema(sharedDatabaseUrl, TEST_SCHEMA, async () => {
    vi.resetModules();
    pool = (await import("@workspace/db")).pool;
    buildImpressumSignature = (await import("../lib/impressum-signature.js")).buildImpressumSignature;
    const invoiceModule = await import("../lib/sally-invoice.js");
    generateDraftInvoiceForOrder = invoiceModule.generateDraftInvoiceForOrder;
    queueInvoiceDispatchEmail = invoiceModule.queueInvoiceDispatchEmail;
    renderInvoiceAttachments = invoiceModule.renderInvoiceAttachments;
    canonicalCountry = invoiceModule.canonicalCountry;
  });
  await cleanup();
  // Use a dedicated bilingual catalog product so the generated invoice can be
  // checked against the exact Product form descriptions in both languages.
  const { rows: prods } = await pool.query<{ id: number; unit_price: string }>(
    `INSERT INTO iroc_products
       (sku, name_de, name_en, description_de, description_en, unit_price, category)
     VALUES ($1, 'Sally Produkt', 'Sally Product',
             'Exakte deutsche Produktbeschreibung', 'Exact English product description',
             42.50, 'spirecut')
     RETURNING id, unit_price::text AS unit_price`,
    [PRODUCT_SKU],
  );
  productId = prods[0].id;
  productPrice = prods[0].unit_price;

  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO website_customers
       (customer_nr, first_name, last_name, email, address, postal_code, city, country,
        instrument, shipping_email, shipping_first_name, shipping_address)
     VALUES ('TEST-AD-1', 'Auto', 'Draft', $1, 'Teststr. 1', '10115', 'Berlin', 'Deutschland',
             'spirecut', $2, 'Ship', 'Lagerweg 2')
     RETURNING id`,
    [EMAIL, SHIP_EMAIL],
  );
  wcId = rows[0].id;

  // Trigger to force a line-item insert failure on demand (atomicity test)
  await pool.query(`
    CREATE OR REPLACE FUNCTION sally_autodraft_test_fail() RETURNS trigger AS $$
    BEGIN
      IF NEW.product_name = 'FAIL_TRIGGER' THEN
        RAISE EXCEPTION 'forced test failure';
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS sally_autodraft_test_fail_trg ON iroc_invoice_items;
    CREATE TRIGGER sally_autodraft_test_fail_trg
      BEFORE INSERT ON iroc_invoice_items
      FOR EACH ROW EXECUTE FUNCTION sally_autodraft_test_fail();
  `);
});

afterAll(async () => {
  await pool.query("DROP TRIGGER IF EXISTS sally_autodraft_test_fail_trg ON iroc_invoice_items");
  await pool.query("DROP FUNCTION IF EXISTS sally_autodraft_test_fail()");
  await cleanup();
  await pool.end();
  await bootstrapPool.query(`DROP SCHEMA "${TEST_SCHEMA}" CASCADE`);
});

describe("Sally auto-drafted invoices", () => {
  it("concurrent generation creates exactly ONE invoice with all line items", async () => {
    geminiState.lines = [
      { product_id: productId, name: "Mapped product", quantity: 2 },
      { product_id: null, name: "Sonderanfertigung XYZ", quantity: 1 },
    ];
    const orderId = await createOrder("2x mapped, 1x Sonderanfertigung XYZ");

    const results = await Promise.all([
      generateDraftInvoiceForOrder(orderId),
      generateDraftInvoiceForOrder(orderId),
      generateDraftInvoiceForOrder(orderId),
    ]);
    expect(results.filter(r => r === "created").length).toBe(1);
    expect(results.every(r => r === "created" || r === "exists" || r === null)).toBe(true);

    const { rows: invoices } = await pool.query(
      "SELECT id, subtotal, vat_rate, invoice_type, language, sally_generated FROM iroc_invoices WHERE source_order_id = $1",
      [orderId],
    );
    expect(invoices.length).toBe(1);
    expect(invoices[0].sally_generated).toBe(true);
    expect(invoices[0].invoice_type).toBe("domestic"); // 'Deutschland' free text → DE
    expect(Number(invoices[0].vat_rate)).toBe(19);
    expect(invoices[0].language).toBe("de");
    // subtotal = 2 × catalog price (unmapped line contributes 0)
    expect(Number(invoices[0].subtotal)).toBeCloseTo(2 * Number(productPrice), 2);

    const { rows: items } = await pool.query(
      "SELECT product_id, description, unit_price::text AS unit_price FROM iroc_invoice_items WHERE invoice_id = $1 ORDER BY id",
      [invoices[0].id],
    );
    expect(items.length).toBe(2);
    expect(items[0].product_id).toBe(productId);
    expect(items[0].description).toBe("Exakte deutsche Produktbeschreibung");
    expect(items[1].product_id).toBeNull();
    expect(Number(items[1].unit_price)).toBe(0); // unmapped → price 0, flagged
  });

  it("uses the English Product form description for an English auto-drafted invoice", async () => {
    await pool.query("UPDATE website_customers SET country = 'United States' WHERE id = $1", [wcId]);
    try {
      geminiState.lines = [{ product_id: productId, name: "English mapped product", quantity: 1 }];
      const orderId = await createOrder("1x English mapped product");
      expect(await generateDraftInvoiceForOrder(orderId)).toBe("created");

      const { rows } = await pool.query(
        `SELECT i.language, ii.description
           FROM iroc_invoices i
           JOIN iroc_invoice_items ii ON ii.invoice_id = i.id
          WHERE i.source_order_id = $1`,
        [orderId],
      );
      expect(rows).toEqual([{
        language: "en",
        description: "Exact English product description",
      }]);
    } finally {
      await pool.query("UPDATE website_customers SET country = 'Deutschland' WHERE id = $1", [wcId]);
    }
  });

  it("a failing line-item insert rolls back the header (no header-only invoice, retriable)", async () => {
    geminiState.lines = [{ product_id: null, name: "FAIL_TRIGGER", quantity: 1 }];
    const orderId = await createOrder("something odd");

    const result = await generateDraftInvoiceForOrder(orderId);
    expect(result).toBeNull(); // failure reported, not swallowed as success

    const { rows } = await pool.query("SELECT id FROM iroc_invoices WHERE source_order_id = $1", [orderId]);
    expect(rows.length).toBe(0); // no header-only invoice left behind

    // Recovery: once the failure cause is gone, the same order drafts cleanly
    geminiState.lines = [{ product_id: productId, name: "ok now", quantity: 1 }];
    expect(await generateDraftInvoiceForOrder(orderId)).toBe("created");
  });

  it("dispatch queues separate billing and shipping rows, deduplicated, with correct attachment policy", async () => {
    geminiState.lines = [{ product_id: productId, name: "dispatch test", quantity: 1 }];
    const orderId = await createOrder("1x dispatch test");
    expect(await generateDraftInvoiceForOrder(orderId)).toBe("created");
    const { rows: invs } = await pool.query<{ id: number }>(
      "SELECT id FROM iroc_invoices WHERE source_order_id = $1",
      [orderId],
    );
    const invoiceId = invs[0].id;
    await pool.query("UPDATE iroc_invoices SET status = 'sent' WHERE id = $1", [invoiceId]);

    await queueInvoiceDispatchEmail(invoiceId);
    await queueInvoiceDispatchEmail(invoiceId); // idempotent — no duplicates

    const { rows: queued } = await pool.query(
      `SELECT recipient_email, trigger_type, status, body, detected_language FROM sally_email_queue
       WHERE related_invoice_id = $1 ORDER BY trigger_type`,
      [invoiceId],
    );
    expect(queued.length).toBe(2);
    expect(queued[0]).toMatchObject({ recipient_email: EMAIL, trigger_type: "invoice_dispatch", status: "pending" });
    expect(queued[1]).toMatchObject({ recipient_email: SHIP_EMAIL, trigger_type: "invoice_dispatch_shipping", status: "pending" });
    expect(queued[0].detected_language).toBe("de");
    expect(queued[1].detected_language).toBe("de");
    const currentGermanSignature = await buildImpressumSignature("de");
    expect(queued[0].body).toContain(currentGermanSignature);
    expect(queued[1].body).toContain(currentGermanSignature);

    // Billing gets invoice + delivery note; shipping gets the delivery note ONLY
    const billing = await renderInvoiceAttachments(invoiceId, { includeInvoice: true });
    expect(billing.map(a => a.filename.startsWith("LS-"))).toEqual([false, true]);
    expect(billing.every(a => a.content.length > 1000)).toBe(true);

    const shipping = await renderInvoiceAttachments(invoiceId, { includeInvoice: false });
    expect(shipping.length).toBe(1);
    expect(shipping[0].filename.startsWith("LS-")).toBe(true);
  });

  it("canonicalCountry maps free-text country names to ISO codes", () => {
    expect(canonicalCountry("Deutschland")).toBe("DE");
    expect(canonicalCountry("Germany")).toBe("DE");
    expect(canonicalCountry("Österreich")).toBe("AT");
    expect(canonicalCountry("france")).toBe("FR");
    expect(canonicalCountry("Schweiz")).toBe("CH");
    expect(canonicalCountry("AT")).toBe("AT");
    expect(canonicalCountry("")).toBe("DE");
    expect(canonicalCountry(null)).toBe("DE");
  });
});
