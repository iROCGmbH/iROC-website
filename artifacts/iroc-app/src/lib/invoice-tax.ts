import { normalizeCountryCode, type InvoiceSupplyKind } from "@workspace/api-zod";

type TaxLine = {
  productId: number | null;
  productName: string;
  countryOfOrigin: string;
  isDemo?: boolean;
};

type Product = {
  id: number;
  category?: string | null;
};

type ProductGroup = {
  key: string;
  isService?: boolean;
};

const SERVICE_NAME_PATTERN = /\b(service|teaching|training|consult(?:ing)?|lecture|speaking|lesson|beratung|schulung|unterricht|vortrag|honorar)\b/i;

/**
 * Infer the tax-relevant supply from the selected catalog groups. Custom
 * service lines are recognised by their description, so teaching and
 * consulting invoices don't silently fall back to a goods treatment.
 */
export function inferInvoiceSupplyKind(
  items: TaxLine[],
  products: Product[] | undefined,
  productGroups: ProductGroup[] | undefined,
): InvoiceSupplyKind {
  const serviceCategories = new Set(
    (productGroups ?? []).filter((group) => group.isService).map((group) => group.key),
  );
  if (!productGroups || productGroups.length === 0) serviceCategories.add("services");

  const kinds = new Set(
    items
      .filter((item) => !item.isDemo)
      .map((item) => {
        const product = products?.find((candidate) => candidate.id === item.productId);
        if (product && serviceCategories.has(product.category ?? "")) return "service";
        return SERVICE_NAME_PATTERN.test(item.productName) ? "service" : "goods";
      }),
  );

  if (kinds.size === 1 && kinds.has("service")) return "service";
  if (kinds.size > 1) return "mixed";
  return "goods";
}

/** Use the first populated line-item origin; Germany remains the app default. */
export function inferInvoiceOriginCountry(items: TaxLine[]): string {
  return items.find((item) => item.countryOfOrigin.trim())?.countryOfOrigin ?? "Germany";
}

/** Prefer the delivery destination whenever the customer has a shipping address. */
export function resolveInvoiceDestinationCountry(
  shippingCountry: string | null | undefined,
  billingCountry: string | null | undefined,
): string | null {
  return shippingCountry?.trim() || billingCountry?.trim() || null;
}

/**
 * Choose the invoice document language from the customer's destination.
 * Germany and Austria use German; every other destination uses English.
 *
 * This is only a default. The invoice form keeps the administrator's explicit
 * language selection as the authoritative value.
 */
export function computeDefaultInvoiceLanguage(
  shippingCountry: string | null | undefined,
  billingCountry: string | null | undefined,
): "de" | "en" {
  const destination = normalizeCountryCode(
    resolveInvoiceDestinationCountry(shippingCountry, billingCountry),
  );
  return destination === "DE" || destination === "AT" ? "de" : "en";
}
