/**
 * Database-backed regression test for GET /api/iroc/dashboard.
 *
 * The unit test in dashboard-new-orders-filter.test.ts verifies the query
 * predicate and response mapping with mocked rows. This test uses the real
 * dashboard query against Postgres so duplicate invoice rows must be grouped
 * before the five-customer limit is applied.
 */
import crypto from "crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";
import app from "../app";

const testKey = crypto.randomUUID().replace(/-/g, "");
const emailPrefix = `dashboard-new-orders-${testKey}`;
const customerSpecs = [
  {
    label: "grouped",
    email: `${emailPrefix}-grouped@example.com`,
    firstName: "Grouped",
    lastName: "Customer",
    createdAt: "2099-01-01T00:00:06Z",
  },
  {
    label: "mixed",
    email: `${emailPrefix}-mixed@example.com`,
    firstName: "Mixed",
    lastName: "Customer",
    createdAt: "2099-01-01T00:00:07Z",
  },
  {
    label: "newest",
    email: `${emailPrefix}-newest@example.com`,
    firstName: "Newest",
    lastName: "Customer",
    createdAt: "2099-01-01T00:00:05Z",
  },
  {
    label: "second",
    email: `${emailPrefix}-second@example.com`,
    firstName: "Second",
    lastName: "Customer",
    createdAt: "2099-01-01T00:00:04Z",
  },
  {
    label: "third",
    email: `${emailPrefix}-third@example.com`,
    firstName: "Third",
    lastName: "Customer",
    createdAt: "2099-01-01T00:00:03Z",
  },
  {
    label: "fourth",
    email: `${emailPrefix}-fourth@example.com`,
    firstName: "Fourth",
    lastName: "Customer",
    createdAt: "2099-01-01T00:00:02Z",
  },
  {
    label: "oldest",
    email: `${emailPrefix}-oldest@example.com`,
    firstName: "Oldest",
    lastName: "Customer",
    createdAt: "2099-01-01T00:00:01Z",
  },
  {
    label: "paid-only",
    email: `${emailPrefix}-paid-only@example.com`,
    firstName: "Paid",
    lastName: "Only",
    createdAt: "2099-01-01T00:00:08Z",
  },
  {
    label: "cancelled-only",
    email: `${emailPrefix}-cancelled-only@example.com`,
    firstName: "Cancelled",
    lastName: "Only",
    createdAt: "2099-01-01T00:00:09Z",
  },
] as const;

const customerEmails = customerSpecs.map((customer) => customer.email);
const invoiceNumbers = [
  `${emailPrefix}-grouped-draft`,
  `${emailPrefix}-grouped-sent`,
  `${emailPrefix}-mixed-draft`,
  `${emailPrefix}-mixed-paid`,
  `${emailPrefix}-mixed-cancelled`,
  `${emailPrefix}-newest`,
  `${emailPrefix}-second`,
  `${emailPrefix}-third`,
  `${emailPrefix}-fourth`,
  `${emailPrefix}-oldest`,
  `${emailPrefix}-paid-only`,
  `${emailPrefix}-cancelled-only`,
];

const SECRET = process.env.SESSION_SECRET ?? "iroc-fallback-secret";

function makeIrocAuth(): string {
  const payload = {
    userId: 1,
    username: "admin",
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", SECRET)
    .update(encoded)
    .digest("base64url");
  return `Bearer ${encoded}.${signature}`;
}

async function cleanup() {
  await pool.query(
    "DELETE FROM iroc_invoices WHERE invoice_number = ANY($1::text[])",
    [invoiceNumbers],
  );
  await pool.query(
    "DELETE FROM website_customers WHERE email = ANY($1::text[])",
    [customerEmails],
  );
}

async function seedFixture() {
  const customerValuePlaceholders = customerSpecs
    .map((_, index) => {
      const offset = index * 6;
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`;
    })
    .join(", ");
  const customerValues = customerSpecs.flatMap((customer) => [
    customer.email,
    customer.firstName,
    customer.lastName,
    `${customer.firstName} Clinic`,
    "iroc",
    customer.createdAt,
  ]);

  const { rows: customers } = await pool.query<{ id: number; email: string }>(
    `INSERT INTO website_customers
       (email, first_name, last_name, institution_name, instrument, created_at)
     VALUES ${customerValuePlaceholders}
     RETURNING id, email`,
    customerValues,
  );
  const customerIdByEmail = new Map(
    customers.map((customer) => [customer.email, customer.id]),
  );

  const invoiceRows = [
    ["grouped-draft", "grouped", "draft"],
    ["grouped-sent", "grouped", "sent"],
    ["mixed-draft", "mixed", "draft"],
    ["mixed-paid", "mixed", "paid"],
    ["mixed-cancelled", "mixed", "cancelled"],
    ["newest", "newest", "draft"],
    ["second", "second", "draft"],
    ["third", "third", "draft"],
    ["fourth", "fourth", "draft"],
    ["oldest", "oldest", "draft"],
    ["paid-only", "paid-only", "paid"],
    ["cancelled-only", "cancelled-only", "cancelled"],
  ] as const;
  const invoiceValuePlaceholders = invoiceRows
    .map((_, index) => {
      const offset = index * 3;
      return `($${offset + 1}, $${offset + 2}, 'domestic', '2099-01-01', $${offset + 3})`;
    })
    .join(", ");
  const invoiceValues = invoiceRows.flatMap(
    ([suffix, customerLabel, status]) => {
      const customer = customerSpecs.find(
        (candidate) => candidate.label === customerLabel,
      );
      if (!customer)
        throw new Error(`Missing customer fixture: ${customerLabel}`);
      const customerId = customerIdByEmail.get(customer.email);
      if (customerId === undefined)
        throw new Error(`Customer was not inserted: ${customer.email}`);
      return [`${emailPrefix}-${suffix}`, customerId, status];
    },
  );

  await pool.query(
    `INSERT INTO iroc_invoices
       (invoice_number, website_customer_id, invoice_type, issue_date, status)
     VALUES ${invoiceValuePlaceholders}`,
    invoiceValues,
  );
}

beforeAll(async () => {
  await cleanup();
  await seedFixture();
});

afterAll(cleanup);

describe("GET /api/iroc/dashboard — New Orders with real invoice data", () => {
  it("groups open invoices before limiting to the five newest customers", async () => {
    const response = await request(app)
      .get("/api/iroc/dashboard")
      .set("Authorization", makeIrocAuth());

    expect(response.status).toBe(200);
    expect(response.body.recentOrders).toHaveLength(5);
    expect(
      response.body.recentOrders.map((order: { email: string }) => order.email),
    ).toEqual([
      `${emailPrefix}-mixed@example.com`,
      `${emailPrefix}-grouped@example.com`,
      `${emailPrefix}-newest@example.com`,
      `${emailPrefix}-second@example.com`,
      `${emailPrefix}-third@example.com`,
    ]);

    const groupedOrder = response.body.recentOrders.find(
      (order: { email: string }) =>
        order.email === `${emailPrefix}-grouped@example.com`,
    );
    expect(groupedOrder).toMatchObject({
      email: `${emailPrefix}-grouped@example.com`,
      openOrderCount: 2,
    });
    const mixedOrders = response.body.recentOrders.filter(
      (order: { email: string }) =>
        order.email === `${emailPrefix}-mixed@example.com`,
    );
    expect(mixedOrders).toHaveLength(1);
    expect(mixedOrders[0]).toMatchObject({
      email: `${emailPrefix}-mixed@example.com`,
      openOrderCount: 1,
    });
    expect(response.body.recentOrders).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ email: `${emailPrefix}-paid-only@example.com` }),
        expect.objectContaining({ email: `${emailPrefix}-cancelled-only@example.com` }),
      ]),
    );
  });
});
