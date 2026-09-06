# iROC GmbH Website

Bilingual (DE/EN) medical B2B website for iROC GmbH — distributor of Spirecut® and MiniStem® surgical instruments and trainer of medical doctors in orthopedic procedures.

## Run & Operate

- `pnpm --filter @workspace/iroc-website run dev` — run the frontend (port auto-assigned)
- `pnpm --filter @workspace/api-server run dev` — run the API server (port auto-assigned)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string (pre-configured)
- Optional env: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` — for email sending to info@i-roc.de
- Optional env: `SPIRECUT_PORTAL_PASSWORD`, `MINISTEM_PORTAL_PASSWORD` — doctor portal passwords (default: spirecut2024, ministem2024)
- Optional env: `ADMIN_PASSWORD` — admin panel password (default: iroc-admin-2024)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite, Tailwind CSS, Framer Motion, React Hook Form, Zod
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (zod/v4), drizzle-zod
- API codegen: Orval (from OpenAPI spec)
- Email: Nodemailer (SMTP)

## Where things live

- `artifacts/iroc-website/src/` — React frontend
  - `contexts/LanguageContext.tsx` — DE/EN language toggle
  - `contexts/AuthContext.tsx` — doctor portal auth
  - `pages/` — one file per route
  - `components/Layout.tsx` — header + footer
- `artifacts/api-server/src/routes/` — Express route handlers
  - `customers.ts` — new customer registration (POST /api/customers/register)
  - `orders.ts` — product orders (POST /api/orders)
  - `training.ts` — training dates + registration (GET/POST /api/training/*)
  - `auth.ts` — doctor portal login (POST /api/auth/login, GET /api/auth/me)
  - `doctors.ts` — trained doctors list (GET /api/doctors)
  - `resources.ts` — portal resources (GET /api/resources, requires auth)
  - `admin.ts` — admin CRUD (all /api/admin/* routes, Bearer token auth)
  - `lib/email.ts` — SMTP email sender
- `lib/api-spec/openapi.yaml` — OpenAPI contract (source of truth)
- `lib/db/src/schema/` — Drizzle schema: training_dates, trained_doctors, resources

## Architecture decisions

- All forms send emails to info@i-roc.de via nodemailer; if SMTP not configured, emails are logged only
- Doctor portal auth uses httpOnly cookies with base64-encoded JSON (lightweight, no JWT library)
- Admin auth uses Bearer token from Authorization header (ADMIN_PASSWORD env var)
- Training dates within 3 weeks of today are automatically disabled at both API and frontend level
- Language preference persists in localStorage; default is German (DE)

## Product

- **Home** (/) — hero, product cards, team, trust seals, contact
- **Spirecut® page** (/spirecut) — product details, instruments, benefits, CE/patent seals
- **MiniStem® page** (/ministem) — regenerative orthobiology, SVF therapy details
- **Training** (/training, /training/spirecut, /training/ministem) — dates + registration form
- **Order** (/order) — two-mode form: existing customer (quick) or new customer (full registration)
- **Trained Doctors** (/doctors) — public list filtered by instrument
- **Doctor Login** (/login) + **Portal** (/portal) — password-protected resource library
- **Admin** (/admin) — manage training dates, doctor list, portal resources
- **Impressum** (/impressum) + **AGB/AVB** (/agb) — legal pages

## User preferences

- Bilingual: German default, English switchable via DE/EN toggle in header
- iROC dark navy blue (#1C2B4B) brand color throughout
- No emojis anywhere in the UI
- Forms email to info@i-roc.de
- Training dates locked 3 weeks before the date

## Gotchas

- After any OpenAPI spec change, run codegen before touching routes or frontend
- DB schema changes: run `pnpm --filter @workspace/db run push` (dev only; prod handled by Replit publish flow)
- Admin password must be passed as `Authorization: Bearer <password>` header
- SMTP must be configured via env vars for emails to actually send in production
