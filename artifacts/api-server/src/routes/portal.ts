import path from "path";
import { Router } from "express";
import jwt from "jsonwebtoken";
import { db, pool } from "@workspace/db";
import {
  websiteCustomersTable,
  irocInvoices,
  irocInvoiceItems,
  irocCustomers,
  resourcesTable,
  adminApprovalQueueTable,
  irocProductGroups,
  irocProducts,
  trainingDatesTable,
  settingsTable,
} from "@workspace/db";
import { eq, and, gte, inArray, or, sql } from "drizzle-orm";
import { renderHybridInvoicePdf, wcToCustomerShape } from "./iroc";
import { createPortalOrderAndDraftInvoice } from "../lib/portal-order-invoice";
import { SALLY_AUTO_INVOICE_KEY, isSallyAutomationEnabled } from "../lib/sally-controls";
import {
  getPortalCertifications,
  isPortalProductGroupAllowedForCertifications,
} from "../lib/portal-product-filter";
import { isTrainingDateAvailable } from "../lib/training-availability";

const router = Router();

const PORTAL_SECRET = process.env.SESSION_SECRET ?? "portal-fallback-secret";
const PORTAL_TTL = 24 * 60 * 60; // 24 hours
const DEVELOPMENT_DEMO_CREDENTIALS = {
  customerNr: "DOC10025",
  reorderCode: "M3D9X7P8",
} as const;

async function getPortalOrderDefaults(customer: {
  id: number;
  customerNr: string | null;
  email: string;
}): Promise<{
  lastOrderPhone: string | null;
  lastOrderDeliveryAddress: string | null;
}> {
  const { rows } = await pool.query<{
    last_order_phone: string | null;
    last_order_delivery_address: string | null;
  }>(
    `SELECT
       (SELECT contact_phone
          FROM iroc_orders
         WHERE (
           website_customer_id = $1
           OR ($2 <> '' AND customer_nr = $2)
           OR ($3 <> '' AND LOWER(BTRIM(contact_email)) = LOWER(BTRIM($3)))
         )
           AND NULLIF(BTRIM(contact_phone), '') IS NOT NULL
         ORDER BY created_at DESC, id DESC
         LIMIT 1) AS last_order_phone,
       (SELECT delivery_address
          FROM iroc_orders
         WHERE (
           website_customer_id = $1
           OR ($2 <> '' AND customer_nr = $2)
           OR ($3 <> '' AND LOWER(BTRIM(contact_email)) = LOWER(BTRIM($3)))
         )
           AND NULLIF(BTRIM(delivery_address), '') IS NOT NULL
         ORDER BY created_at DESC, id DESC
         LIMIT 1) AS last_order_delivery_address`,
    [customer.id, customer.customerNr ?? "", customer.email ?? ""],
  );
  return {
    lastOrderPhone: rows[0]?.last_order_phone ?? null,
    lastOrderDeliveryAddress: rows[0]?.last_order_delivery_address ?? null,
  };
}

interface PortalTokenPayload {
  customerId: number;
  customerNr: string;
  instrument: string;
  certifications?: string[];
  iat?: number;
}

function signPortalToken(payload: PortalTokenPayload): string {
  return jwt.sign(payload, PORTAL_SECRET, { expiresIn: PORTAL_TTL });
}

export function verifyPortalToken(
  auth: string | undefined,
): PortalTokenPayload | null {
  if (!auth?.startsWith("Bearer ")) return null;
  try {
    return jwt.verify(auth.slice(7), PORTAL_SECRET) as PortalTokenPayload;
  } catch {
    return null;
  }
}

async function requirePortalAuth(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
) {
  const payload = verifyPortalToken(req.headers.authorization);
  if (!payload) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const revocationResult = await pool.query<{ revoked_at: Date | string | null }>(
      `SELECT MAX(sc.portal_sessions_revoked_at) AS revoked_at
         FROM website_customers wc
         JOIN sally_certified_doctors sc
           ON LOWER(BTRIM(sc.email)) = LOWER(BTRIM(wc.email))
        WHERE wc.id = $1`,
      [payload.customerId],
    );
    const revokedAt = revocationResult?.rows?.[0]?.revoked_at;
    if (revokedAt) {
      const revokedAtMs = new Date(revokedAt).getTime();
      // JWT iat is in whole seconds. Reject tokens issued at the same second
      // as the revocation too, so the removal cannot leave a small race window.
      if (
        !Number.isFinite(revokedAtMs) ||
        (payload.iat ?? 0) <= Math.floor(revokedAtMs / 1000)
      ) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
    }
  } catch {
    // Fail closed if the revocation lookup is unavailable. A certification
    // removal must never be bypassed because the check could not run.
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  (req as any).portalCustomer = payload;
  next();
}

// ── POST /portal/login ────────────────────────────────────────────────────────
router.post("/portal/login", async (req, res) => {
  const { customerNr, reorderCode } = req.body as {
    customerNr?: string;
    reorderCode?: string;
  };

  if (!customerNr || !reorderCode) {
    res.status(400).json({ error: "customerNr and reorderCode are required" });
    return;
  }

  const normalizedCustomerNr = customerNr.trim();
  const normalizedReorderCode = reorderCode.trim();
  const isDevelopment = process.env.NODE_ENV === "development";

  let [customer] = await db
    .select()
    .from(websiteCustomersTable)
    .where(eq(websiteCustomersTable.customerNr, normalizedCustomerNr))
    .limit(1);

  // Keep the credentials shown on the development login screen usable even
  // when a fresh development database has not been seeded with a customer
  // row yet. This creates a regular website customer, so all authenticated
  // portal endpoints (including /portal/me) continue to use the normal path.
  if (
    isDevelopment &&
    !customer &&
    normalizedCustomerNr === DEVELOPMENT_DEMO_CREDENTIALS.customerNr &&
    normalizedReorderCode === DEVELOPMENT_DEMO_CREDENTIALS.reorderCode
  ) {
    [customer] = await db
      .insert(websiteCustomersTable)
      .values({
        customerNr: DEVELOPMENT_DEMO_CREDENTIALS.customerNr,
        reorderCode: DEVELOPMENT_DEMO_CREDENTIALS.reorderCode,
        salutation: "Dr.",
        firstName: "Demo",
        lastName: "Doctor",
        specialty: "Orthopedics",
        institutionName: "iROC Demo Practice",
        email: "demo.doctor@example.invalid",
        country: "DE",
        instrument: "both",
        certifications: ["spirecut", "ministem"],
        privacyConsent: true,
      })
      .returning();
  }

  if (
    !customer ||
    !customer.reorderCode ||
    customer.reorderCode.trim() !== normalizedReorderCode
  ) {
    res.status(401).json({ error: "Invalid customer number or access code" });
    return;
  }

  // ── Certified-doctor gate ─────────────────────────────────────────────────
  // The portal is exclusively for certified iROC doctors.  Institutes that
  // order on behalf of a certified doctor must NOT receive portal access.
  // We check the customer's email against both certified-doctor sources:
  //   1. trained_doctors — attended iROC training
  //   2. sally_certified_doctors — added manually via Sally CRM
  // In non-production environments the check is skipped so test credentials
  // (which may not be in trained_doctors) still work during development.
  // ─────────────────────────────────────────────────────────────────────────
  const isProd = process.env.NODE_ENV === "production";
  if (isProd) {
    const { rows: certRows } = await pool.query<{ n: number }>(
      `SELECT 1 AS n
         FROM trained_doctors
        WHERE LOWER(email) = LOWER($1)
       UNION ALL
       SELECT 1 AS n
         FROM sally_certified_doctors
         WHERE LOWER(email) = LOWER($1)
           AND is_cancelled = false
           AND deleted_at IS NULL
        LIMIT 1`,
      [customer.email],
    );
    if (certRows.length === 0) {
      res.status(403).json({ error: "PORTAL_NOT_CERTIFIED" });
      return;
    }
  }

  const token = signPortalToken({
    customerId: customer.id,
    customerNr: customer.customerNr!,
    instrument: customer.instrument,
    certifications: getPortalCertifications(
      customer.certifications,
      customer.instrument,
    ),
  });

  res.json({
    token,
    customer: {
      id: customer.id,
      customerNr: customer.customerNr,
      salutation: customer.salutation,
      title: customer.title,
      firstName: customer.firstName,
      lastName: customer.lastName,
      specialty: customer.specialty,
      institutionName: customer.institutionName,
      address: customer.address,
      postalCode: customer.postalCode,
      city: customer.city,
      country: customer.country,
      email: customer.email,
      phone: customer.phone,
      instrument: customer.instrument,
      certifications: getPortalCertifications(
        customer.certifications,
        customer.instrument,
      ),
    },
  });
});

// ── GET /portal/me ────────────────────────────────────────────────────────────
router.get("/portal/me", requirePortalAuth, async (req, res) => {
  const { customerId } = (req as any).portalCustomer as PortalTokenPayload;

  const [customer] = await db
    .select()
    .from(websiteCustomersTable)
    .where(eq(websiteCustomersTable.id, customerId))
    .limit(1);

  if (!customer) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }

  const orderDefaults = await getPortalOrderDefaults(customer);
  res.json({
    id: customer.id,
    customerNr: customer.customerNr,
    salutation: customer.salutation,
    title: customer.title,
    firstName: customer.firstName,
    lastName: customer.lastName,
    specialty: customer.specialty,
    institutionName: customer.institutionName,
    address: customer.address,
    postalCode: customer.postalCode,
    city: customer.city,
    country: customer.country,
    email: customer.email,
    phone: customer.phone,
    instrument: customer.instrument,
    certifications: getPortalCertifications(
      customer.certifications,
      customer.instrument,
    ),
    ...orderDefaults,
  });
});

// ── GET /portal/invoices ──────────────────────────────────────────────────────
router.get("/portal/invoices", requirePortalAuth, async (req, res) => {
  const { customerId } = (req as any).portalCustomer as PortalTokenPayload;

  const invoices = await db
    .select({
      id: irocInvoices.id,
      invoiceNumber: irocInvoices.invoiceNumber,
      status: irocInvoices.status,
      invoiceType: irocInvoices.invoiceType,
      issueDate: irocInvoices.issueDate,
      totalAmount: irocInvoices.total,
      notes: irocInvoices.notes,
      correctionOfInvoiceId: irocInvoices.correctionOfInvoiceId,
      originalInvoiceNumber: irocInvoices.originalInvoiceNumber,
    })
    .from(irocInvoices)
    .where(
      and(
        // Corrections deliberately retain buyer data in an immutable snapshot,
        // rather than a mutable customer FK. The original invoice establishes
        // portal ownership for those linked correction documents.
        or(
          eq(irocInvoices.websiteCustomerId, customerId),
          sql`${irocInvoices.correctionOfInvoiceId} IN (
            SELECT id FROM iroc_invoices WHERE website_customer_id = ${customerId}
          )`,
        ),
        // Only show sent/paid invoices — not drafts
      ),
    )
    .orderBy(irocInvoices.issueDate);

  // Filter out drafts client-side (avoids drizzle-orm inArray complexity)
  const visible = invoices.filter((inv) =>
    ["sent", "paid", "cancelled"].includes(inv.status ?? ""),
  );

  res.json(
    visible.map((invoice) => ({
      ...invoice,
      // PostgreSQL numeric values are strings at this boundary; the portal
      // contract requires a usable number for display and outstanding totals.
      totalAmount: Number(invoice.totalAmount),
      correctionOfInvoiceId: invoice.correctionOfInvoiceId ?? null,
      originalInvoiceNumber: invoice.originalInvoiceNumber ?? null,
    })),
  );
});

// ── GET /portal/resources ─────────────────────────────────────────────────────
router.get("/portal/resources", requirePortalAuth, async (req, res) => {
  const { instrument, certifications } = (req as any).portalCustomer as PortalTokenPayload;

  const customerInstruments = getPortalCertifications(certifications, instrument);
  const hasBothCoreCertifications = ["spirecut", "ministem"]
    .every((certification) => customerInstruments.includes(certification));

  const rows = await db
    .select()
    .from(resourcesTable)
    .orderBy(resourcesTable.createdAt);

  // Include resources that match any customer instrument, 'both', or are unscoped
  const filtered = rows.filter(
    (r) =>
      !r.instrument ||
      (r.instrument === "both" && hasBothCoreCertifications) ||
      customerInstruments.includes(r.instrument),
  );

  res.json(
    filtered.map((r) => ({
      id: r.id,
      instrument: r.instrument ?? null,   // returned so client can group by product
      title: r.title,
      titleDe: r.titleDe,
      description: r.description,
      descriptionDe: r.descriptionDe,
      type: r.type,
      url: r.url,
      thumbnailUrl: r.thumbnailUrl,
    })),
  );
});

// ── GET /portal/products ──────────────────────────────────────────────────────
router.get("/portal/products", requirePortalAuth, async (req, res) => {
  const { instrument, certifications } = (req as any).portalCustomer as PortalTokenPayload;

  const [groups, products] = await Promise.all([
    db
      .select()
      .from(irocProductGroups)
      .where(eq(irocProductGroups.isService, false))
      .orderBy(irocProductGroups.sortOrder, irocProductGroups.key),
    db
      .select({
        id: irocProducts.id,
        sku: irocProducts.sku,
        nameEn: irocProducts.nameEn,
        nameDe: irocProducts.nameDe,
        category: irocProducts.category,
      })
      .from(irocProducts)
      .orderBy(irocProducts.sku),
  ]);

  // A doctor may hold multiple certifications, which together grant all
  // matching product groups.
  const allowedGroups = groups.filter((g) =>
    isPortalProductGroupAllowedForCertifications(
      g.key,
      certifications,
      instrument,
    ),
  );

  const result = allowedGroups
    .map((g) => ({
      id: g.id,
      key: g.key,
      nameEn: g.nameEn,
      nameDe: g.nameDe,
      sortOrder: g.sortOrder,
      products: products.filter((p) => p.category === g.key),
    }))
    .filter((g) => g.products.length > 0);

  res.json(result);
});

// ── GET /portal/training-dates ────────────────────────────────────────────────
router.get("/portal/training-dates", requirePortalAuth, async (req, res) => {
  const now = new Date();

  const rows = await db
    .select()
    .from(trainingDatesTable)
    .where(eq(trainingDatesTable.isActive, true))
    .orderBy(trainingDatesTable.instrument, trainingDatesTable.date);

  // Match the public website's selectable-date rule: active, not full, and
  // outside the 21-day registration window.
  res.json(
    rows
      .filter((r) => isTrainingDateAvailable(r, now))
      .map((r) => ({
      id: r.id,
      instrument: r.instrument,
      date: r.date,
      time: r.time,
      location: r.location,
      locationDetail: r.locationDetail,
      maxParticipants: r.maxParticipants,
      registeredCount: r.registeredCount,
      availableSpots: Math.max(0, r.maxParticipants - r.registeredCount),
      isAvailable: true,
      notes: r.notes,
      })),
  );
});

// ── POST /portal/profile-update-request ──────────────────────────────────────
router.post(
  "/portal/profile-update-request",
  requirePortalAuth,
  async (req, res) => {
    const { customerId } = (req as any).portalCustomer as PortalTokenPayload;

    await db.insert(adminApprovalQueueTable).values({
      customerId,
      type: "profile_update",
      payload: req.body,
    });

    res.json({ ok: true });
  },
);

// ── POST /portal/order-request ────────────────────────────────────────────────
router.post("/portal/order-request", requirePortalAuth, async (req, res) => {
    const { customerId } = (req as any).portalCustomer as PortalTokenPayload;
  const requestBody = req.body as Record<string, unknown>;
  const submittedProducts = requestBody.products;
  const orderMode = requestBody.orderMode;

  if (
    (orderMode !== "product" && orderMode !== "service") ||
    requestBody.privacyConsent !== true ||
    requestBody.detailsConfirmed !== true
  ) {
    res.status(400).json({ error: "ORDER_DETAILS_CONFIRMATION_REQUIRED" });
    return;
  }

  if (submittedProducts !== undefined && !Array.isArray(submittedProducts)) {
    res.status(400).json({ error: "INVALID_ORDER_PRODUCTS" });
    return;
  }

  const requestedProducts = submittedProducts ?? [];
  const productIds: number[] = [];
  const quantitiesByProductId = new Map<number, number>();

  for (const item of requestedProducts) {
    if (!item || typeof item !== "object") {
      res.status(400).json({ error: "INVALID_ORDER_PRODUCTS" });
      return;
    }

    const { productId, quantity } = item as Record<string, unknown>;
    if (
      typeof productId !== "number" ||
      !Number.isInteger(productId) ||
      productId <= 0 ||
      typeof quantity !== "number" ||
      !Number.isInteger(quantity) ||
      quantity <= 0 ||
      quantitiesByProductId.has(productId)
    ) {
      res.status(400).json({ error: "INVALID_ORDER_PRODUCTS" });
      return;
    }

    productIds.push(productId);
    quantitiesByProductId.set(productId, quantity);
  }

  const [customer] = await db
    .select({
      id: websiteCustomersTable.id,
      customerNr: websiteCustomersTable.customerNr,
      institutionName: websiteCustomersTable.institutionName,
      firstName: websiteCustomersTable.firstName,
      lastName: websiteCustomersTable.lastName,
      country: websiteCustomersTable.country,
      ustIdNr: websiteCustomersTable.ustIdNr,
      isPublicAuthority: websiteCustomersTable.isPublicAuthority,
      defaultBuyerReference: websiteCustomersTable.defaultBuyerReference,
      instrument: websiteCustomersTable.instrument,
      certifications: websiteCustomersTable.certifications,
    })
    .from(websiteCustomersTable)
    .where(eq(websiteCustomersTable.id, customerId))
    .limit(1);

  if (!customer) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }

  if (orderMode === "service") {
    const { products: _submittedProducts, ...payload } = requestBody;
    await db.insert(adminApprovalQueueTable).values({
      customerId,
      type: "order_request",
      payload: { ...payload, products: [] },
    });
    res.json({ ok: true });
    return;
  }

  const contactName = typeof requestBody.contactName === "string" ? requestBody.contactName.trim() : "";
  const contactEmail = typeof requestBody.contactEmail === "string" ? requestBody.contactEmail.trim() : "";
  const contactPhone = typeof requestBody.contactPhone === "string" ? requestBody.contactPhone.trim() : "";
  const deliveryAddress = typeof requestBody.deliveryAddress === "string" ? requestBody.deliveryAddress.trim() : "";
  if (!contactName || !contactEmail.includes("@") || !contactPhone || !deliveryAddress || productIds.length === 0) {
    res.status(400).json({ error: "INCOMPLETE_ORDER_DETAILS" });
    return;
  }

  const catalogProducts = productIds.length === 0
    ? []
    : await db
      .select({
        id: irocProducts.id,
        sku: irocProducts.sku,
        nameEn: irocProducts.nameEn,
        nameDe: irocProducts.nameDe,
        descriptionEn: irocProducts.descriptionEn,
        descriptionDe: irocProducts.descriptionDe,
        unitPrice: irocProducts.unitPrice,
        category: irocProducts.category,
        isService: irocProductGroups.isService,
      })
      .from(irocProducts)
      .innerJoin(
        irocProductGroups,
        eq(irocProducts.category, irocProductGroups.key),
      )
      .where(inArray(irocProducts.id, productIds));

  if (catalogProducts.length !== productIds.length) {
    res.status(400).json({ error: "INVALID_ORDER_PRODUCTS" });
    return;
  }

  const products = productIds.map((productId) => {
    const product = catalogProducts.find((row) => row.id === productId)!;
    return {
      productId,
      name: product.nameDe || product.nameEn,
      quantity: quantitiesByProductId.get(productId)!,
      category: product.category,
      sku: product.sku,
      nameEn: product.nameEn,
      nameDe: product.nameDe,
      descriptionEn: product.descriptionEn,
      descriptionDe: product.descriptionDe,
      unitPrice: product.unitPrice,
    };
  });

  if (!products.every((product) =>
    !catalogProducts.find((row) => row.id === product.productId)?.isService &&
    isPortalProductGroupAllowedForCertifications(
      product.category,
      customer.certifications,
      customer.instrument,
    ),
  )) {
    res.status(403).json({ error: "PRODUCT_NOT_CERTIFIED" });
    return;
  }

  const autoInvoiceEnabled = await isSallyAutomationEnabled(SALLY_AUTO_INVOICE_KEY);
  const created = await createPortalOrderAndDraftInvoice({
    customer,
    contactName,
    contactEmail,
    contactPhone,
    deliveryAddress,
    notes: typeof requestBody.notes === "string" && requestBody.notes.trim()
      ? requestBody.notes.trim()
      : null,
    products: products.map((product) => ({
      id: product.productId,
      sku: product.sku,
      nameEn: product.nameEn,
      nameDe: product.nameDe,
      descriptionEn: product.descriptionEn,
      descriptionDe: product.descriptionDe,
      unitPrice: product.unitPrice,
      category: product.category,
      quantity: product.quantity,
    })),
  }, { createInvoice: autoInvoiceEnabled });

  res.json({ ok: true, ...created });
});

// ── POST /portal/training-request ────────────────────────────────────────────
router.post(
  "/portal/training-request",
  requirePortalAuth,
  async (req, res) => {
    const { customerId } = (req as any).portalCustomer as PortalTokenPayload;

    if (req.body?.privacyConsent !== true || req.body?.marketingConsent !== true) {
      res.status(400).json({ error: "Required consent is missing" });
      return;
    }

    await db.insert(adminApprovalQueueTable).values({
      customerId,
      type: "training_request",
      payload: req.body,
    });

    res.json({ ok: true });
  },
);

// ── GET /portal/invoices/:id/pdf ──────────────────────────────────────────────
// Portal customers download their own invoices. Validates ownership before streaming.
router.get("/portal/invoices/:id/pdf", requirePortalAuth, async (req, res) => {
  const portalCustomer = (req as any).portalCustomer as PortalTokenPayload;
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Invalid invoice id" }); return; }

  const [row] = await db.select().from(irocInvoices).where(eq(irocInvoices.id, id));
  if (!row) { res.status(404).json({ error: "Invoice not found" }); return; }

  let ownerCustomerId = row.websiteCustomerId;
  if (row.correctionOfInvoiceId) {
    const [source] = await db
      .select({ websiteCustomerId: irocInvoices.websiteCustomerId })
      .from(irocInvoices)
      .where(eq(irocInvoices.id, row.correctionOfInvoiceId));
    ownerCustomerId = source?.websiteCustomerId ?? ownerCustomerId;
  }

  if (ownerCustomerId !== portalCustomer.customerId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const [wc] = await db
    .select()
    .from(websiteCustomersTable)
    .where(eq(websiteCustomersTable.id, ownerCustomerId));
  const resolvedCustomer = wc
    ? (wcToCustomerShape(wc) as typeof irocCustomers.$inferSelect)
    : undefined;
  if (!resolvedCustomer) {
    res.status(422).json({ error: "A complete customer is required for an EN 16931 invoice" });
    return;
  }

  const items = await db.select().from(irocInvoiceItems)
    .where(eq(irocInvoiceItems.invoiceId, id));

  try {
    const pdf = await renderHybridInvoicePdf(
      row as Parameters<typeof renderHybridInvoicePdf>[0],
      resolvedCustomer,
      items,
    );
    // Portal downloads are rendered from the current invoice template. Do not
    // let a browser or proxy reuse an older PDF for a past invoice.
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${row.invoiceNumber}.pdf"`);
    res.end(pdf);
  } catch (error) {
    (req as any).log?.error({ err: error, invoiceId: id }, "Unable to generate portal EN 16931 invoice");
    res.status(422).json({
      error: error instanceof Error ? error.message : "Unable to generate compliant invoice",
    });
  }
});


// ── GET /portal/app-settings ──────────────────────────────────────────────────
// Returns non-sensitive portal configuration (welcome text, nav config).
// Public — no auth required; loaded before portal login to render custom welcome.
// Written by the admin via POST /admin/portal-settings.
router.get(
  "/portal/app-settings",
  async (_req, res) => {
    const PORTAL_PUBLIC_KEYS = new Set([
      "portal_welcome_de",
      "portal_welcome_en",
      "portal_subtitle_de",
      "portal_subtitle_en",
      "portal_nav_config",
    ]);
    const rows = await db.select().from(settingsTable);
    const out: Record<string, string> = {};
    for (const row of rows) {
      if (PORTAL_PUBLIC_KEYS.has(row.key)) out[row.key] = row.value;
    }
    res.json(out);
  },
);

export default router;
