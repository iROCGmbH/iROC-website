import {
  DollarSign, Package, Users, Wrench, Globe, Activity, BarChart3,
  FileText, Calendar, Settings, MessageSquareQuote, Search, Wand2,
  Building2, Warehouse, BookOpen, FileArchive, Mail, UserSearch, Megaphone,
  Stethoscope, ImageIcon, Link2, LayoutDashboard, ClipboardList, UserCircle2,
  CalendarClock, KeyRound, BarChart2, BotMessageSquare, Receipt, Smartphone,
  Server, Video,
  type LucideIcon,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type NavItem = {
  slug: string;
  visible: boolean;
};

export type NavGroup = {
  id: string;
  labelDe: string;
  labelEn: string;
  icon: string; // key in ICON_MAP
  items: NavItem[];
  children?: NavGroup[]; // sub-groups (supports arbitrary depth)
};

export type NavConfig = NavGroup[];

// ── Route registry ────────────────────────────────────────────────────────────

export const ROUTE_REGISTRY: Record<string, {
  labelDe: string;
  labelEn: string;
  icon: string;
}> = {
  "/customers":                     { labelDe: "Kunden",                labelEn: "Customers",             icon: "Users" },
  "/products":                      { labelDe: "Produkte",              labelEn: "Products",              icon: "Package" },
  "/inventory":                     { labelDe: "Inventar",              labelEn: "Inventory",             icon: "Warehouse" },
  "/invoices":                      { labelDe: "Rechnungen",            labelEn: "Invoices",              icon: "FileText" },
  "/expenses":                      { labelDe: "Ausgaben",              labelEn: "Expenses",              icon: "Receipt" },
  "/sales-summary":                 { labelDe: "Verkaufsübersicht",     labelEn: "Sales Summary",         icon: "BarChart3" },
  "/reports":                       { labelDe: "Berichte",              labelEn: "Reports",               icon: "BarChart2" },
  "/spirecut-quotes":               { labelDe: "Spirecut Zitate",       labelEn: "Spirecut Quotes",       icon: "MessageSquareQuote" },
  "/announcements":                 { labelDe: "Ankündigungen",         labelEn: "Announcements",         icon: "Megaphone" },
  "/leads":                         { labelDe: "Leads",                 labelEn: "Leads",                 icon: "UserSearch" },
  "/upcoming-events":               { labelDe: "Kongress-Finder",       labelEn: "Congress Finder",       icon: "Search" },
  // Agents/Managers sub-pages
  "/sally":                         { labelDe: "Sally \u2013 Sales-Spezialistin", labelEn: "Sally \u2013 Sales Specialist", icon: "UserSearch" },
  "/spiro":                         { labelDe: "Spiro \u2013 Patienten-Chatbot",  labelEn: "Spiro \u2013 Patient Chatbot",  icon: "BotMessageSquare" },
  "/web-design-agent":              { labelDe: "Nite \u2013 Website-Designerin", labelEn: "Nite \u2013 Website Designer",  icon: "Wand2" },
  "/tori":                          { labelDe: "Tori \u2013 Ausgaben & Inventar", labelEn: "Tori \u2013 Expenses & Inventory", icon: "BotMessageSquare" },
  "/datev-export":                  { labelDe: "DATEV-Export",          labelEn: "DATEV Export",          icon: "FileArchive" },
  // iROC Website
  "/iroc-website/training":         { labelDe: "Schulungstermine",      labelEn: "Training Dates",        icon: "Calendar" },
  "/iroc-website/registrations":    { labelDe: "Anmeldungen",           labelEn: "Registrations",         icon: "ClipboardList" },
  "/iroc-website/doctors":          { labelDe: "Zertifizierte Ärzte",   labelEn: "Certified Doctors",     icon: "Users" },
  "/iroc-website/resources":        { labelDe: "Portal-Ressourcen",     labelEn: "Portal Resources",      icon: "BookOpen" },
  "/iroc-website/team":             { labelDe: "Team",                  labelEn: "Team",                  icon: "UserCircle2" },
  "/iroc-website/events":           { labelDe: "Events",                labelEn: "Events",                icon: "CalendarClock" },
  "/iroc-website/email":            { labelDe: "E-Mail Adressen",       labelEn: "Email Addresses",       icon: "Mail" },
  "/iroc-website/customers":        { labelDe: "Kunden",                labelEn: "Customers",             icon: "Building2" },
  "/iroc-website/orders":           { labelDe: "Bestellungen",          labelEn: "Orders",                icon: "ShoppingCart" },
  "/iroc-website/settings":         { labelDe: "Website-Einstellungen", labelEn: "Website Settings",      icon: "Settings" },
  "/iroc-website/browser-app":      { labelDe: "iROC Browser APP",      labelEn: "iROC Browser APP",      icon: "Smartphone" },
  "/iroc-website/portal-passwords": { labelDe: "Portal-Passwörter",     labelEn: "Portal Passwords",      icon: "KeyRound" },
  "/iroc-website/content":          { labelDe: "Texte bearbeiten",      labelEn: "Edit Texts",            icon: "FileText" },
  // Spirecut Website
  "/spirecut/content":              { labelDe: "Texte bearbeiten",      labelEn: "Edit Texts",            icon: "FileText" },
  "/spirecut/testimonials":         { labelDe: "Erfahrungsberichte",    labelEn: "Patient Stories",       icon: "Video" },
  // Spirecut App
  "/spirecut/media":                { labelDe: "Medien & Bilder",       labelEn: "Media & Images",        icon: "ImageIcon" },
  "/spirecut/social":               { labelDe: "Social Links",          labelEn: "Social Links",          icon: "Link2" },
  "/spirecut/postop":               { labelDe: "Postoperative Daten",   labelEn: "Postoperative Data",    icon: "Activity" },
  "/spirecut/settings":             { labelDe: "App-Einstellungen",     labelEn: "App Settings",          icon: "Settings" },
  "/spirecut/browser-app":          { labelDe: "Spirecut browser APP",   labelEn: "Spirecut browser APP",  icon: "Smartphone" },
  // iROC Doctor Portal
  "/portal/design":                 { labelDe: "Design & Einstellungen", labelEn: "Design & Settings",   icon: "Wand2" },
  "/portal/content":                { labelDe: "Texte & Inhalte",       labelEn: "Text & Content",        icon: "FileText" },
  "/portal/nav-config":             { labelDe: "Navigation",             labelEn: "Navigation",           icon: "LayoutDashboard" },
  // Sally sub-pages
  "/sally/leads":                   { labelDe: "Sally \u2013 Leads",          labelEn: "Sally \u2013 Leads",          icon: "UserSearch" },
  "/sally/doctors":                 { labelDe: "Sally \u2013 Ärzte",          labelEn: "Sally \u2013 Doctors",         icon: "Stethoscope" },
  "/sally/email-queue":             { labelDe: "Sally \u2013 E-Mail-Freigabe", labelEn: "Sally \u2013 Email Queue",    icon: "Mail" },
  "/sally/settings":                { labelDe: "Sally \u2013 Einstellungen",  labelEn: "Sally \u2013 Settings",       icon: "Settings" },
  // Unified email config (under Configuration → Email)
  "/email-config":                  { labelDe: "E-Mail-Konfiguration",  labelEn: "Email Configuration",   icon: "Mail" },
  "/email-help":                    { labelDe: "E-Mail-Hilfe",           labelEn: "Email Help",             icon: "BookOpen" },
};

// ── Icon map ──────────────────────────────────────────────────────────────────

export const ICON_MAP: Record<string, LucideIcon> = {
  DollarSign, Package, Users, Wrench, Globe, Activity, BarChart3,
  FileText, Calendar, Settings, MessageSquareQuote, Search, Wand2,
  Building2, Warehouse, BookOpen, FileArchive, Mail, UserSearch, Megaphone,
  Stethoscope, ImageIcon, Link2, LayoutDashboard, ClipboardList, UserCircle2,
  CalendarClock, KeyRound, BarChart2, BotMessageSquare, Receipt, Smartphone, Server, Video,
};

// ── Icon picker ───────────────────────────────────────────────────────────────

export const PICKER_ICONS: { slug: string; label: string }[] = [
  { slug: "DollarSign",         label: "Finance / Dollar" },
  { slug: "Package",            label: "Package" },
  { slug: "Users",              label: "Users" },
  { slug: "Wrench",             label: "Tools / Wrench" },
  { slug: "Globe",              label: "Globe / Website" },
  { slug: "Activity",           label: "Activity" },
  { slug: "BarChart3",          label: "Bar Chart" },
  { slug: "FileText",           label: "Documents" },
  { slug: "Calendar",           label: "Calendar" },
  { slug: "Settings",           label: "Settings" },
  { slug: "MessageSquareQuote", label: "Quotes" },
  { slug: "Search",             label: "Search" },
  { slug: "Wand2",              label: "Magic Wand" },
  { slug: "Building2",          label: "Building" },
  { slug: "Warehouse",          label: "Warehouse" },
  { slug: "BookOpen",           label: "Book / Resources" },
  { slug: "FileArchive",        label: "Archive" },
  { slug: "Mail",               label: "Mail" },
  { slug: "UserSearch",         label: "Lead / Prospect" },
  { slug: "Megaphone",          label: "Announcements" },
  { slug: "Stethoscope",        label: "Medical" },
  { slug: "ImageIcon",          label: "Media / Images" },
  { slug: "Link2",              label: "Links" },
  { slug: "ClipboardList",      label: "Registrations" },
  { slug: "BotMessageSquare",   label: "CRM / Agent" },
  { slug: "Smartphone",         label: "App / Mobile" },
  { slug: "Server",             label: "Server / SMTP" },
  { slug: "Video",              label: "Video / Testimonials" },
];

// ── Default nav config ────────────────────────────────────────────────────────

export const DEFAULT_NAV_CONFIG: NavConfig = [
  {
    id: "finance",
    labelDe: "Finanzen",
    labelEn: "Finance",
    icon: "DollarSign",
    items: [
      { slug: "/invoices",      visible: true },
      { slug: "/expenses",      visible: true },
      { slug: "/sales-summary", visible: true },
      { slug: "/reports",       visible: true },
      { slug: "/datev-export",  visible: true },
      { slug: "/iroc-website/orders", visible: true },
    ],
  },
  {
    id: "merchandise",
    labelDe: "Produkte",
    labelEn: "Merchandise",
    icon: "Package",
    items: [
      { slug: "/products",  visible: true },
      { slug: "/inventory", visible: true },
    ],
  },
  {
    id: "contacts",
    labelDe: "Kontakte",
    labelEn: "Contacts",
    icon: "Users",
    items: [
      { slug: "/customers", visible: true },
      { slug: "/leads",     visible: true },
    ],
  },
  {
    id: "media",
    labelDe: "Medien & Inhalte",
    labelEn: "Media & Content",
    icon: "Megaphone",
    items: [
      { slug: "/spirecut-quotes", visible: true },
      { slug: "/announcements",   visible: true },
    ],
  },
  {
    id: "tools",
    labelDe: "Tools",
    labelEn: "Tools",
    icon: "Wrench",
    items: [
      { slug: "/upcoming-events", visible: true },
    ],
  },
  {
    id: "agents",
    labelDe: "Agents/Managers",
    labelEn: "Agents/Managers",
    icon: "BotMessageSquare",
    items: [
      { slug: "/sally",            visible: true },
      { slug: "/spiro",            visible: true },
      { slug: "/tori",             visible: true },
      { slug: "/web-design-agent", visible: true },
    ],
  },
  // ── Configuration parent branch ───────────────────────────────────────────
  {
    id: "configuration",
    labelDe: "Konfiguration",
    labelEn: "Configuration",
    icon: "Settings",
    items: [],
    children: [
      // ── Website sub-branch ─────────────────────────────────────────────────
      {
        id: "websites",
        labelDe: "Website",
        labelEn: "Website",
        icon: "Globe",
        items: [],
        children: [
          {
            id: "iroc-website",
            labelDe: "iROC Website",
            labelEn: "iROC Website",
            icon: "Globe",
            items: [
              { slug: "/iroc-website/training",         visible: true },
              { slug: "/iroc-website/registrations",    visible: true },
              { slug: "/iroc-website/doctors",          visible: true },
              { slug: "/iroc-website/resources",        visible: true },
              { slug: "/iroc-website/team",             visible: true },
              { slug: "/iroc-website/events",           visible: true },
              { slug: "/iroc-website/customers",        visible: true },
              { slug: "/iroc-website/settings",         visible: true },
              { slug: "/iroc-website/browser-app",      visible: true },
              { slug: "/iroc-website/portal-passwords", visible: true },
              { slug: "/iroc-website/content",          visible: true },
            ],
          },
          {
            id: "spirecut-website",
            labelDe: "Spirecut Website",
            labelEn: "Spirecut Website",
            icon: "Stethoscope",
            items: [
              { slug: "/spirecut/content", visible: true },
              { slug: "/spirecut/testimonials", visible: true },
            ],
          },
        ],
      },
      // ── Apps sub-branch ────────────────────────────────────────────────────
      {
        id: "apps",
        labelDe: "Apps",
        labelEn: "Apps",
        icon: "Smartphone",
        items: [],
        children: [
          {
            id: "portal-app",
            labelDe: "iROC Arztportal",
            labelEn: "iROC Doctor Portal",
            icon: "KeyRound",
            items: [
              { slug: "/portal/design",     visible: true },
              { slug: "/portal/content",    visible: true },
              { slug: "/portal/nav-config", visible: true },
            ],
          },
          {
            id: "spirecut-app",
            labelDe: "Spirecut App",
            labelEn: "Spirecut App",
            icon: "Activity",
            items: [
              { slug: "/spirecut/media",    visible: true },
              { slug: "/spirecut/social",   visible: true },
              { slug: "/spirecut/postop",   visible: true },
              { slug: "/spirecut/settings", visible: true },
              { slug: "/spirecut/browser-app", visible: true },
            ],
          },
        ],
      },
      // ── Email sub-branch ──────────────────────────────────────────────────
      {
        id: "email-branch",
        labelDe: "E-Mail",
        labelEn: "Email",
        icon: "Mail",
        items: [
          { slug: "/email-config", visible: true },
          { slug: "/email-help", visible: true },
        ],
      },
    ],
  },
];

// ── IDs that have been promoted/migrated and must be stripped from old stored top-level ──
// Previously top-level groups now live as children of "configuration".
const MIGRATED_TOP_LEVEL_IDS = new Set([
  "iroc-website",    // was direct top-level child (old v1)
  "spirecut-website", // was direct top-level child (old v1)
  "websites",        // was top-level group (old v2)
  "apps",            // was top-level group (old v2)
]);

// Items that moved between existing groups must be removed from stored layouts
// before missing defaults are merged, otherwise their old location wins.
const MOVED_NAV_ITEMS: Record<string, Set<string>> = {
  "iroc-website": new Set(["/iroc-website/orders"]),
};

// ── Helpers for recursive reconciliation ─────────────────────────────────────

/** Collect every slug from a group tree, regardless of nesting depth. */
function collectAllSlugs(groups: NavGroup[]): Set<string> {
  const slugs = new Set<string>();
  function traverse(g: NavGroup) {
    g.items.forEach(i => slugs.add(i.slug));
    (g.children ?? []).forEach(traverse);
  }
  groups.forEach(traverse);
  return slugs;
}

/**
 * Build a fresh group from a default definition, omitting any slugs that are
 * already homed somewhere else in the stored config.
 */
function buildFromDefault(def: NavGroup, allStoredSlugs: Set<string>): NavGroup {
  if (def.children) {
    return { ...def, children: def.children.map(c => buildFromDefault(c, allStoredSlugs)) };
  }
  return { ...def, items: def.items.filter(i => !allStoredSlugs.has(i.slug)) };
}

/**
 * Recursively reconcile a single stored group against its default counterpart.
 * - Adds any items/children from the default that are missing in stored.
 * - Handles arbitrary nesting depth.
 */
function reconcileGroup(
  stored: NavGroup,
  def: NavGroup,
  allStoredSlugs: Set<string>,
): NavGroup {
  if (def.children) {
    // This group has sub-groups — reconcile children recursively.
    const storedChildrenById = new Map((stored.children ?? []).map(c => [c.id, c]));

    const reconciledChildren: NavGroup[] = (stored.children ?? []).map(storedChild => {
      const defaultChild = def.children!.find(c => c.id === storedChild.id);
      if (!defaultChild) return storedChild; // user-custom child — keep
      return reconcileGroup(storedChild, defaultChild, allStoredSlugs);
    });

    // Append new children from defaults not yet in stored
    for (const defaultChild of def.children) {
      if (!storedChildrenById.has(defaultChild.id)) {
        reconciledChildren.push(buildFromDefault(defaultChild, allStoredSlugs));
      }
    }

    return { ...stored, children: reconciledChildren };
  }

  // Regular group — append missing items.
  const missingItems = def.items.filter(i => !allStoredSlugs.has(i.slug));
  return missingItems.length === 0
    ? stored
    : { ...stored, items: [...stored.items, ...missingItems] };
}

// ── reconcileNavConfig ────────────────────────────────────────────────────────

/**
 * Merge a stored NavConfig against DEFAULT_NAV_CONFIG so that new groups or
 * items added to the default automatically appear for users whose saved layout
 * predates the change. Supports arbitrary nesting depth.
 *
 * Migration: groups that were formerly top-level but are now nested (e.g. inside
 * "configuration") are stripped from the stored top level to prevent duplication.
 */
export function reconcileNavConfig(stored: NavConfig): NavConfig {
  // Step 1: strip migrated top-level groups
  const filteredStored = stored
    .filter(g => !MIGRATED_TOP_LEVEL_IDS.has(g.id))
    .map(function removeMovedItems(group): NavGroup {
      const movedItems = MOVED_NAV_ITEMS[group.id];
      return {
        ...group,
        items: movedItems
          ? group.items.filter(item => !movedItems.has(item.slug))
          : group.items,
        children: group.children?.map(removeMovedItems),
      };
    });

  // Step 2: collect all slugs present anywhere in the filtered stored config
  const allStoredSlugs = collectAllSlugs(filteredStored);

  const storedById = new Map(filteredStored.map(g => [g.id, g]));

  // Step 3: reconcile each stored group against its default counterpart
  const reconciled: NavGroup[] = filteredStored.map(storedGroup => {
    const defaultGroup = DEFAULT_NAV_CONFIG.find(g => g.id === storedGroup.id);
    if (!defaultGroup) return storedGroup; // user-custom group — keep as-is
    return reconcileGroup(storedGroup, defaultGroup, allStoredSlugs);
  });

  // Step 4: append entire groups that exist in default but not in stored
  for (const defaultGroup of DEFAULT_NAV_CONFIG) {
    if (storedById.has(defaultGroup.id)) continue;
    reconciled.push(buildFromDefault(defaultGroup, allStoredSlugs));
  }

  return reconciled;
}
