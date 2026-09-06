/**
 * Regression test for PATCH /api/iroc/invoices/:id/items/:itemId.
 *
 * An item ID must only be editable through the invoice it belongs to. A stale
 * detail-page URL can pair an item with another invoice, so the request must
 * return not found without changing either invoice's line items.
 */
import crypto from "crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";
import app from "../app";

const testKey = crypto.randomUUID().replace(/-/g, "");
const invoiceNumbers = [`ITEM-SCOPE-A-${testKey}`, `ITEM-SCOPE-B-${testKey}`];
const productSkus = [`ITEM-SCOPE-P-A-${testKey}`, `ITEM-SCOPE-P-B-${testKey}`];

const SECRET = process.env.SESSION_SECRET ?? "iroc-fallback-secret";

function makeIrocAuth(): string {
  const payload = {
    userId: 1,
    username: "admin",
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", SECRET).update(encoded).digest("base64url");
  return `Bearer ${encoded}.${signature}`;
}

let invoiceAId: number;
let invoiceBId: number;
let itemAId: number;
let itemBId: number;
let productAId: number;
let productBId: number;

async function cleanup() {
  await pool.query(
    "DELETE FROM iroc_invoice_items WHERE invoice_id IN (SELECT id FROM iroc_invoices WHERE invoice_number = ANY($1::text[]))",
    [invoiceNumbers],
  );
  await pool.query("DELETE FROM iroc_invoices WHERE invoice_number = ANY($1::text[])", [invoiceNumbers]);
  await pool.query("DELETE FROM iroc_products WHERE sku = ANY($1::text[])", [productSkus]);
}

async function readItemState() {
  const { rows } = await pool.query(
    `SELECT invoice_id, product_id, hs_code, country_of_origin, weight_kg::text AS weight_kg
     FROM iroc_invoice_items
     WHERE invoice_id = ANY($1::int[])
     ORDER BY invoice_id`,
    [[invoiceAId, invoiceBId]],
  );
  return rows;
}

beforeAll(async () => {
  await cleanup();

  const products = await pool.query<{ id: number }>(
    `INSERT INTO iroc_products (sku, name_de, name_en, unit_price, category)
     VALUES
       ($1, 'Produkt A', 'Product A', 10, 'other'),
       ($2, 'Produkt B', 'Product B', 20, 'other')
     RETURNING id
    `,
    productSkus,
  );
  [productAId, productBId] = products.rows.map(row => row.id);

  const invoices = await pool.query<{ id: number }>(
    `INSERT INTO iroc_invoices (invoice_number, invoice_type, issue_date)
     VALUES ($1, 'domestic', '2026-09-02'), ($2, 'domestic', '2026-09-02')
     RETURNING id
    `,
    invoiceNumbers,
  );
  [invoiceAId, invoiceBId] = invoices.rows.map(row => row.id);

  await pool.query(
    `INSERT INTO iroc_invoice_items
       (invoice_id, product_id, product_name, unit_price, quantity, line_total,
        hs_code, country_of_origin, weight_kg)
     VALUES
       ($1, $3, 'Produkt A', 10, 1, 10, '90189084', 'DE', 0.125),
       ($2, $4, 'Produkt B', 20, 1, 20, '90189084', 'CH', 0.250)
    `,
    [invoiceAId, invoiceBId, productAId, productBId],
  );

  const itemA = await pool.query<{ id: number }>(
    "SELECT id FROM iroc_invoice_items WHERE invoice_id = $1",
    [invoiceAId],
  );
  itemAId = itemA.rows[0].id;

  const itemB = await pool.query<{ id: number }>(
    "SELECT id FROM iroc_invoice_items WHERE invoice_id = $1",
    [invoiceBId],
  );
  itemBId = itemB.rows[0].id;
});

afterAll(cleanup);

describe("PATCH /api/iroc/invoices/:id/items/:itemId", () => {
  it("rejects an item paired with a different invoice without changing either invoice", async () => {
    const before = await readItemState();

    const response = await request(app)
      .patch(`/api/iroc/invoices/${invoiceAId}/items/${itemBId}`)
      .set("Authorization", makeIrocAuth())
      .send({ productId: productAId });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Item not found" });
    expect(await readItemState()).toEqual(before);
  });

  it("updates the selected invoice item when the invoice and item IDs match", async () => {
    const before = await readItemState();

    const response = await request(app)
      .patch(`/api/iroc/invoices/${invoiceAId}/items/${itemAId}`)
      .set("Authorization", makeIrocAuth())
      .send({ productId: productBId });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: itemAId,
      productId: productBId,
    });

    const after = await readItemState();
    expect(after.find((item) => item.invoice_id === invoiceAId)).toMatchObject({
      invoice_id: invoiceAId,
      product_id: productBId,
    });
    expect(after.find((item) => item.invoice_id === invoiceBId)).toEqual(
      before.find((item) => item.invoice_id === invoiceBId),
    );
  });

  it("clears a matching product link without changing customs details", async () => {
    const before = (await readItemState()).find((item) => item.invoice_id === invoiceAId);

    const response = await request(app)
      .patch(`/api/iroc/invoices/${invoiceAId}/items/${itemAId}`)
      .set("Authorization", makeIrocAuth())
      .send({ productId: null });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: itemAId,
      productId: null,
      hsCode: before.hs_code,
      countryOfOrigin: before.country_of_origin,
      weightKg: before.weight_kg,
    });
    expect((await readItemState()).find((item) => item.invoice_id === invoiceAId)).toEqual({
      ...before,
      product_id: null,
    });
  });

  it("switches a matching product link without replacing corrected customs details", async () => {
    // Restore product A so this test proves a genuine association change.
    await pool.query(
      "UPDATE iroc_invoice_items SET product_id = $1 WHERE id = $2",
      [productAId, itemAId],
    );
    const before = (await readItemState()).find((item) => item.invoice_id === invoiceAId);

    const response = await request(app)
      .patch(`/api/iroc/invoices/${invoiceAId}/items/${itemAId}`)
      .set("Authorization", makeIrocAuth())
      .send({ productId: productBId });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: itemAId,
      productId: productBId,
      hsCode: before.hs_code,
      countryOfOrigin: before.country_of_origin,
      weightKg: before.weight_kg,
    });
    expect((await readItemState()).find((item) => item.invoice_id === invoiceAId)).toEqual({
      ...before,
      product_id: productBId,
    });
  });
});