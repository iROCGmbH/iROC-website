/**
 * Single source of truth for all main page links AND their route components.
 *
 * Adding or removing a nav-linked page here automatically keeps:
 *   • the top Navigation bar
 *   • the Footer "Pages" list
 *   • the Wouter <Route> registrations in App.tsx
 * …all in sync. One file to edit when you add a new page.
 *
 * Fields:
 * - `href`           → Wouter route path
 * - `navLabelKey`    → used by Navigation.tsx (nav.* i18n keys)
 * - `footerLabelKey` → used by Footer.tsx (footer.links.* i18n keys)
 * - `Icon`           → used by Navigation.tsx only (footer doesn't need icons)
 * - `component`      → lazy-loaded page component for the router
 */

import { lazy } from "react";
import type { ComponentType, LazyExoticComponent } from "react";
import {
  Home,
  MapPin,
  Activity,
  BookOpen,
  HelpCircle,
  Mail,
  Video,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  SPIRECUT_NAV_ROUTE_HREFS,
  type SpirecutNavRouteHref,
} from "@workspace/spirecut-shared";

export interface PageLink {
  href: string;
  navLabelKey: string;
  footerLabelKey: string;
  Icon: LucideIcon;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: LazyExoticComponent<ComponentType<any>>;
}

const PAGE_DEFINITIONS: Record<SpirecutNavRouteHref, Omit<PageLink, "href">> = {
  "/": {
    navLabelKey: "nav.home",
    footerLabelKey: "footer.links.home",
    Icon: Home,
    component: lazy(() => import("@/pages/Home")),
  },
  "/arzt-finden": {
    navLabelKey: "nav.findDoctor",
    footerLabelKey: "footer.links.findDoctor",
    Icon: MapPin,
    component: lazy(() => import("@/pages/FindDoctor")),
  },
  "/karpaltunnelsyndrom": {
    navLabelKey: "nav.ct",
    footerLabelKey: "footer.links.ct",
    Icon: Activity,
    component: lazy(() => import("@/pages/Karpaltunnelsyndrom")),
  },
  "/schnappfinger": {
    navLabelKey: "nav.tf",
    footerLabelKey: "footer.links.tf",
    Icon: Activity,
    component: lazy(() => import("@/pages/Schnappfinger")),
  },
  "/praktische-informationen": {
    navLabelKey: "nav.praktischeInfo",
    footerLabelKey: "footer.links.praktischeInfo",
    Icon: BookOpen,
    component: lazy(() => import("@/pages/PraktischeInformationen")),
  },
  "/postoperative-entwicklung": {
    navLabelKey: "nav.postop",
    footerLabelKey: "footer.links.postop",
    Icon: Activity,
    component: lazy(() => import("@/pages/PostoperativeEntwicklung")),
  },
  "/patient-testimonials": {
    navLabelKey: "nav.testimonials",
    footerLabelKey: "footer.links.testimonials",
    Icon: Video,
    component: lazy(() => import("@/pages/PatientTestimonials")),
  },
  "/faq": {
    navLabelKey: "nav.faq",
    footerLabelKey: "footer.links.faq",
    Icon: HelpCircle,
    component: lazy(() => import("@/pages/FAQ")),
  },
  "/kontakt": {
    navLabelKey: "nav.kontakt",
    footerLabelKey: "footer.links.kontakt",
    Icon: Mail,
    component: lazy(() => import("@/pages/Kontakt")),
  },
};

export const PAGE_LINKS: PageLink[] = SPIRECUT_NAV_ROUTE_HREFS.map((href) => ({
  href,
  ...PAGE_DEFINITIONS[href],
}));
