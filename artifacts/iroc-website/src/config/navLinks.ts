/**
 * Single source of truth for iROC website pages.
 *
 * To add a new page:
 *  1. Add an entry here (href, labels, group, component).
 *  2. Create the page component in src/pages/.
 *  That's it — routing and navigation update automatically.
 *
 * group values:
 *  "flat"    — shown as a top-level nav link
 *  "product" — shown in the Products dropdown (supports subDE/subEN subtitle)
 *  "service" — shown in the Services dropdown (requires icon)
 *  "hidden"  — routed but not shown in nav (login, portal, admin, legal, sub-pages)
 */

import { lazy, ComponentType } from 'react';
import { GraduationCap, Megaphone } from 'lucide-react';

export type NavGroup = 'flat' | 'product' | 'service' | 'hidden';

interface BasePageLink {
  href: string;
  /** Label shown in the nav bar / footer (German) */
  labelDE: string;
  /** Label shown in the nav bar / footer (English) */
  labelEN: string;
  /** Whether this link appears in the footer */
  inFooter?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: ComponentType<any>;
  /** Subtitle shown below the label in product/service dropdown (optional) */
  subDE?: string;
  subEN?: string;
}

/** A service-group entry — icon is required so the nav never renders a broken icon slot. */
export interface ServicePageLink extends BasePageLink {
  group: 'service';
  /** Icon component shown in the Services dropdown (required for service entries). */
  icon: ComponentType<{ className?: string }>;
}

/** Any non-service page link — icon is not applicable. */
export interface OtherPageLink extends BasePageLink {
  group: Exclude<NavGroup, 'service'>;
  /** Icon is not used for non-service entries. */
  icon?: never;
}

/** Discriminated union: TypeScript enforces that service entries carry a required icon. */
export type PageLink = ServicePageLink | OtherPageLink;

export const PAGE_LINKS: PageLink[] = [
  // ── Flat nav links (left side of nav bar) ─────────────────────────────
  {
    href: '/',
    labelDE: 'Startseite',
    labelEN: 'Home',
    inFooter: true,
    group: 'flat',
    component: lazy(() => import('@/pages/Home')),
  },
  {
    href: '/training',
    labelDE: 'Schulung',
    labelEN: 'Training',
    inFooter: true,
    group: 'flat',
    component: lazy(() => import('@/pages/TrainingOverview')),
  },
  {
    href: '/events',
    labelDE: 'Events',
    labelEN: 'Events',
    inFooter: true,
    group: 'flat',
    component: lazy(() => import('@/pages/Events')),
  },
  {
    href: '/doctors',
    labelDE: 'Zertifizierte Ärzte',
    labelEN: 'Trained Doctors',
    inFooter: true,
    group: 'flat',
    component: lazy(() => import('@/pages/Doctors')),
  },
  {
    href: '/order',
    labelDE: 'Bestellen',
    labelEN: 'Order',
    inFooter: true,
    group: 'flat',
    component: lazy(() => import('@/pages/Order')),
  },
  {
    href: '/contact',
    labelDE: 'Kontakt',
    labelEN: 'Contact',
    inFooter: true,
    group: 'flat',
    component: lazy(() => import('@/pages/Contact')),
  },

  // ── Products dropdown ──────────────────────────────────────────────────
  {
    href: '/spirecut',
    labelDE: 'Spirecut®',
    labelEN: 'Spirecut®',
    inFooter: true,
    group: 'product',
    subDE: 'Handchirurgie-Instrument',
    subEN: 'Hand Surgery Instrument',
    component: lazy(() => import('@/pages/Spirecut')),
  },
  {
    href: '/ministem',
    labelDE: 'MiniStem®',
    labelEN: 'MiniStem®',
    inFooter: true,
    group: 'product',
    subDE: 'Stammzelltherapie',
    subEN: 'Stem Cell Therapy',
    component: lazy(() => import('@/pages/MiniStem')),
  },

  // ── Services dropdown ──────────────────────────────────────────────────
  {
    href: '/order?service=support',
    labelDE: 'Post-Training Support',
    labelEN: 'Post-Training Support',
    subDE: 'Begleitung nach der Schulung',
    subEN: 'Guidance after training',
    group: 'service',
    icon: GraduationCap,
    component: lazy(() => import('@/pages/Order')),
  },
  {
    href: '/order?service=marketing',
    labelDE: 'Praxis-Marketing',
    labelEN: 'Practice Marketing',
    subDE: 'Individuelle Werbematerialien',
    subEN: 'Customised promotional materials',
    group: 'service',
    icon: Megaphone,
    component: lazy(() => import('@/pages/Order')),
  },

  // ── Hidden: routed but not shown in nav ───────────────────────────────
  {
    href: '/training/spirecut',
    labelDE: 'Spirecut Schulung',
    labelEN: 'Spirecut Training',
    group: 'hidden',
    component: lazy(() => import('@/pages/SpirecutTraining')),
  },
  {
    href: '/training/ministem',
    labelDE: 'MiniStem Schulung',
    labelEN: 'MiniStem Training',
    group: 'hidden',
    component: lazy(() => import('@/pages/MiniStemTraining')),
  },
  {
    href: '/login',
    labelDE: 'Login',
    labelEN: 'Login',
    group: 'hidden',
    component: lazy(() => import('@/pages/Login')),
  },
  {
    href: '/portal',
    labelDE: 'Portal',
    labelEN: 'Portal',
    group: 'hidden',
    component: lazy(() => import('@/pages/Portal')),
  },
  {
    href: '/admin',
    labelDE: 'Admin',
    labelEN: 'Admin',
    group: 'hidden',
    component: lazy(() => import('@/pages/Admin')),
  },
  {
    href: '/impressum',
    labelDE: 'Impressum',
    labelEN: 'Impressum',
    inFooter: true,
    group: 'hidden',
    component: lazy(() => import('@/pages/Impressum')),
  },
  {
    href: '/agb',
    labelDE: 'AGB',
    labelEN: 'Terms',
    inFooter: true,
    group: 'hidden',
    component: lazy(() => import('@/pages/Agb')),
  },
];

/** Convenience views for Navigation.tsx */
export const flatLinks    = PAGE_LINKS.filter((l) => l.group === 'flat');
export const productLinks = PAGE_LINKS.filter((l) => l.group === 'product');
/** Type-narrowed to ServicePageLink[] so icon is guaranteed non-optional in the nav. */
export const serviceLinks = PAGE_LINKS.filter((l): l is ServicePageLink => l.group === 'service');
export const footerLinks  = PAGE_LINKS.filter((l) => l.inFooter);
