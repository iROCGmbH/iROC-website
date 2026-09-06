import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import crypto from "crypto";

type Invoice = Record<string, string | number | null>;
type Shipment = {
  id: number;
  status: string;
  trackingNumber?: string | null;
  labelUrl?: string | null;
  sendcloudShipmentId?: string | null;
  deliveryCosts?: number;
  insuranceCosts?: number;
};

const state = vi.hoisted(() => {
  class MockSendcloudRequestError extends Error {
    constructor(public readonly status: number, message: string) {
      super(message);
    }
  }

  const current: {
    invoice: Invoice;
    order: Record<string, string | number | null>;
    invoiceItems: Record<string, string | number | null>[];
    shipment: Shipment | null;
    invoiceUpdates: unknown[][];
    queryLog: string[];
  } = {
    invoice: {},
    order: {},
    invoiceItems: [],
    shipment: null,
    invoiceUpdates: [],
    queryLog: [],
  };

  const getSendcloudRates = vi.fn();
  const createSendcloudShipment = vi.fn();
  const findSendcloudShipmentByExternalReference = vi.fn();

  const clientQuery = vi.fn(async (query: string, params: unknown[] = []) => {
    current.queryLog.push(query);
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(query)) return { rows: [] };
    if (query.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (query.includes("FROM iroc_order_shipments WHERE order_id = $1 FOR UPDATE")) {
      return { rows: current.shipment ? [{ id: current.shipment.id }] : [] };
    }
    if (query.includes("FROM iroc_order_shipments WHERE invoice_id = $1 FOR UPDATE")) {
      return { rows: current.shipment ? [{ id: current.shipment.id, status: current.shipment.status }] : [] };
    }
    if (query.includes("FROM iroc_invoices WHERE source_order_id = $1")) {
      return { rows: [current.invoice] };
    }
    if (query.includes("SELECT * FROM iroc_invoices WHERE id = $1 FOR UPDATE")) {
      return { rows: [current.invoice] };
    }
    if (query.includes("SELECT sally_review_result FROM iroc_orders WHERE id = $1")) {
      return { rows: current.invoice.source_order_id ? [{ sally_review_result: current.order.sally_review_result ?? null }] : [] };
    }
    if (query.includes("FROM iroc_invoice_items")) return { rows: current.invoiceItems };
    if (query.includes("INSERT INTO iroc_order_shipments")) {
      current.shipment = {
        id: 701,
        status: "creating",
        deliveryCosts: Number(params[8]),
        insuranceCosts: Number(params[9]),
      };
      return { rows: [{ id: current.shipment.id }] };
    }
    if (query.includes("quote_snapshot") || query.includes("SET status='creating'")) {
      return { rows: [], rowCount: 1 };
    }
    if (query.includes("UPDATE iroc_invoices")) {
      const [deliveryCosts, insuranceCosts, shippingMethod, vatAmount, total] = params;
      Object.assign(current.invoice, {
        delivery_costs: String(deliveryCosts),
        insurance_costs: String(insuranceCosts),
        shipping_method: String(shippingMethod),
        vat_amount: String(vatAmount),
        total: String(total),
      });
      current.invoiceUpdates.push(params);
      return {
        rows: [{
          delivery_costs: current.invoice.delivery_costs,
          insurance_costs: current.invoice.insurance_costs,
          vat_amount: current.invoice.vat_amount,
          total: current.invoice.total,
        }],
        rowCount: 1,
      };
    }
    if (query.includes("SET status='created'")) {
      if (current.shipment) {
        current.shipment = {
          ...current.shipment,
          status: "created",
          trackingNumber: String(params[0] ?? ""),
          labelUrl: String(params[1] ?? ""),
          sendcloudShipmentId: String(params[2] ?? ""),
        };
      }
      return { rows: [], rowCount: 1 };
    }
    if (query.includes("SET status='provider_error'") && current.shipment) {
      current.shipment.status = "provider_error";
      return { rows: [], rowCount: 1 };
    }
    if (query.includes("SET status='needs_reconciliation'") && current.shipment) {
      current.shipment.status = "needs_reconciliation";
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected client query: ${query}`);
  });

  const poolQuery = vi.fn(async (query: string) => {
    current.queryLog.push(query);
    if (query.includes("FROM iroc_orders o")) return { rows: [current.order] };
    if (query.includes("FROM iroc_invoices i")) {
      return {
        rows: [{
          ...current.invoice,
          source_order_sally_review_result: current.order.sally_review_result ?? null,
        }],
      };
    }
    if (query.includes("FROM iroc_invoice_items")) return { rows: [] };
    throw new Error(`Unexpected pool query: ${query}`);
  });

  return {
    current,
    poolQuery,
    clientQuery,
    poolConnect: vi.fn(async () => ({ query: clientQuery, release: vi.fn() })),
    getSendcloudRates,
    createSendcloudShipment,
    findSendcloudShipmentByExternalReference,
    MockSendcloudRequestError,
  };
});

vi.mock("@workspace/db", () => {
  const emptyChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    then: (resolve: (value: unknown[]) => unknown) => Promise.resolve([]).then(resolve),
  };
  return {
    pool: { query: state.poolQuery, connect: state.poolConnect },
    db: {
      select: vi.fn(() => emptyChain),
      insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })) })),
      delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
      transaction: vi.fn(),
      execute: vi.fn(),
    },
    irocAppUsers: {},
    irocCustomers: {},
    irocProducts: {},
    irocProductGroups: {},
    irocInventoryLots: {},
    irocInvoices: {},
    irocInvoiceItems: {},
    irocNotifications: {},
    irocLeads: {},
    irocTrainingOffers: {},
    irocOrders: {},
    irocOrderShipments: {},
    irocCustomerWebsiteLinks: {},
    websiteCustomersTable: {},
    trainingRegistrationsTable: {},
    settingsTable: {},
    trainedDoctorsTable: {},
    doctorCertificationsTable: {},
  };
});

vi.mock("../lib/sendcloud", () => ({
  getSendcloudRates: state.getSendcloudRates,
  createSendcloudShipment: state.createSendcloudShipment,
  findSendcloudShipmentByExternalReference: state.findSendcloudShipmentByExternalReference,
  normalizeSendcloudCountryCode: (country: string) => country,
  nextPreferredPickupDate: () => new Date("2026-08-26T09:00:00.000Z"),
  SendcloudRequestError: state.MockSendcloudRequestError,
}));

import app from "../app";

const secret = process.env.SESSION_SECRET ?? "iroc-fallback-secret";
const payload = {
  userId: 1,
  username: "admin",
  exp: Math.floor(Date.now() / 1000) + 60 * 60,
};
const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
const signature = crypto.createHmac("sha256", secret).update(data).digest("base64url");
const AUTH = `Bearer ${data}.${signature}`;

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 91,
    invoice_number: "2026-0091",
    status: "draft",
    source_order_id: null,
    subtotal: "1000.00",
    vat_rate: "19.00",
    vat_amount: "190.00",
    delivery_costs: "0.00",
    insurance_costs: "0.00",
    total: "1000.01",
    first_name: "Ada",
    last_name: "Lovelace",
    customer_email: "ada@example.com",
    street: "Example Street",
    house_number: "12",
    postal_code: "10115",
    city: "Berlin",
    country: "DE",
    sally_review_result: null,
    ...overrides,
  };
}

const shipmentRequest = {
  serviceId: "dhl:parcel",
  carrier: "DHL",
  serviceCode: "dhl:parcel",
  quotedDeliveryCost: 12.5,
  quotedInsuranceCost: 4.9,
  weightKg: 2,
  lengthCm: 30,
  widthCm: 20,
  heightCm: 10,
  confirm: true,
};

beforeEach(() => {
  state.current.invoice = makeInvoice();
  state.current.order = {
    id: 301,
    status: "approved",
    first_name: "Ada",
    last_name: "Lovelace",
    customer_email: "ada@example.com",
    street: "Example Street",
    house_number: "12",
    postal_code: "10115",
    city: "Berlin",
    country: "DE",
    sally_review_result: null,
  };
  state.current.shipment = null;
  state.current.invoiceItems = [];
  state.current.invoiceUpdates.length = 0;
  state.current.queryLog.length = 0;
  state.poolQuery.mockClear();
  state.clientQuery.mockClear();
  state.poolConnect.mockClear();
  state.getSendcloudRates.mockReset();
  state.createSendcloudShipment.mockReset();
  state.findSendcloudShipmentByExternalReference.mockReset();
  state.createSendcloudShipment.mockResolvedValue({
    id: "sendcloud-701",
    trackingNumber: "TRACK-701",
    labelUrl: "https://labels.example/701.pdf",
  });
});

describe("Invoice shipment preflight", () => {
  it("allows Sendcloud rate retrieval for an iROC Portal-linked draft invoice", async () => {
    state.current.invoice = makeInvoice({ source_order_id: 301 });
    state.current.order.sally_review_result = JSON.stringify({ source: "iroc_portal" });
    state.getSendcloudRates.mockResolvedValue([]);

    const response = await request(app)
      .get("/api/iroc/invoices/91/shipping-rates?weightKg=2")
      .set("Authorization", AUTH);

    expect(response.status).toBe(200);
    expect(state.getSendcloudRates).toHaveBeenCalledOnce();
  });

  it("allows a confirmed Sendcloud shipment for an iROC Portal-linked draft invoice", async () => {
    state.current.invoice = makeInvoice({ source_order_id: 301 });
    state.current.order.sally_review_result = JSON.stringify({ source: "iroc_portal" });

    const response = await request(app)
      .post("/api/iroc/invoices/91/shipment")
      .set("Authorization", AUTH)
      .send(shipmentRequest);

    expect(response.status).toBe(201);
    expect(state.createSendcloudShipment).toHaveBeenCalledOnce();
    expect(state.current.invoiceUpdates).toHaveLength(1);
  });

  it.each([
    ["German", "DE", "10115"],
    ["EU", "AT", "1010"],
    ["non-EU", "CH", "8001"],
  ])("uses mocked Sendcloud rates for a %s destination", async (_label, country, postalCode) => {
    state.current.invoice = makeInvoice({
      country,
      postal_code: postalCode,
      ...(country === "CH" ? {
        reason_for_export: "commercial goods",
        terms_of_delivery: "DAP",
        shipping_method: "road",
      } : {}),
    });
    state.getSendcloudRates.mockResolvedValue([{
      id: `dhl:${country.toLowerCase()}`,
      carrier: "DHL",
      serviceCode: `dhl:${country.toLowerCase()}`,
      name: `DHL ${country}`,
      price: 12.5,
      insurancePrice: 4.9,
      totalPrice: 17.4,
      currency: "EUR",
      pickupSupported: country === "DE",
      handover: country === "DE" ? "pickup_dropoff" : "dropoff",
    }]);

    const response = await request(app)
      .get("/api/iroc/invoices/91/shipping-rates?weightKg=2&lengthCm=30&widthCm=20&heightCm=10")
      .set("Authorization", AUTH);

    expect(response.status).toBe(200);
    expect(state.getSendcloudRates).toHaveBeenCalledWith(expect.objectContaining({
      country,
      postalCode,
      weightKg: 2,
      lengthCm: 30,
      widthCm: 20,
      heightCm: 10,
      insuredValue: 1001,
    }));
    expect(response.body.rates).toHaveLength(1);
    expect(response.body.rates[0]).toMatchObject({ id: `dhl:${country.toLowerCase()}`, pickupSupported: country === "DE" });
    expect(response.body.pickupWindow).toBe("Mon/Wed/Fri 09:00–13:00 (when supported)");
  });

  it("requests full whole-euro insurance above €800 before creating the mocked parcel", async () => {
    const response = await request(app)
      .post("/api/iroc/invoices/91/shipment")
      .set("Authorization", AUTH)
      .send(shipmentRequest);

    expect(response.status).toBe(201);
    expect(state.createSendcloudShipment).toHaveBeenCalledTimes(1);
    expect(state.createSendcloudShipment).toHaveBeenCalledWith(expect.objectContaining({
      insuredValue: 1001,
      externalReference: "iroc-invoice-shipment:701",
    }));
    expect(response.body.invoiceTotals).toMatchObject({
      deliveryCosts: "12.50",
      insuranceCosts: "4.90",
    });
  });

  it("forwards accepted quote charges to customs and persists the same shipment charges", async () => {
    state.current.invoice = makeInvoice({
      country: "CH",
      postal_code: "8001",
      city: "Zurich",
      issue_date: "2026-08-27",
      reason_for_export: "commercial goods",
      terms_of_delivery: "DAP",
      shipping_method: "road",
    });
    state.current.invoiceItems = [{
      product_name: "Medical instrument",
      description: "Medical instrument",
      sku: "IROC-001",
      hs_code: "901890",
      country_of_origin: "DE",
      weight_kg: "0.75",
      quantity: 2,
      line_total: "250.00",
    }];

    const response = await request(app)
      .post("/api/iroc/invoices/91/shipment")
      .set("Authorization", AUTH)
      .send(shipmentRequest);

    expect(response.status).toBe(201);
    expect(state.createSendcloudShipment).toHaveBeenCalledTimes(1);
    const providerInput = state.createSendcloudShipment.mock.calls[0][0];
    expect(providerInput.customs).toMatchObject({
      information: {
        invoiceNumber: "2026-0091",
        invoiceDate: "2026-08-27",
        exportReason: "commercial_goods",
        freightCosts: 12.5,
        insuranceCosts: 4.9,
      },
    });
    expect(providerInput.customs.information.freightCosts).toBe(Number(response.body.invoiceTotals.deliveryCosts));
    expect(providerInput.customs.information.insuranceCosts).toBe(Number(response.body.invoiceTotals.insuranceCosts));
    expect(state.current.shipment).toMatchObject({
      status: "created",
      deliveryCosts: 12.5,
      insuranceCosts: 4.9,
    });
    expect(state.current.invoice).toMatchObject({
      delivery_costs: "12.5",
      insurance_costs: "4.9",
    });
    expect(state.current.shipment?.deliveryCosts).toBe(Number(state.current.invoice.delivery_costs));
    expect(state.current.shipment?.insuranceCosts).toBe(Number(state.current.invoice.insurance_costs));
  });

  it("rejects an issued invoice before it can announce a parcel", async () => {
    state.current.invoice = makeInvoice({ status: "sent" });

    const response = await request(app)
      .post("/api/iroc/invoices/91/shipment")
      .set("Authorization", AUTH)
      .send(shipmentRequest);

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/draft invoice/i);
    expect(state.createSendcloudShipment).not.toHaveBeenCalled();
    expect(state.current.shipment).toBeNull();
    expect(state.current.invoiceUpdates).toHaveLength(0);
  });

  it("blocks a duplicate confirmation before a second parcel or invoice charge", async () => {
    const first = await request(app)
      .post("/api/iroc/invoices/91/shipment")
      .set("Authorization", AUTH)
      .send(shipmentRequest);

    expect(first.status).toBe(201);
    const firstTotals = { ...first.body.invoiceTotals };
    const updateCount = state.current.invoiceUpdates.length;

    const second = await request(app)
      .post("/api/iroc/invoices/91/shipment")
      .set("Authorization", AUTH)
      .send(shipmentRequest);

    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/shipment attempt already exists/i);
    expect(state.createSendcloudShipment).toHaveBeenCalledTimes(1);
    expect(state.current.invoiceUpdates).toHaveLength(updateCount);
    expect(Number(state.current.invoice.delivery_costs)).toBe(Number(firstTotals.deliveryCosts));
    expect(Number(state.current.invoice.insurance_costs)).toBe(Number(firstTotals.insuranceCosts));
    expect(state.current.shipment?.status).toBe("created");
  });
});

describe("Incoming order shipment reservation", () => {
  it("reserves the order before Sendcloud so simultaneous confirmations cannot create two deliveries", async () => {
    state.current.invoice = makeInvoice({ source_order_id: 301 });
    let releaseProvider!: () => void;
    let providerStarted!: () => void;
    const providerGate = new Promise<void>((resolve) => { releaseProvider = resolve; });
    const providerStartedGate = new Promise<void>((resolve) => { providerStarted = resolve; });
    let queriesWhenProviderStarted: string[] = [];
    state.createSendcloudShipment.mockImplementation(async () => {
      queriesWhenProviderStarted = [...state.current.queryLog];
      providerStarted();
      await providerGate;
      return {
        id: "sendcloud-order-701",
        trackingNumber: "ORDER-TRACK-701",
        labelUrl: "https://labels.example/order-701.pdf",
      };
    });

    const firstRequest = request(app)
      .post("/api/iroc/orders/301/shipment")
      .set("Authorization", AUTH)
      .send(shipmentRequest)
      .then((response) => response);
    await providerStartedGate;

    const second = await request(app)
      .post("/api/iroc/orders/301/shipment")
      .set("Authorization", AUTH)
      .send(shipmentRequest);

    expect(queriesWhenProviderStarted.some((query) => query.includes("INSERT INTO iroc_order_shipments"))).toBe(true);
    expect(queriesWhenProviderStarted).toContain("COMMIT");
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ shipmentId: 701 });
    expect(state.createSendcloudShipment).toHaveBeenCalledTimes(1);
    expect(state.createSendcloudShipment).toHaveBeenCalledWith(expect.objectContaining({
      externalReference: "iroc-order-shipment:701",
    }));
    expect(state.current.invoiceUpdates).toHaveLength(0);

    releaseProvider();
    const first = await firstRequest;

    expect(first.status).toBe(201);
    expect(state.current.invoiceUpdates).toHaveLength(1);
    expect(state.current.shipment?.status).toBe("created");
  });

  it("reconciles an ambiguous Sendcloud response through the reserved external reference", async () => {
    state.current.invoice = makeInvoice({ source_order_id: 301 });
    state.createSendcloudShipment.mockRejectedValue(new Error("connection reset after request"));
    state.findSendcloudShipmentByExternalReference.mockResolvedValue({
      id: "sendcloud-order-701",
      trackingNumber: "ORDER-TRACK-701",
      labelUrl: "https://labels.example/order-701.pdf",
    });

    const response = await request(app)
      .post("/api/iroc/orders/301/shipment")
      .set("Authorization", AUTH)
      .send(shipmentRequest);

    expect(response.status).toBe(201);
    expect(state.findSendcloudShipmentByExternalReference).toHaveBeenCalledWith("iroc-order-shipment:701");
    expect(state.current.invoiceUpdates).toHaveLength(1);
    expect(state.current.shipment).toMatchObject({
      status: "created",
      sendcloudShipmentId: "sendcloud-order-701",
    });
  });
});