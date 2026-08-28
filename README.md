# Vicaria Health — Backoffice

Private practice-management backoffice for Vicaria Health: unified patient
record (Patient 360), scheduling, clinical encounters, skin procedures,
packages, and a full revenue cycle (invoices → payments → receipts →
reconciliation), with role-based access, RLS and audit.

Built from *Vicaria Backoffice — Especificación funcional y técnica v1.0*.
See [`docs/DEVELOPMENT_PLAN.md`](docs/DEVELOPMENT_PLAN.md) for the roadmap and
[`docs/adr/`](docs/adr) for architecture decisions.

## Stack

Next.js (App Router) · TypeScript strict · Tailwind v4 · Supabase
(PostgreSQL/Auth/Storage/RLS) · Drizzle ORM · Zod · Vitest. Deploys to Vercel.
Payments via Square (idempotent webhooks). CAD, `America/Toronto`.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in Supabase + integration values
npm run dev                  # http://localhost:3000
```

Without Supabase configured you can still run the build, typecheck and tests;
the app requires a configured Supabase project to sign in.

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Local dev server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest (domain + RBAC) |
| `npm run db:generate` | Generate a Drizzle migration from the schema |
| `npm run db:migrate` | Apply migrations |
| `npm run db:push` | Push schema to the database (dev only) |
| `npm run seed` | Load synthetic data (never PHI) |

### Migrations

Drizzle tracks what has been applied in `drizzle.__drizzle_migrations`, and
decides what to run by comparing the last recorded timestamp against the `when`
of each entry in `supabase/migrations/meta/_journal.json`. Every `.sql` file in
that folder must have a journal entry, in order, or it will never run.

Two kinds of migration live side by side:

- **Generated**: change `src/lib/db/schema/`, run `npm run db:generate`. It
  diffs the schema against the newest snapshot in `meta/` and writes only the
  delta, plus a new snapshot.
- **Hand-written**: extensions, indexes, RLS policies and anything else Drizzle
  does not model. Write the `.sql` file, then add its entry to `_journal.json`
  with a `when` greater than the previous one. Without that entry the file is
  invisible to `db:migrate`.

Snapshots chain through `prevId`, so a hand-added snapshot must point at the id
of the one before it.

For a large table, build indexes with `CREATE INDEX CONCURRENTLY` — a plain
`CREATE INDEX` locks writes while it runs.

## Project layout

```
src/
  app/
    (app)/            # authenticated shell: dashboard, patients, calendar,
                      # encounters, billing, reports, settings (§7 views)
    login/            # email/password sign-in
    auth/signout/     # sign-out route handler
  components/         # UI library + app shell
  lib/
    auth/             # RBAC matrix (§4.2) + session
    db/schema/        # full Drizzle schema (§8)
    domain/           # money, invoice status, package ledger (tested)
    schemas/          # Zod DTO contracts
    supabase/         # browser/server/proxy clients
  proxy.ts            # session refresh + route gating (Next 16 "proxy")
supabase/
  migrations/         # generated SQL + indexes/RLS
  seed/               # synthetic seed
docs/                 # development plan + ADRs
tests/                # Vitest domain & RBAC suites
```

## Security notes

- Authorization is enforced at **two layers**: server (`lib/auth/rbac.ts`) and
  PostgreSQL RLS. UI gating is cosmetic only.
- Anon key is client-safe because RLS is enabled on every business table; the
  service-role key is server-only.
- Money is integer cents; issued invoices, confirmed payments, signed notes and
  audit events are immutable (corrected via void/refund/credit-note/amendment).
- No PHI in logs, URLs or analytics (SEC-06).
