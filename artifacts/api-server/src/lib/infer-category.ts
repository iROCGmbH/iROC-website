/**
 * Determines a product category from invoice item data.
 *
 * Priority:
 *  1. The category stored on the linked product record (when product_id is set and the
 *     product has a category).
 *  2. Keyword inference from the item's product_name (covers items whose product_id is
 *     null or whose linked product has no category set).
 *  3. Falls back to "other".
 */
export function inferCategory(
  /** Category from the joined iroc_products row – may be null when product_id is unlinked. */
  linkedCategory: string | null,
  /** product_name stored on the invoice item itself – always present. */
  productName: string,
): string {
  if (linkedCategory) return linkedCategory;
  const n = productName.toLowerCase();
  if (n.includes("spirecut"))                          return "spirecut";
  if (n.includes("mini stem") || n.includes("ministem")) return "ministem";
  if (n.includes("cellenis"))                          return "cellenis";
  if (n.includes("service"))                           return "services";
  return "other";
}
