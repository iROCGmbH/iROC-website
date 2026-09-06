/**
 * Shared React Query key constants.
 *
 * Keep these here so every consumer (page component, ProtectedRoute,
 * mutation callbacks, …) always references the exact same value.
 * Never inline the string directly — a string mismatch makes
 * invalidateQueries() a silent no-op.
 */

/** Query key for the Leads list (`GET /api/iroc/leads`). */
export const LEADS_QUERY_KEY = ['leads'] as const;

/** Base query key for dashboard metrics (year-specific queries append a year). */
export const IROC_DASHBOARD_QUERY_KEY = ['iroc-dashboard'] as const;

/** Query key for the sales summary used by Reports and Sales Summary. */
export const IROC_SALES_SUMMARY_QUERY_KEY = ['iroc-sales-summary'] as const;

/** Query key for registrations from the iROC website. */
export const IROC_REGISTRATIONS_QUERY_KEY = ['iroc-registrations'] as const;

/** Query key for the configured iROC doctor portal credentials. */
export const IROC_PORTAL_PASSWORDS_QUERY_KEY = ['admin-portal-passwords'] as const;

// ── Sally CRM query keys ───────────────────────────────────────────────────────
export const SALLY_LEADS_KEY       = ['sally-leads']       as const;
export const SALLY_DOCTORS_KEY     = ['sally-doctors']     as const;
export const SALLY_EMAIL_QUEUE_KEY = ['sally-email-queue'] as const;
export const SALLY_RECONCILIATION_ACTORS_KEY = ['sally-reconciliation-actors'] as const;
export const SALLY_RECONCILIATION_HISTORY_KEY = ['sally-reconciliation-history'] as const;
export const SALLY_IMPORT_LEADS_KEY   = ['sally-import-leads']   as const;
export const SALLY_IMPORT_DOCTORS_KEY = ['sally-import-doctors'] as const;

// ── Expenses query key ─────────────────────────────────────────────────────────
export const EXPENSES_KEY               = ['expenses']                as const;
export const ORPHAN_SWEEP_STATS_KEY     = ['orphan-sweep-stats']     as const;
export const ORPHAN_SPIKE_SETTINGS_KEY  = ['orphan-spike-settings']  as const;
