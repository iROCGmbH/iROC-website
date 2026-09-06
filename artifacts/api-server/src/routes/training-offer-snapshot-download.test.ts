/**
 * Regression coverage for immutable lead training-offer downloads.
 *
 * The offer is issued from a lead snapshot. Re-downloading it must keep using
 * that snapshot even if the live lead is edited later, and corrupted snapshot
 * data must fail safely without changing the lead or duplicating the offer.
 */

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import request from "supertest";
import crypto from "crypto";
import { pool } from "@workspace/db";

const { pdfState, pdfDocumentsCreated } = vi.hoisted(() => ({
  pdfState: { capturedText: [] as string[] },
  pdfDocumentsCreated: { count: 0 },
}));

vi.mock("pdfkit", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PassThrough } = require("stream") as typeof import("stream");

  class MockPDFDocument extends PassThrough {
    page = { width: 595.28, height: 841.89 };
    y = 0;

    constructor(_options?: unknown) {
      super();
      pdfDocumentsCreated.count++;
    }

    text(value: string, ..._rest: unknown[]) {
      if (typeof value === "string") pdfState.capturedText.push(value);
      return this;
    }

    addPage() {
      return this;
    }
    bufferedPageRange() {
      return { start: 0, count: 1 };
    }
    fill() {
      return this;
    }
    fillColor() {
      return this;
    }
    flushPages() {
      return this;
    }
    font() {
      return this;
    }
    fontSize() {
      return this;
    }
    heightOfString() {
      return 10;
    }
    image() {
      return this;
    }
    lineTo() {
      return this;
    }
    lineWidth() {
      return this;
    }
    moveTo() {
      return this;
    }
    opacity() {
      return this;
    }
    rect() {
      return this;
    }
    restore() {
      return this;
    }
    rotate() {
      return this;
    }
    save() {
      return this;
    }
    stroke() {
      return this;
    }
    strokeColor() {
      return this;
    }
    switchToPage() {
      return this;
    }
    widthOfString(value: string) {
      return value.length * 4;
    }

    end(callback?: () => void) {
      super.end(callback);
      return this;
    }
  }

  return { default: MockPDFDocument };
});

import app from "../app.js";

const SECRET = process.env.SESSION_SECRET ?? "iroc-fallback-secret";
const TEST_EMAIL = "training-offer-snapshot-download@example.test";
const AUTH = `Bearer ${makeIrocToken()}`;

function makeIrocToken(): string {
  const exp = Math.floor(Date.now() / 1000) + 8 * 60 * 60;
  const payload = { userId: 1, username: "training-offer-test", exp };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", SECRET)
    .update(data)
    .digest("base64url");
  return `${data}.${signature}`;
}

const OFFER_BODY = {
  invoiceType: "domestic",
  language: "de",
  issueDate: "2026-08-27",
  trainingDate: "2026-09-18",
  deliveryCosts: "0.00",
  vatRate: "19.00",
  notes: "Original offer note",
  items: [
    {
      productName: "Original training item",
      description: "Original item description",
      unitPrice: "120.00",
      quantity: 1,
    },
  ],
};

async function cleanup() {
  // The offer has an ON DELETE CASCADE lead foreign key, so deleting the
  // uniquely named test lead also removes every offer created by this file.
  await pool.query("DELETE FROM iroc_leads WHERE email = $1", [TEST_EMAIL]);
}

async function createLead() {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO iroc_leads
      (salutation, medical_title, first_name, last_name, institution_name,
       zip_code, street, house_number, city, country, email, phone, status)
     VALUES
      ('Herr', 'Dr. med.', 'Snapshot', 'Doctor', 'Snapshot Clinic',
       '80331', 'Original Boulevard', '42', 'Munich', 'Germany', $1, '+49 89 12345', 'contacted')
     RETURNING id`,
    [TEST_EMAIL],
  );
  return rows[0].id;
}

async function issueOffer() {
  const leadId = await createLead();
  const response = await request(app)
    .post(`/api/iroc/leads/${leadId}/training-offer-pdf`)
    .set("Authorization", AUTH)
    .send(OFFER_BODY);

  expect(response.status).toBe(200);
  expect(response.headers["content-type"]).toMatch(/pdf/);

  const { rows } = await pool.query<{
    id: number;
  }>(
    `SELECT id
       FROM iroc_training_offers
      WHERE lead_id = $1`,
    [leadId],
  );
  expect(rows).toHaveLength(1);
  return { leadId, offerId: rows[0].id };
}

async function getState(leadId: number) {
  const { rows } = await pool.query<{ status: string; offers: string }>(
    `SELECT l.status, COUNT(o.id)::text AS offers
       FROM iroc_leads l
       LEFT JOIN iroc_training_offers o ON o.lead_id = l.id
      WHERE l.id = $1
      GROUP BY l.id, l.status`,
    [leadId],
  );
  return rows[0];
}

beforeEach(async () => {
  pdfState.capturedText = [];
  pdfDocumentsCreated.count = 0;
  await cleanup();
});

afterEach(cleanup);
afterAll(async () => {
  await cleanup();
});

describe("training offer snapshot downloads", () => {
  it.each([
    {
      field: "deliveryCosts",
      value: "NaN",
      error: "Delivery costs must be numeric.",
    },
    {
      field: "deliveryCosts",
      value: "Infinity",
      error: "Delivery costs must be numeric.",
    },
    {
      field: "vatRate",
      value: "NaN",
      error: "VAT rate must be numeric.",
    },
    {
      field: "vatRate",
      value: "Infinity",
      error: "VAT rate must be numeric.",
    },
    {
      field: "itemVatRate",
      value: "NaN",
      error: "Item 1 has an invalid VAT rate.",
    },
    {
      field: "itemVatRate",
      value: "Infinity",
      error: "Item 1 has an invalid VAT rate.",
    },
  ])(
    "rejects a non-finite $field before generating or saving an offer",
    async ({ field, value, error }) => {
      const leadId = await createLead();
      const body = field === "itemVatRate"
        ? {
            ...OFFER_BODY,
            items: [{ ...OFFER_BODY.items[0], vatRate: value }],
          }
        : { ...OFFER_BODY, [field]: value };
      const response = await request(app)
        .post(`/api/iroc/leads/${leadId}/training-offer-pdf`)
        .set("Authorization", AUTH)
        .send(body);

      expect(response.status).toBe(field === "itemVatRate" ? 422 : 400);
      expect(response.body).toEqual({ error });
      expect(pdfDocumentsCreated.count).toBe(0);
      await expect(getState(leadId)).resolves.toMatchObject({
        status: "contacted",
        offers: "0",
      });
    },
  );

  it("rejects a corrupted saved-offer line VAT rate without generating a PDF or changing lead state", async () => {
    const { leadId, offerId } = await issueOffer();
    await pool.query(
      "UPDATE iroc_training_offers SET items_snapshot = $1 WHERE id = $2",
      [JSON.stringify([{ ...OFFER_BODY.items[0], vatRate: "Infinity" }]), offerId],
    );

    pdfState.capturedText = [];
    pdfDocumentsCreated.count = 0;
    const response = await request(app)
      .get(`/api/iroc/leads/${leadId}/training-offer-pdf`)
      .set("Authorization", AUTH);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: "Saved training offer item 1 VAT rate is invalid.",
    });
    expect(pdfDocumentsCreated.count).toBe(0);
    expect(pdfState.capturedText).toEqual([]);
    await expect(getState(leadId)).resolves.toMatchObject({
      status: "registered",
      offers: "1",
    });
  });

  it("re-downloads the original customer details after the live lead changes", async () => {
    const { leadId } = await issueOffer();

    await pool.query(
      `UPDATE iroc_leads
          SET first_name = 'Changed',
              last_name = 'Doctor',
              institution_name = 'Changed Clinic',
              street = 'Changed Street',
              house_number = '99',
              updated_at = NOW()
        WHERE id = $1`,
      [leadId],
    );

    pdfState.capturedText = [];
    const response = await request(app)
      .get(`/api/iroc/leads/${leadId}/training-offer-pdf`)
      .set("Authorization", AUTH);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/pdf/);
    const renderedText = pdfState.capturedText.join("\n");
    expect(renderedText).toContain("Snapshot Doctor");
    expect(renderedText).toContain("Snapshot Clinic");
    expect(renderedText).toContain("Original Boulevard 42");
    expect(renderedText).toContain("Original training item");
    expect(renderedText).toContain("Original item description");
    expect(renderedText).not.toContain("Changed Clinic");
    expect(renderedText).not.toContain("Changed Street 99");

    await expect(getState(leadId)).resolves.toMatchObject({
      status: "registered",
      offers: "1",
    });
  });

  it.each([
    {
      label: "missing",
      snapshot: null,
      status: 422,
      error: "Saved training offer is missing its immutable customer snapshot.",
    },
    {
      label: "malformed JSON",
      snapshot: "{not-json",
      status: 500,
      error: "Saved training offer customer details are invalid.",
    },
    {
      label: "structurally invalid",
      snapshot: JSON.stringify({ id: 0, name: 42, isEu: false }),
      status: 500,
      error: "Saved training offer customer details are invalid.",
    },
  ])(
    "rejects a $label customer snapshot without changing the lead or duplicating the offer",
    async ({ snapshot, status, error }) => {
      const { leadId, offerId } = await issueOffer();
      await pool.query(
        "UPDATE iroc_training_offers SET customer_snapshot = $1 WHERE id = $2",
        [snapshot, offerId],
      );

      const response = await request(app)
        .get(`/api/iroc/leads/${leadId}/training-offer-pdf`)
        .set("Authorization", AUTH);

      expect(response.status).toBe(status);
      expect(response.body).toEqual({ error });
      await expect(getState(leadId)).resolves.toMatchObject({
        status: "registered",
        offers: "1",
      });
    },
  );

  it.each([
    {
      label: "missing",
      snapshot: "",
    },
    {
      label: "malformed JSON",
      snapshot: "{not-json",
    },
    {
      label: "structurally invalid",
      snapshot: JSON.stringify([{ productName: "Broken training item" }]),
    },
  ])(
    "rejects a $label item snapshot without changing the lead or duplicating the offer",
    async ({ snapshot }) => {
      const { leadId, offerId } = await issueOffer();
      await pool.query(
        "UPDATE iroc_training_offers SET items_snapshot = $1 WHERE id = $2",
        [snapshot, offerId],
      );

      const response = await request(app)
        .get(`/api/iroc/leads/${leadId}/training-offer-pdf`)
        .set("Authorization", AUTH);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: "Saved training offer items are invalid.",
      });
      await expect(getState(leadId)).resolves.toMatchObject({
        status: "registered",
        offers: "1",
      });
    },
  );

  it.each([
    {
      label: "delivery costs",
      column: "delivery_costs",
      value: "NaN",
      error: "Saved training offer delivery costs are invalid.",
    },
    {
      label: "VAT rate",
      column: "vat_rate",
      value: "NaN",
      error: "Saved training offer VAT rate is invalid.",
    },
  ])(
    "rejects corrupted saved-offer $label before generating a PDF",
    async ({ column, value, error }) => {
      const { leadId, offerId } = await issueOffer();
      await pool.query(
        `UPDATE iroc_training_offers SET ${column} = $1::numeric WHERE id = $2`,
        [value, offerId],
      );

      pdfState.capturedText = [];
      const response = await request(app)
        .get(`/api/iroc/leads/${leadId}/training-offer-pdf`)
        .set("Authorization", AUTH);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error });
      expect(pdfState.capturedText).toEqual([]);
      expect(pdfDocumentsCreated.count).toBe(1);
      await expect(getState(leadId)).resolves.toMatchObject({
        status: "registered",
        offers: "1",
      });
    },
  );
});
