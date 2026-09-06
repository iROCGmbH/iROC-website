/**
 * PostgreSQL integration coverage for the returned-products correction flow.
 * This suite receives an isolated migration-backed schema because correction
 * tests deliberately mutate invoices, inventory, and PostgreSQL triggers.
 */
import crypto from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import {
  pool as bootstrapPool,
  provisionMigrationBackedTestSchema,
  withDatabaseUrlsScopedToSchema,
} from "@workspace/db";
import JSZip from "jszip";
import jwt from "jsonwebtoken";

const key = crypto.randomUUID().replace(/-/g, "");
const prefix = `CORRECTION-DB-${key}`;
const sku = `${prefix}-PRODUCT`;
const foreignSku = `${prefix}-FOREIGN`;
const secret = process.env.SESSION_SECRET ?? "iroc-fallback-secret";
const TEST_SCHEMA = `invoice_corrections_${process.pid}_${Date.now()}`;
const sharedDatabaseUrl = process.env.DATABASE_URL_INTERNAL ?? process.env.DATABASE_URL;

if (!sharedDatabaseUrl) {
  throw new Error("DATABASE_URL_INTERNAL or DATABASE_URL is required for this integration test");
}

let app: Express;
let pool: typeof bootstrapPool;

function authorizationHeader() {
  const payload = Buffer.from(JSON.stringify({
    userId: 1, username: "admin", exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString("base64url");
  return `Bearer ${payload}.${crypto.createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

function portalAuthorizationHeader(customerId: number) {
  return `Bearer ${jwt.sign({
    customerId, customerNr: `${prefix}-PORTAL`, instrument: "spirecut",
  }, secret, { expiresIn: "1h" })}`;
}

let productId: number;
let foreignProductId: number;
let lotId: number;
let customerId: number;

type Source = { invoiceId: number; itemId: number };

async function source(name: string, options: { status?: string; quantity?: number; total?: string; productId?: number; lotNumber?: string | null; customerId?: number } = {}): Promise<Source> {
  const status = options.status ?? "sent";
  const quantity = options.quantity ?? 3;
  const total = options.total ?? "10.00";
  const itemProductId = options.productId ?? productId;
  const lotNumber = options.lotNumber === undefined ? `${prefix}-LOT` : options.lotNumber;
  const invoice = await pool.query<{ id: number }>(
    `INSERT INTO iroc_invoices (invoice_number, website_customer_id, invoice_type, issue_date, status, vat_rate, subtotal, vat_amount, total)
     VALUES ($1, $2, 'domestic', '2026-01-02', $3, 19, $4, 1.90, $4) RETURNING id`,
    [`${prefix}-${name}`, options.customerId ?? customerId, status, total],
  );
  const item = await pool.query<{ id: number }>(
    `INSERT INTO iroc_invoice_items (invoice_id, product_id, product_name, sku, lot_number, unit_price, quantity, line_total, vat_rate)
     VALUES ($1, $2, 'Returned product', $3, $4, 10.00, $5, $6, 19) RETURNING id`,
    [invoice.rows[0].id, itemProductId, itemProductId === productId ? sku : foreignSku, lotNumber, quantity, total],
  );
  return { invoiceId: invoice.rows[0].id, itemId: item.rows[0].id };
}

function correction(invoiceId: number, itemId: number, quantity = 1, reason = "Returned unopened") {
  return request(app).post(`/api/iroc/invoices/${invoiceId}/corrections`)
    .set("Authorization", authorizationHeader())
    .send({ reason, items: [{ invoiceItemId: itemId, quantity }] });
}

async function inventory() {
  const [product, lot] = await Promise.all([
    pool.query<{ stock_quantity: number }>("SELECT stock_quantity FROM iroc_products WHERE id = $1", [productId]),
    pool.query<{ quantity_used: number }>("SELECT quantity_used FROM iroc_inventory_lots WHERE id = $1", [lotId]),
  ]);
  return { stock: product.rows[0].stock_quantity, used: lot.rows[0].quantity_used };
}

beforeAll(async () => {
  await provisionMigrationBackedTestSchema(bootstrapPool, TEST_SCHEMA);
  await withDatabaseUrlsScopedToSchema(sharedDatabaseUrl, TEST_SCHEMA, async () => {
    vi.resetModules();
    ({ pool } = await import("@workspace/db"));
    ({ default: app } = await import("../app.js"));
  });

  const customer = await pool.query<{ id: number }>(
    `INSERT INTO website_customers
       (first_name, last_name, institution_name, street, house_number, postal_code, city, country, email, instrument, ust_id_nr)
     VALUES ('Original', 'Buyer', 'Original Clinic', 'Old Street', '7', '10115', 'Berlin', 'DE', $1, 'spirecut', 'DE123456789')
     RETURNING id`,
    [`${prefix.toLowerCase()}@example.test`],
  );
  customerId = customer.rows[0].id;
  const products = await pool.query<{ id: number }>(
    `INSERT INTO iroc_products (sku, name_de, name_en, unit_price, stock_quantity, category)
     VALUES ($1, 'Korrekturprodukt', 'Correction product', 10, 20, 'other'),
            ($2, 'Fremdprodukt', 'Foreign product', 10, 20, 'other')
     RETURNING id`,
    [sku, foreignSku],
  );
  [productId, foreignProductId] = products.rows.map(row => row.id);
  const lot = await pool.query<{ id: number }>(
    `INSERT INTO iroc_inventory_lots (product_id, lot_number, purchase_date, quantity_received, quantity_used)
     VALUES ($1, $2, '2026-01-01', 30, 5) RETURNING id`,
    [productId, `${prefix}-LOT`],
  );
  lotId = lot.rows[0].id;
});

afterAll(async () => {
  await pool.end();
  await bootstrapPool.query(`DROP SCHEMA IF EXISTS "${TEST_SCHEMA}" CASCADE`);
});

describe("invoice corrections against PostgreSQL", () => {
  it("enforces source eligibility, whitespace reasons, foreign lines, and blocks duplicating corrections", async () => {
    const draft = await source("DRAFT", { status: "draft" });
    expect((await correction(draft.invoiceId, draft.itemId)).status).toBe(409);
    expect((await correction(draft.invoiceId, draft.itemId, 1, "   ")).status).toBe(400);

    const valid = await source("VALID");
    const made = await correction(valid.invoiceId, valid.itemId);
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect((await correction(made.body.id, valid.itemId)).status).toBe(409);

    const other = await source("OTHER", { productId: foreignProductId, lotNumber: null });
    expect((await correction(valid.invoiceId, other.itemId)).status).toBe(409);
    expect((await request(app).post(`/api/iroc/invoices/${made.body.id}/duplicate`)
      .set("Authorization", authorizationHeader()).send({})).status).toBe(410);
  });

  it("prevents cumulative over-returns and serializes simultaneous requests with the source FOR UPDATE lock", async () => {
    const one = await source("OVER", { quantity: 2, total: "20.00" });
    expect((await correction(one.invoiceId, one.itemId, 2)).status).toBe(201);
    expect((await correction(one.invoiceId, one.itemId, 1)).status).toBe(409);

    const concurrent = await source("CONCURRENT", { quantity: 1, total: "10.00" });
    const responses = await Promise.all([
      correction(concurrent.invoiceId, concurrent.itemId),
      correction(concurrent.invoiceId, concurrent.itemId),
    ]);
    expect(responses.filter(response => response.status === 201)).toHaveLength(1);
    expect(responses.filter(response => response.status === 409)).toHaveLength(1);
  });

  it("allocates every original cent across three one-unit corrections", async () => {
    const original = await source("CENTS");
    const corrections = [];
    for (let n = 0; n < 3; n++) {
      const response = await correction(original.invoiceId, original.itemId);
      expect(response.status).toBe(201);
      corrections.push(response.body.id as number);
    }
    const totals = await pool.query<{ total: string }>(
      `SELECT line_total::text AS total FROM iroc_invoice_items
       WHERE invoice_id = ANY($1::int[]) ORDER BY invoice_id`,
      [corrections],
    );
    expect(totals.rows.map(row => row.total)).toEqual(["-3.35", "-3.33", "-3.32"]);
    expect(totals.rows.reduce((sum, row) => sum + Number(row.total), 0)).toBe(-10);
    const invoices = await pool.query<{ subtotal: string; vat_amount: string; total: string }>(
      `SELECT subtotal::text, vat_amount::text, total::text FROM iroc_invoices
       WHERE id = ANY($1::int[]) ORDER BY id`, [corrections],
    );
    expect(invoices.rows.reduce((sum, row) => sum + Number(row.subtotal), 0)).toBe(-10);
    expect(invoices.rows.reduce((sum, row) => sum + Number(row.vat_amount), 0)).toBe(-1.9);
    expect(invoices.rows.reduce((sum, row) => sum + Number(row.total), 0)).toBe(-11.9);
    for (const id of corrections) {
      expect((await request(app).get(`/api/iroc/invoices/${id}/pdf`)
        .set("Authorization", authorizationHeader())).status).toBe(200);
    }
  });

  it("uses the normalized immutable buyer snapshot after the live customer is changed and deleted", async () => {
    const snapshotCustomer = await pool.query<{ id: number }>(
      `INSERT INTO website_customers
         (first_name, last_name, institution_name, street, house_number, postal_code, city, country, email, instrument, ust_id_nr)
       VALUES ('Original', 'Buyer', 'Original Clinic', 'Old Street', '7', '10115', 'Berlin', 'DE', $1, 'spirecut', 'DE123456789')
       RETURNING id`,
      [`${prefix.toLowerCase()}-snapshot@example.test`],
    );
    const snapshotCustomerId = snapshotCustomer.rows[0].id;
    const original = await source("SNAPSHOT", { customerId: snapshotCustomerId });
    const made = await correction(original.invoiceId, original.itemId);
    expect(made.status).toBe(201);
    await pool.query("UPDATE website_customers SET first_name = 'Changed', street = 'Changed Street', ust_id_nr = NULL WHERE id = $1", [snapshotCustomerId]);
    await pool.query("UPDATE iroc_invoices SET website_customer_id = NULL WHERE id = $1", [original.invoiceId]);
    // Correction rows deliberately carry no live customer FK; the snapshot is
    // sufficient for all legal output paths.
    await pool.query("DELETE FROM website_customers WHERE id = $1", [snapshotCustomerId]);
    const detail = await request(app).get(`/api/iroc/invoices/${made.body.id}`)
      .set("Authorization", authorizationHeader());
    expect(detail.status).toBe(200);
    expect(detail.body.customer).toMatchObject({
      name: "Original Buyer", company: "Original Clinic", street: "Old Street",
      houseNumber: "7", postalCode: "10115", city: "Berlin", vatId: "DE123456789",
    });
    expect((await request(app).get(`/api/iroc/invoices/${made.body.id}/pdf`)
      .set("Authorization", authorizationHeader())).status).toBe(200);
  });

  it("keeps a finalized correction traceable to its original buyer in the portal and DATEV archive", async () => {
    const original = await source("PORTAL-DATEV");
    const created = await correction(original.invoiceId, original.itemId);
    expect(created.status).toBe(201);
    const correctionId = created.body.id as number;
    const correctionNumber = created.body.invoiceNumber as string;

    expect((await request(app)
      .patch(`/api/iroc/invoices/${correctionId}/status`)
      .set("Authorization", authorizationHeader())
      .send({ status: "sent" })).status).toBe(200);

    const portalInvoices = await request(app)
      .get("/api/portal/invoices")
      .set("Authorization", portalAuthorizationHeader(customerId));
    expect(portalInvoices.status).toBe(200);
    expect(portalInvoices.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: correctionId,
        correctionOfInvoiceId: original.invoiceId,
      }),
    ]));

    const archive = await request(app)
      .post("/api/iroc/datev/download")
      .set("Authorization", authorizationHeader())
      .send({ invoiceIds: [correctionId] })
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    expect(archive.status).toBe(200);
    const zip = await JSZip.loadAsync(archive.body as Buffer);
    const xml = await zip.file("document_data.xml")!.async("string");
    expect(xml).toContain(correctionNumber);
  });

  it("allows cancelling a draft correction, but makes correction documents and lines immutable", async () => {
    const original = await source("IMMUTABLE");
    const created = await correction(original.invoiceId, original.itemId);
    const correctionId = created.body.id as number;

    const line = await pool.query<{ id: number }>("SELECT id FROM iroc_invoice_items WHERE invoice_id = $1", [correctionId]);
    expect((await request(app).patch(`/api/iroc/invoices/${correctionId}/status`)
      .set("Authorization", authorizationHeader()).send({ status: "cancelled" })).status).toBe(200);
    expect((await request(app).put(`/api/iroc/invoices/${correctionId}`)
      .set("Authorization", authorizationHeader()).send({})).status).toBe(409);
    expect((await request(app).patch(`/api/iroc/invoices/${correctionId}/items/${line.rows[0].id}`)
      .set("Authorization", authorizationHeader()).send({ hsCode: "99999999" })).status).toBe(409);
  });

  it("finalizes concurrently exactly once and blocks all finalized correction reversals", async () => {
    const original = await source("FINAL");
    const created = await correction(original.invoiceId, original.itemId, 2);
    const correctionId = created.body.id as number;

    const before = await inventory();
    const responses = await Promise.all([
      request(app).patch(`/api/iroc/invoices/${correctionId}/status`).set("Authorization", authorizationHeader()).send({ status: "sent" }),
      request(app).patch(`/api/iroc/invoices/${correctionId}/status`).set("Authorization", authorizationHeader()).send({ status: "paid" }),
    ]);
    expect(responses.filter(response => response.status === 200)).toHaveLength(2);
    expect(await inventory()).toEqual({ stock: before.stock + 2, used: before.used - 2 });
    for (const status of ["draft", "cancelled"]) {
      expect((await request(app).patch(`/api/iroc/invoices/${correctionId}/status`)
        .set("Authorization", authorizationHeader()).send({ status })).status).toBe(409);
    }
    expect((await request(app).delete(`/api/iroc/invoices/${correctionId}`)
      .set("Authorization", authorizationHeader())).status).toBe(409);
  });

  it("rolls status, idempotency marker, and inventory back together when finalization fails", async () => {
    const original = await source("ROLLBACK");
    const created = await correction(original.invoiceId, original.itemId);
    const correctionId = created.body.id as number;

    const trigger = `correction_rollback_${key}`;
    const fn = `${trigger}_fn`;
    const before = await inventory();
    try {
      await pool.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced correction rollback'; END $$`);
      await pool.query(`CREATE TRIGGER ${trigger} BEFORE UPDATE ON iroc_products FOR EACH ROW WHEN (NEW.id = ${productId}) EXECUTE FUNCTION ${fn}()`);
      expect((await request(app).patch(`/api/iroc/invoices/${correctionId}/status`)
        .set("Authorization", authorizationHeader()).send({ status: "sent" })).status).toBe(409);
      const state = await pool.query<{ status: string; inventory_restored_at: Date | null }>(
        "SELECT status, inventory_restored_at FROM iroc_invoices WHERE id = $1", [correctionId],
      );
      expect(state.rows[0]).toEqual({ status: "draft", inventory_restored_at: null });
      expect(await inventory()).toEqual(before);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${trigger} ON iroc_products`);
      await pool.query(`DROP FUNCTION IF EXISTS ${fn}()`);
    }
  });
});
