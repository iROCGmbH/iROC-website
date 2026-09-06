export type InvoiceShipmentAddress = {
  name: string;
  company: string | null;
  street: string;
  houseNumber: string | null;
  postalCode: string;
  city: string;
  country: string;
  email: string;
  phone: string | null;
};

export const SENDCLOUD_INSURANCE_THRESHOLD = 800;
export const SENDCLOUD_MAX_INSURED_VALUE = 5000;

type ShippingRecord = Record<string, string | number | null | undefined>;

function text(value: ShippingRecord[string]): string {
  return String(value ?? "").trim();
}

function first(...values: ShippingRecord[string][]): string {
  return values.map(text).find(Boolean) ?? "";
}

/**
 * Prefer a customer's dedicated delivery fields when any of them are present,
 * then fall back to their regular billing address. Legacy customer data is
 * retained as a final fallback for historical invoices.
 */
export function resolveInvoiceShipmentAddress(row: ShippingRecord): InvoiceShipmentAddress {
  const hasShippingAddress = [
    row.shipping_street, row.shipping_address, row.shipping_postal_code,
    row.shipping_city, row.shipping_country, row.shipping_email, row.shipping_phone,
  ].some((value) => Boolean(text(value)));
  const firstName = first(row.first_name);
  const lastName = first(row.last_name);
  const shippingFirstName = first(row.shipping_first_name);
  const shippingLastName = first(row.shipping_last_name);
  const billingName = [firstName, lastName].filter(Boolean).join(" ");
  const shippingName = [shippingFirstName, shippingLastName].filter(Boolean).join(" ");

  return {
    name: (hasShippingAddress ? shippingName || billingName : billingName) || first(row.legacy_name, row.customer_email, row.legacy_email, "Customer"),
    company: (hasShippingAddress
      ? first(row.shipping_institution_name, row.institution_name, row.legacy_company)
      : first(row.institution_name, row.legacy_company)) || null,
    street: hasShippingAddress
      ? first(row.shipping_street, row.shipping_address, row.street, row.address, row.legacy_street, row.legacy_address)
      : first(row.street, row.address, row.legacy_street, row.legacy_address, row.shipping_street, row.shipping_address),
    houseNumber: (hasShippingAddress
      ? first(row.shipping_house_number, row.house_number, row.legacy_house_number)
      : first(row.house_number, row.legacy_house_number, row.shipping_house_number)) || null,
    postalCode: hasShippingAddress
      ? first(row.shipping_postal_code, row.postal_code, row.legacy_postal_code)
      : first(row.postal_code, row.legacy_postal_code, row.shipping_postal_code),
    city: hasShippingAddress
      ? first(row.shipping_city, row.city, row.legacy_city)
      : first(row.city, row.legacy_city, row.shipping_city),
    country: hasShippingAddress
      ? first(row.shipping_country, row.country, row.legacy_country, "DE")
      : first(row.country, row.legacy_country, row.shipping_country, "DE"),
    email: hasShippingAddress
      ? first(row.shipping_email, row.customer_email, row.legacy_email)
      : first(row.customer_email, row.legacy_email, row.shipping_email),
    phone: (hasShippingAddress
      ? first(row.shipping_phone, row.customer_phone, row.legacy_phone)
      : first(row.customer_phone, row.legacy_phone, row.shipping_phone)) || null,
  };
}

export function invoiceInsuranceValue(invoiceTotal: number): number {
  // Sendcloud requires the insured amount to be a whole currency unit and
  // rounds values up in its dashboard. Match that contract for both quote
  // lookup and shipment creation so decimal invoice totals remain eligible.
  // Shipment Protection is capped at €5,000 per shipment.
  return invoiceTotal > SENDCLOUD_INSURANCE_THRESHOLD
    ? Math.min(Math.ceil(invoiceTotal), SENDCLOUD_MAX_INSURED_VALUE)
    : 0;
}

export function invoiceInsuranceCoverageGap(invoiceTotal: number): number {
  if (invoiceTotal <= SENDCLOUD_INSURANCE_THRESHOLD) return 0;
  return Math.max(0, Math.ceil(invoiceTotal) - invoiceInsuranceValue(invoiceTotal));
}

export function isPortalSourceOrder(sourceOrderReviewResult: unknown): boolean {
  if (typeof sourceOrderReviewResult !== "string") return false;
  try {
    return JSON.parse(sourceOrderReviewResult).source === "iroc_portal";
  } catch {
    return false;
  }
}

export function isDirectInvoiceShipmentEligible(
  status: unknown,
  sourceOrderId: unknown,
  sourceOrderReviewResult?: unknown,
): boolean {
  if (status !== "draft") return false;
  if (sourceOrderId === null) return true;
  return isPortalSourceOrder(sourceOrderReviewResult);
}