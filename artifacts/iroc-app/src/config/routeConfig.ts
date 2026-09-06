import { lazy } from 'react';

/**
 * The route registry is deliberately made up of lazy components. Keeping the
 * registry separate from App.tsx lets the loading contract be tested without
 * importing the whole admin application and its page dependencies.
 */
export const APP_ROUTES = [
  { path: '/login', protected: false, component: lazy(() => import('@/pages/Login')) },
  { path: '/', protected: true, component: lazy(() => import('@/pages/Dashboard')) },
  { path: '/customers', protected: true, component: lazy(() => import('@/pages/CustomersList')) },
  { path: '/customers/:id', protected: true, component: lazy(() => import('@/pages/CustomerDetail')) },
  { path: '/products', protected: true, component: lazy(() => import('@/pages/ProductsList')) },
  { path: '/products/:id', protected: true, component: lazy(() => import('@/pages/ProductDetail')) },
  { path: '/inventory', protected: true, component: lazy(() => import('@/pages/Inventory')) },
  { path: '/invoices', protected: true, component: lazy(() => import('@/pages/InvoicesList')) },
  { path: '/invoices/new', protected: true, component: lazy(() => import('@/pages/InvoiceNew')) },
  { path: '/invoices/:id/edit', protected: true, component: lazy(() => import('@/pages/InvoiceEdit')) },
  { path: '/invoices/:id', protected: true, component: lazy(() => import('@/pages/InvoiceDetail')) },
  { path: '/notifications', protected: true, component: lazy(() => import('@/pages/Notifications')) },
  { path: '/spirecut-quotes', protected: true, component: lazy(() => import('@/pages/SpirecutQuotes')) },

  // iROC Website admin
  { path: '/iroc-website/training', protected: true, component: lazy(() => import('@/pages/IrocWebsiteTraining')) },
  { path: '/iroc-website/registrations', protected: true, component: lazy(() => import('@/pages/IrocWebsiteRegistrations')) },
  { path: '/iroc-website/doctors', protected: true, component: lazy(() => import('@/pages/IrocWebsiteDoctors')) },
  { path: '/iroc-website/resources', protected: true, component: lazy(() => import('@/pages/IrocWebsiteResources')) },
  { path: '/iroc-website/team', protected: true, component: lazy(() => import('@/pages/IrocWebsiteTeam')) },
  { path: '/iroc-website/events', protected: true, component: lazy(() => import('@/pages/IrocWebsiteEvents')) },
  { path: '/iroc-website/email', protected: true, component: lazy(() => import('@/pages/IrocWebsiteEmail')) },
  { path: '/iroc-website/customers', protected: true, component: lazy(() => import('@/pages/IrocWebsiteCustomers')) },
  { path: '/iroc-website/orders', protected: true, component: lazy(() => import('@/pages/IrocWebsiteOrders')) },
  { path: '/iroc-website/settings', protected: true, component: lazy(() => import('@/pages/IrocWebsiteSettings')) },
  { path: '/iroc-website/browser-app', protected: true, component: lazy(() => import('@/pages/IrocBrowserApp')) },
  { path: '/iroc-website/portal-passwords', protected: true, component: lazy(() => import('@/pages/IrocWebsitePortalPasswords')) },

  // Spirecut Website admin
  { path: '/spirecut/media', protected: true, component: lazy(() => import('@/pages/SpirecutMedia')) },
  { path: '/spirecut/social', protected: true, component: lazy(() => import('@/pages/SpirecutSocial')) },
  { path: '/spirecut/postop', protected: true, component: lazy(() => import('@/pages/SpirecutPostop')) },
  { path: '/spirecut/settings', protected: true, component: lazy(() => import('@/pages/SpirecutSettings')) },
  { path: '/spirecut/content', protected: true, component: lazy(() => import('@/pages/SpirecutContent')) },
  { path: '/spirecut/testimonials', protected: true, component: lazy(() => import('@/pages/SpirecutTestimonials')) },
  { path: '/spirecut/browser-app', protected: true, component: lazy(() => import('@/pages/SpirecutBrowserApp')) },

  // Content editors
  { path: '/iroc-website/content', protected: true, component: lazy(() => import('@/pages/IrocWebsiteContent')) },

  // Portal management (Apps → iROC Doctor Portal)
  { path: '/portal/design', protected: true, component: lazy(() => import('@/pages/PortalDesign')) },
  { path: '/portal/content', protected: true, component: lazy(() => import('@/pages/PortalContent')) },
  { path: '/portal/nav-config', protected: true, component: lazy(() => import('@/pages/PortalNavConfig')) },

  { path: '/announcements', protected: true, component: lazy(() => import('@/pages/Announcements')) },
  { path: '/sales-summary', protected: true, component: lazy(() => import('@/pages/SalesSummary')) },
  { path: '/reports', protected: true, component: lazy(() => import('@/pages/Reports')) },
  { path: '/datev-export', protected: true, component: lazy(() => import('@/pages/DatevExport')) },
  { path: '/leads', protected: true, component: lazy(() => import('@/pages/Leads')) },
  { path: '/upcoming-events', protected: true, component: lazy(() => import('@/pages/UpcomingEvents')) },
  { path: '/web-design-agent', protected: true, component: lazy(() => import('@/pages/WebDesignAgent')) },
  { path: '/tori', protected: true, component: lazy(() => import('@/pages/Tori')) },
  { path: '/expenses', protected: true, component: lazy(() => import('@/pages/Expenses')) },
  { path: '/sally/email-queue', protected: true, component: lazy(() => import('@/pages/SallyEmailQueue')) },
  { path: '/sally/:tab', protected: true, component: lazy(() => import('@/pages/Sally')) },
  { path: '/sally', protected: true, component: lazy(() => import('@/pages/Sally')) },
  { path: '/spiro', protected: true, component: lazy(() => import('@/pages/SpiroSettings')) },
  { path: '/configuration', protected: true, component: lazy(() => import('@/pages/Configuration')) },
  { path: '/email-config', protected: true, component: lazy(() => import('@/pages/EmailConfig')) },
  { path: '/email-help', protected: true, component: lazy(() => import('@/pages/EmailHelp')) },
] as const;