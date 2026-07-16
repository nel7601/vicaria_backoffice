# ADR-001 — Technology stack

**Status:** Accepted (from spec §9.1).

## Context

Vicaria needs a private, auditable, bilingual (EN/ES) backoffice handling
sensitive health information under Canadian data-residency expectations
(PIPEDA/PHIPA — see D-01). The team is small; time-to-MVP matters.

## Decision

- **Next.js + TypeScript (strict)** on Vercel for SSR, routing and a
  server/BFF layer via Route Handlers and Server Actions.
- **Supabase (Canadian region)** for PostgreSQL, Auth, Storage and Row Level
  Security.
- **Drizzle ORM with explicit SQL migrations.** Security must not depend on the
  ORM (§9.1); migrations are reviewed and RLS lives in SQL. Prisma was
  considered but its RLS/transaction/view ergonomics were judged riskier.
- **Tailwind CSS v4** with a small in-repo component library (accessible,
  WCAG AA).
- **React Hook Form + Zod** for shared client/server validation contracts.
- **Vitest + Playwright** for unit/domain and E2E testing.

## Consequences

- Anon key is safe on the client *only because* every table has RLS enabled;
  the service-role key is server-only.
- All monetary values are integer cents; timestamps are UTC.
- ORM choice keeps us close to PostgreSQL features (RLS, partial unique indexes,
  exclusion constraints) used throughout the schema.
