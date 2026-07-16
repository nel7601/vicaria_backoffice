# Vicaria Health — Backoffice · Development Plan

> Derived from *Vicaria Backoffice — Especificación funcional y técnica v1.0* (2026-07-16).
> This plan maps the spec's phases (§17) into an actionable, trackable roadmap.

## 1. Product summary

A private practice-management backoffice for Vicaria Health covering the full
cycle from first contact → consultation → treatment → billing → receipt →
follow-up, across two service lines: **health coaching** (sessions/packages) and
**skin procedures** (billed per lesion). One unified patient record (Patient
360) with strict separation of clinical, financial, administrative and marketing
access via RBAC + PostgreSQL RLS.

## 2. Architecture (spec §9)

| Layer | Choice |
|-------|--------|
| Frontend / BFF | Next.js (App Router) + TypeScript strict |
| UI | Tailwind CSS v4 + local component library |
| Forms & validation | React Hook Form + Zod (shared client/server contracts) |
| Database | Supabase PostgreSQL (Canadian region) + RLS |
| Auth | Supabase Auth (email/password, MFA, claims) |
| Storage | Supabase Storage (private buckets, signed URLs) |
| ORM / migrations | Drizzle ORM + SQL migrations |
| Payments | Square (idempotent webhooks; ledger stays in-app) |
| Testing | Vitest (unit/domain) + Playwright (E2E, later) |
| Hosting | Vercel (region yul1) |

**Security principle (§4):** authorization is enforced at two layers — server
authorization and PostgreSQL RLS. Hiding a UI element is never a security
control. Money is stored in integer cents; timestamps in UTC, presented in
`America/Toronto`.

## 3. Phase roadmap

| Phase | Spec duration | Milestone | Exit condition |
|-------|---------------|-----------|----------------|
| **0. Discovery / Sprint 0** | 1–2 wk | — | Schema, ADRs, environments, auth skeleton, CI baseline |
| **1. Platform & Admin** | 2 wk | M1 Foundation | Auth/MFA, org/locations/employees, roles/RLS, settings, audit base |
| **2. Patients & Scheduling** | 2–3 wk | M2 (part) | Patients, consents, documents, Patient 360, calendar, appointments |
| **3. Consultations & Treatments** | 3 wk | M2 Clinical Core | Templates, encounters, signing, amendments, plans, skin procedures, packages |
| **4. Billing & Square** | 3 wk | M3 Revenue Cycle | Invoices, payments, receipts, cash/e-transfer, Square, reconciliation |
| **5. Reporting & Marketing** | 2 wk | M4 Reporting | Dashboards + prioritized reports + audited exports |
| **6. Hardening & Launch** | 2 wk | M5 Production Ready | Security, performance, migration, UAT, training, go-live |

Reference estimate (§17): ~10–14 weeks to MVP for two full-stack devs after
discovery.

## 4. Sprint 0 status (this repository)

Delivered in the initial scaffold:

- [x] **S0-01** Repo, TypeScript strict, ESLint, formatting, npm scripts.
- [x] **S0-04** ADRs 001–004 (stack, tenancy, authorization, documents) — see `docs/adr/`.
- [x] **S0-05** Initial schema + migrations for the full data model (§8), including
      organizations/users/roles/audit. Migrations in `supabase/migrations/`.
- [x] **S0-06** Auth skeleton (Supabase email/password, session middleware, RBAC
      matrix, role-gated navigation). MFA enforcement wiring is Phase 1.
- [x] **S0-07** Design tokens, app shell layout and primary navigation (§7 views).
- [x] **S0-08** Testing baseline (Vitest) with domain + RBAC tests (§15.1 cases).
- [x] **S0-10** Synthetic seed script (`npm run seed`).
- [ ] **S0-02 / S0-03** Provision Supabase (dev/staging/prod) and Vercel projects — infra task for DevOps.
- [ ] **S0-09** Formalize PHI log-redaction policy (see ADR + Phase 1 observability).

## 5. Requirement traceability

Every requirement in spec §6 keeps its `FR-*` / `NFR-*` ID. Placeholder module
views (`/patients`, `/calendar`, `/encounters`, `/billing`, `/reports`,
`/settings`) list the exact FR IDs each phase must satisfy, so the roadmap is
legible from the running app. Domain logic that is already implemented and
tested:

- `src/lib/domain/invoice.ts` — totals, status derivation, allocation guards (FR-INV-*, FR-PAY-002, FR-REC-001).
- `src/lib/domain/package-ledger.ts` — session ledger invariants (FR-PKG-002/003).
- `src/lib/auth/rbac.ts` — permission matrix (§4.2), verified by `tests/auth/rbac.test.ts`.

## 6. Global MVP acceptance (§19)

Tracked as the release checklist: AC-01..AC-10. CI must keep RLS/authorization
tests green (AC-08) before any clinical/financial module is considered done.

## 7. Open decisions blocking scope (spec §20)

D-01..D-10 must be resolved with Owner/legal/accounting before building the
clinical and financial modules (D-01 PHIPA/PIPEDA scope, D-02 taxable services,
D-03 invoice-of-record, D-06 insurance receipts, D-07 signature method). See
`docs/adr/README.md` for how decisions feed ADRs.
