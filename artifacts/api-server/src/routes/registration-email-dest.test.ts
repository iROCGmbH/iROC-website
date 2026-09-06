/**
 * registration-email-dest.test.ts — Task #230 (updated for double opt-in)
 *
 * The registration flows use email double opt-in:
 *   - POST /api/customers/register and POST /api/training/register send a
 *     CONFIRMATION email to the registrant (not the admin).
 *   - The admin notification email is sent only at confirmation time:
 *       GET /api/orders/approve/:token    → `email_dest_order_new` / `_existing`
 *       GET /api/training/confirm/:token  → `email_dest_training_<instrument>`
 *     failing closed when the setting is missing.
 *
 * Strategy:
 *   - @workspace/db is mocked with a stateful in-memory Map for the settings
 *     table, plus canned responses for the other tables touched by each route.
 *   - drizzle-orm helpers are mocked so that `where()` can inspect the key
 *     being queried without touching real ORM internals.
 *   - nodemailer is mocked (with SMTP env vars set) so that sendMail captures
 *     the `to` address for assertions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ── In-memory settings store + mock table / ORM sentinels ────────────────────

const {
  settingsStore,
  state,
  mockTrainingDate,
  mockSettingsTable,
  mockWebsiteCustomersTable,
  mockTrainingDatesTable,
  mockTrainingRegistrationsTable,
  mockIrocNotifications,
  mockIrocOrders,
  mockIrocLeads,
  mockSendMail,
  sentEmailOptions,
} = vi.hoisted(() => {
  const settingsStore = new Map<string, string>();

  /** Mutable holder for the "pending row" each confirm-endpoint test uses. */
  const state: {
    orderRow: Record<string, unknown> | null;
    regRow: Record<string, unknown> | null;
    websiteCustomerInsert: Record<string, unknown> | null;
  } = {
    orderRow: null,
    regRow: null,
    websiteCustomerInsert: null,
  };

  /** A training date permanently far enough in the future (>3 weeks). */
  const mockTrainingDate = {
    id: 1,
    instrument: "spirecut" as const,
    date: "2099-09-15",
    time: "09:00",
    location: "Munich",
    locationDetail: null,
    maxParticipants: 10,
    registeredCount: 0,
    isActive: true,
    notes: null,
  };

  // Sentinel objects — used only for table-identity checks in from().
  const mockSettingsTable = { _tag: "settings", key: "key" };
  const mockWebsiteCustomersTable = { _tag: "websiteCustomers", customerNr: "customerNr" };
  const mockTrainingDatesTable = { _tag: "trainingDates", id: "id", isActive: "isActive" };
  const mockTrainingRegistrationsTable = { _tag: "trainingRegs", id: "id", status: "status", confirmationToken: "confirmationToken" };
  const mockIrocNotifications = { _tag: "irocNotifications" };
  const mockIrocOrders = { _tag: "irocOrders", id: "id", status: "status", approvalToken: "approvalToken" };
  const mockIrocLeads = { _tag: "irocLeads", id: "id", status: "status", email: "email" };

  const mockSendMail = vi.fn().mockResolvedValue({ messageId: "test-id" });
  const sentEmailOptions: Record<string, unknown>[] = [];

  return {
    settingsStore,
    state,
    mockTrainingDate,
    mockSettingsTable,
    mockWebsiteCustomersTable,
    mockTrainingDatesTable,
    mockTrainingRegistrationsTable,
    mockIrocNotifications,
    mockIrocOrders,
    mockIrocLeads,
    mockSendMail,
    sentEmailOptions,
  };
});

// ── drizzle-orm mock ──────────────────────────────────────────────────────────

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_field: unknown, value: unknown) => ({ __eqValue: value })),
  and: vi.fn((...args: unknown[]) => ({ __and: args })),
  like: vi.fn((_field: unknown, _pattern: unknown) => ({})),
  max: vi.fn((_field: unknown) => "maxExpr"),
  sql: Object.assign(vi.fn(() => ({})), { raw: vi.fn(() => ({})) }),
  desc: vi.fn((f: unknown) => f),
  asc: vi.fn((f: unknown) => f),
  isNull: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
  count: vi.fn(() => "countExpr"),
}));

// ── @workspace/db mock ────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => {
  function makeWhere(tableSentinel: { _tag: string }) {
    return vi.fn().mockImplementation((condition: { __eqValue?: unknown }) => {
      if (tableSentinel._tag === "settings") {
        const key = condition.__eqValue as string | undefined;
        if (key && settingsStore.has(key)) {
          return Promise.resolve([{ key, value: settingsStore.get(key) }]);
        }
        return Promise.resolve([]);
      }

      if (tableSentinel._tag === "trainingDates") {
        const id = condition.__eqValue as number | undefined;
        if (id === mockTrainingDate.id) {
          return Promise.resolve([mockTrainingDate]);
        }
        return Promise.resolve([]);
      }

      if (tableSentinel._tag === "irocOrders") {
        const token = condition.__eqValue as string | undefined;
        if (state.orderRow && token === state.orderRow.approvalToken) {
          return Promise.resolve([state.orderRow]);
        }
        return Promise.resolve([]);
      }

      if (tableSentinel._tag === "trainingRegs") {
        const value = condition.__eqValue;
        if (state.regRow && (value === state.regRow.confirmationToken || value === state.regRow.id)) {
          return Promise.resolve([state.regRow]);
        }
        return Promise.resolve([]);
      }

      // The shared training-confirmation helper reads leads through a
      // chain ending in orderBy().limit().for("update"). Preserve normal
      // await behavior too so existing route tests can use the same mock.
      const rows: unknown[] = [];
      const result = {
        orderBy: vi.fn(() => result),
        limit: vi.fn(() => result),
        for: vi.fn(() => Promise.resolve(rows)),
        then: <TResult1 = unknown, TResult2 = never>(
          onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        ) => Promise.resolve(rows).then(onfulfilled, onrejected),
      };
      return result;
    });
  }

  const mockFrom = vi.fn().mockImplementation((table: { _tag: string }) => {
    if (table._tag === "websiteCustomers") {
      // Customer number generation / reorder-code uniqueness probe → [].
      return { where: vi.fn().mockResolvedValue([]) };
    }
    return { where: makeWhere(table) };
  });

  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

  // insert(...).values(...) is awaited directly for notifications, and
  // .returning() is used for customers / orders / registrations. Echo the
  // inserted payload back with an id so routes can use the created row.
  const mockInsert = vi.fn().mockImplementation((table: { _tag: string }) => ({
    values: vi.fn().mockImplementation((vals: Record<string, unknown>) => {
      if (table._tag === "websiteCustomers") {
        state.websiteCustomerInsert = vals;
      }
      if (typeof vals.key === "string" && vals.key.startsWith("email_dest_")) {
        settingsStore.set(vals.key, String(vals.value ?? ""));
      }
      return {
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        returning: vi.fn().mockResolvedValue([{ id: 1, ...vals }]),
        then: undefined,
      };
    }),
  }));

  // update(...).set(vals).where(cond) is awaited directly in some routes and
  // chained with .returning() in the confirm/approve endpoints. The returning
  // row merges the pending row with the update payload (status flip).
  const mockUpdate = vi.fn().mockImplementation((table: { _tag: string }) => ({
    set: vi.fn().mockImplementation((vals: Record<string, unknown>) => ({
      where: vi.fn().mockImplementation(() => {
        const base =
          table._tag === "irocOrders" ? state.orderRow :
          table._tag === "trainingRegs" ? state.regRow : null;
        const result = Object.assign(Promise.resolve(undefined), {
          returning: vi.fn().mockResolvedValue(base ? [{ ...base, ...vals }] : []),
        });
        return result;
      }),
    })),
  }));

  const dbMock = {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(dbMock)),
  };

  return {
    db: dbMock,
    settingsTable: mockSettingsTable,
    websiteCustomersTable: mockWebsiteCustomersTable,
    trainingDatesTable: mockTrainingDatesTable,
    trainingRegistrationsTable: mockTrainingRegistrationsTable,
    irocNotifications: mockIrocNotifications,
    irocOrders: mockIrocOrders,
    irocLeads: mockIrocLeads,
    // Other tables referenced by routes loaded transitively
    trainedDoctorsTable: { _tag: "trainedDoctors" },
    doctorCertificationsTable: { _tag: "doctorCerts" },
    resourcesTable: { _tag: "resources" },
    irocAppUsers: { _tag: "irocAppUsers" },
    irocCustomers: { _tag: "irocCustomers" },
    irocProducts: { _tag: "irocProducts" },
    irocInventoryLots: { _tag: "irocInventoryLots" },
    irocInvoices: { _tag: "irocInvoices" },
    irocInvoiceItems: { _tag: "irocInvoiceItems" },
  };
});

// ── nodemailer mock ───────────────────────────────────────────────────────────

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: mockSendMail })),
  },
  createTransport: vi.fn(() => ({ sendMail: mockSendMail })),
}));

// Capture the route-level mailbox role before sendEmail passes the message to
// nodemailer, where transport-only options intentionally omit this metadata.
vi.mock("../lib/email", async () => {
  const actual = await vi.importActual<typeof import("../lib/email")>("../lib/email");
  return {
    ...actual,
    sendEmail: vi.fn(async (options: Parameters<typeof actual.sendEmail>[0]) => {
      sentEmailOptions.push(options as Record<string, unknown>);
      return actual.sendEmail(options);
    }),
  };
});

// ── Activate SMTP so the transport is used (not the "no-SMTP" log path) ──────

beforeEach(() => {
  process.env.SMTP_HOST = "smtp.test.local";
  process.env.SMTP_USER = "test@test.local";
  process.env.SMTP_PASS = "testpass";
  process.env.REPLIT_DOMAINS = process.env.REPLIT_DOMAINS || "test.example.com";
  settingsStore.clear();
  state.orderRow = null;
  state.regRow = null;
  state.websiteCustomerInsert = null;
  mockSendMail.mockClear();
  sentEmailOptions.length = 0;
});

// ── Import app AFTER all mocks are registered ─────────────────────────────────

import app from "../app";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const HARDCODED_FALLBACK = "info@i-roc.de";
const ADMIN_AUTH = `Bearer ${process.env.ADMIN_PASSWORD ?? "iroc-admin-2024"}`;

const CUSTOMER_BODY = {
  salutation: "Herr",
  firstName: "Max",
  lastName: "Mustermann",
  specialty: "Kardiologie",
  institutionName: "Testklinik GmbH",
  address: "Musterstraße 1",
  postalCode: "80331",
  city: "München",
  country: "Deutschland",
  phone: "+49 89 12345",
  email: "max.mustermann@example.com",
  instrument: "spirecut",
  notes: "Products: test item",
  privacyConsent: true,
};

const TRAINING_BODY = {
  salutation: "Frau",
  medicalDegree: "Dr. med.",
  firstName: "Erika",
  lastName: "Musterfrau",
  specialty: "Chirurgie",
  institutionName: "Testklinik GmbH",
  address: "Musterstraße 2",
  postalCode: "80331",
  city: "München",
  country: "Deutschland",
  phone: "+49 89 54321",
  email: "erika.musterfrau@example.com",
  trainingDateId: 1,
  instrument: "spirecut",
  privacyConsent: true,
  marketingConsent: true,
};

const CONTACT_BODY = {
  name: "Max Mustermann",
  email: "max.mustermann@example.com",
  subject: "Frage zu Spirecut",
  message: "Bitte senden Sie mir weitere Informationen zu Spirecut.",
  privacyConsent: true,
};

function makeOrderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    websiteCustomerId: 1,
    customerType: "new",
    customerNr: "2026-0001",
    companyName: "Testklinik GmbH",
    contactName: "Max Mustermann",
    contactEmail: "max.mustermann@example.com",
    contactPhone: null,
    instrument: "spirecut",
    products: null,
    deliveryAddress: null,
    notes: null,
    approvalToken: "ordertok123",
    status: "pending",
    approvedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeRegRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    salutation: "Frau",
    medicalDegree: "Dr. med.",
    firstName: "Erika",
    lastName: "Musterfrau",
    specialty: "Chirurgie",
    institutionName: "Testklinik GmbH",
    address: "Musterstraße 2",
    postalCode: "80331",
    city: "München",
    country: "Deutschland",
    phone: "+49 89 54321",
    fax: null,
    email: "erika.musterfrau@example.com",
    instrument: "spirecut",
    trainingDateId: 1,
    trainingDateInfo: "2026-09-15 09:00 – Munich",
    websiteUrl: null,
    notes: null,
    privacyConsent: true,
    certifiedDoctorId: null,
    status: "pending",
    confirmationToken: "traintok123",
    confirmedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

// ── Tests: registration sends the confirmation email to the REGISTRANT ────────

describe("POST /api/customers/register — confirmation email (double opt-in)", () => {
  it("sends the confirmation email to the registering customer, not the admin", async () => {
    settingsStore.set("email_dest_order_new", "orders@configured.example");

    const res = await request(app).post("/api/customers/register").send(CUSTOMER_BODY);

    expect(res.status).toBe(201);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mail = mockSendMail.mock.calls[0][0];
    expect(sentEmailOptions[0]).toMatchObject({
      to: CUSTOMER_BODY.email,
      mailboxPurpose: "order_new",
    });
    expect(mail.to).toBe(CUSTOMER_BODY.email);
    expect(mail.to).not.toBe("orders@configured.example");
    // The email must carry the approval link
    expect(String(mail.text)).toContain("/api/orders/approve/");
    expect(String(mail.subject)).toBe("Bitte bestätigen Sie Ihre Registrierung & Bestellung — iROC GmbH");
    expect(String(mail.text)).not.toContain("Hello,");
  });

  it("sends an English-only confirmation to a customer outside Germany or Austria", async () => {
    const res = await request(app).post("/api/customers/register").send({
      ...CUSTOMER_BODY,
      country: "Switzerland",
      email: "customer@example.ch",
    });

    expect(res.status).toBe(201);
    const mail = mockSendMail.mock.calls[0][0];
    expect(mail.subject).toBe("Please confirm your registration & order — iROC GmbH");
    expect(String(mail.text)).toContain("Hello,");
    expect(String(mail.text)).not.toContain("Guten Tag");
  });

  it("strips a duplicated academic title before saving and displaying the name", async () => {
    const res = await request(app).post("/api/customers/register").send({
      ...CUSTOMER_BODY,
      title: "Dr. med",
      firstName: "Dr. med Max",
      lastName: "Dr. Mustermann",
    });

    expect(res.status).toBe(201);
    expect(state.websiteCustomerInsert).toMatchObject({
      title: "Dr. med",
      firstName: "Max",
      lastName: "Mustermann",
    });
    expect(String(mockSendMail.mock.calls[0][0].text)).toContain("Guten Tag Max Mustermann,");
  });
});

describe("POST /api/training/register — confirmation email (double opt-in)", () => {
  it("sends the confirmation email to the registering doctor, not the admin", async () => {
    settingsStore.set("email_dest_training_spirecut", "training@configured.example");

    const res = await request(app).post("/api/training/register").send(TRAINING_BODY);

    expect(res.status).toBe(201);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mail = mockSendMail.mock.calls[0][0];
    expect(sentEmailOptions[0]).toMatchObject({
      to: TRAINING_BODY.email,
      mailboxPurpose: "training_spirecut",
    });
    expect(mail.to).toBe(TRAINING_BODY.email);
    expect(String(mail.text)).toContain("/api/training/confirm/");
    expect(String(mail.subject)).toBe("Bitte bestätigen Sie Ihre Schulungsanmeldung – iROC GmbH");
    expect(String(mail.text)).not.toContain("Dear ");
  });

  it("sends an English-only confirmation to a doctor outside Germany or Austria", async () => {
    const res = await request(app).post("/api/training/register").send({
      ...TRAINING_BODY,
      country: "United Kingdom",
      email: "doctor@example.uk",
    });

    expect(res.status).toBe(201);
    const mail = mockSendMail.mock.calls[0][0];
    expect(mail.subject).toBe("Please confirm your training registration – iROC GmbH");
    expect(String(mail.text)).toContain("Dear ");
    expect(String(mail.text)).not.toContain("Sehr geehrte");
  });
});

describe("POST /api/contact — admin email destination", () => {
  it("sends to the address configured under email_dest_contact", async () => {
    settingsStore.set("email_dest_contact", "contact@configured.example");

    const res = await request(app).post("/api/contact").send(CONTACT_BODY);

    expect(res.status).toBe(201);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail.mock.calls[0][0].to).toBe("contact@configured.example");
    expect(mockSendMail.mock.calls[0][0].to).not.toBe(HARDCODED_FALLBACK);
    expect(sentEmailOptions[0]).toMatchObject({
      to: "contact@configured.example",
      replyTo: CONTACT_BODY.email,
      mailboxPurpose: "website_contact",
    });
  });
});

// ── Tests: admin email destination at approval/confirmation time ──────────────

describe("GET /api/orders/approve/:token — admin email destination", () => {
  it("sends to the address configured under email_dest_order_new for new customers", async () => {
    settingsStore.set("email_dest_order_new", "orders-new@configured.example");
    state.orderRow = makeOrderRow({ customerType: "new" });

    const res = await request(app).get("/api/orders/approve/ordertok123");

    expect(res.status).toBe(200);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail.mock.calls[0][0].to).toBe("orders-new@configured.example");
    expect(sentEmailOptions[0]).toMatchObject({
      to: "orders-new@configured.example",
      replyTo: "max.mustermann@example.com",
      mailboxPurpose: "order_new",
    });
  });

  it("sends to the address configured under email_dest_order_existing for existing customers", async () => {
    settingsStore.set("email_dest_order_existing", "orders-existing@configured.example");
    state.orderRow = makeOrderRow({ customerType: "existing" });

    const res = await request(app).get("/api/orders/approve/ordertok123");

    expect(res.status).toBe(200);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail.mock.calls[0][0].to).toBe("orders-existing@configured.example");
    expect(sentEmailOptions[0]).toMatchObject({
      to: "orders-existing@configured.example",
      replyTo: "max.mustermann@example.com",
      mailboxPurpose: "order_existing",
    });
  });

  it("does not send to a shared fallback when the setting is not set", async () => {
    state.orderRow = makeOrderRow({ customerType: "new" });

    const res = await request(app).get("/api/orders/approve/ordertok123");

    expect(res.status).toBe(200);
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(sentEmailOptions).toHaveLength(0);
  });

  it("does not send when the configured destination is invalid", async () => {
    settingsStore.set("email_dest_order_new", "not-an-email");
    state.orderRow = makeOrderRow({ customerType: "new" });

    const res = await request(app).get("/api/orders/approve/ordertok123");

    expect(res.status).toBe(200);
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(sentEmailOptions).toHaveLength(0);
  });

  it("sets reply-to the ordering customer's email address", async () => {
    settingsStore.set("email_dest_order_new", "orders-new@configured.example");
    state.orderRow = makeOrderRow();

    await request(app).get("/api/orders/approve/ordertok123");

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail.mock.calls[0][0].replyTo).toBe("max.mustermann@example.com");
  });
});

describe("GET /api/training/confirm/:token — admin email destination", () => {
  it("sends to the address configured under email_dest_training_spirecut", async () => {
    settingsStore.set("email_dest_training_spirecut", "training@configured.example");
    state.regRow = makeRegRow({ instrument: "spirecut" });

    const res = await request(app).get("/api/training/confirm/traintok123");

    expect(res.status).toBe(200);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail.mock.calls[0][0].to).toBe("training@configured.example");
    expect(sentEmailOptions[0]).toMatchObject({
      to: "training@configured.example",
      replyTo: "erika.musterfrau@example.com",
      mailboxPurpose: "training_spirecut",
    });
  });

  it("uses email_dest_training_ministem when instrument is ministem", async () => {
    settingsStore.set("email_dest_training_spirecut", "spirecut@configured.example");
    settingsStore.set("email_dest_training_ministem", "ministem@configured.example");
    state.regRow = makeRegRow({ instrument: "ministem" });

    const res = await request(app).get("/api/training/confirm/traintok123");

    expect(res.status).toBe(200);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail.mock.calls[0][0].to).toBe("ministem@configured.example");
    expect(sentEmailOptions[0]).toMatchObject({
      to: "ministem@configured.example",
      replyTo: "erika.musterfrau@example.com",
      mailboxPurpose: "training_ministem",
    });
  });

  it("does not send to a shared fallback when the setting is not set", async () => {
    state.regRow = makeRegRow();

    const res = await request(app).get("/api/training/confirm/traintok123");

    expect(res.status).toBe(200);
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(sentEmailOptions).toHaveLength(0);
  });

  it("sets reply-to the registrant's email address", async () => {
    settingsStore.set("email_dest_training_spirecut", "training@configured.example");
    state.regRow = makeRegRow();

    await request(app).get("/api/training/confirm/traintok123");

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail.mock.calls[0][0].replyTo).toBe("erika.musterfrau@example.com");
  });
});

describe("POST /api/admin/email-settings — email validation", () => {
  it.each([
    { label: "an empty string", email: "" },
    { label: "an invalid address", email: "not-an-email" },
  ])("rejects $label before saving and keeps confirmation emails blocked", async ({ email }) => {
    const postRes = await request(app)
      .post("/api/admin/email-settings")
      .set("Authorization", ADMIN_AUTH)
      .send({ key: "email_dest_order_new", email });

    expect(postRes.status).toBe(400);
    expect(postRes.body).toMatchObject({ error: "Invalid email address" });
    expect(settingsStore.has("email_dest_order_new")).toBe(false);

    state.orderRow = makeOrderRow({ customerType: "new" });
    const confirmationRes = await request(app).get("/api/orders/approve/ordertok123");

    expect(confirmationRes.status).toBe(200);
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(sentEmailOptions).toHaveLength(0);
  });
});
