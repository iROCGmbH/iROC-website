import { useListIrocProductGroups } from "@workspace/api-client-react";

/**
 * Group-aware category helpers — labels and ordering come from the
 * admin-managed product groups table, falling back to legacy hardcoded
 * values for old/unknown keys (e.g. the "other" bucket for unlinked items).
 */

export const LEGACY_CAT_ORDER: Record<string, number> = { spirecut: 0, ministem: 1, cellenis: 2, other: 2.5, services: 3 };
const LEGACY_LABEL_EN: Record<string, string> = { spirecut: "Spirecut®", ministem: "MiniStem®", cellenis: "Cellenis®", other: "Other", services: "Services" };
const LEGACY_LABEL_DE: Record<string, string> = { spirecut: "Spirecut®", ministem: "MiniStem®", cellenis: "Cellenis®", other: "Sonstige", services: "Dienstleistungen" };

export function legacyCatLabel(cat: string, lang: string) {
  return (lang === "de" ? LEGACY_LABEL_DE : LEGACY_LABEL_EN)[cat] ?? cat;
}

export interface ProductGroup {
  id: number;
  key: string;
  nameEn: string;
  nameDe: string;
  sortOrder: number;
  isService?: boolean;
}

export function useProductGroupHelpers(lang: string) {
  const { data } = useListIrocProductGroups();
  const groups = (data ?? []) as ProductGroup[];
  const label = (cat: string | null | undefined) => {
    const key = cat ?? "cellenis";
    const g = groups.find(x => x.key === key);
    return g ? (lang === "de" ? g.nameDe : g.nameEn) : legacyCatLabel(key, lang);
  };
  const order = (cat: string | null | undefined) => {
    const key = cat ?? "cellenis";
    const g = groups.find(x => x.key === key);
    return g ? g.sortOrder : (LEGACY_CAT_ORDER[key] ?? 90) + 100;
  };
  return { groups, label, order };
}
