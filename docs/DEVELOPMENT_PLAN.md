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

| Phase | Spec duration | Milestone | Exit condition | Status |
|-------|---------------|-----------|----------------|--------|
| **0. Discovery / Sprint 0** | 1–2 wk | — | Schema, ADRs, environments, auth skeleton, CI baseline | ✅ done |
| **1. Platform & Admin** | 2 wk | M1 Foundation | Auth/MFA, org/locations/employees, roles/RLS, settings, audit base | ✅ done |
| **2. Patients & Scheduling** | 2–3 wk | M2 (part) | Patients, consents, Patient 360, calendar, appointments | ✅ done |
| **3. Consultations & Treatments** | 3 wk | M2 Clinical Core | Templates, encounters, signing, amendments, plans, skin pricing | ✅ done |
| **4. Billing & Square** | 3 wk | M3 Revenue Cycle | Invoices, payments, receipts, e-transfer, Square, refunds | ✅ done |
| **5. Reporting & Marketing** | 2 wk | M4 Reporting | Prioritized reports + audited CSV exports + privacy rules | ✅ done |
| **6. Hardening & Launch** | 2 wk | M5 Production Ready | Security headers/rate-limit, PHI-safe logging, CI, E2E/RLS scaffolds, runbooks | 🟡 code done; infra/UAT pending |

### Phase 6 — what is code-complete vs. pending infra

Code-complete in this repo: security headers + rate limiting (SEC-03/07),
PHI-safe structured logging (SEC-06), GitHub Actions CI (typecheck/lint/test/
build), Playwright E2E scaffold for the §15.1 critical flows, an RLS/pgTAP test
scaffold, and runbooks (deploy, incident & restore, go-live checklist).

Pending (needs credentials / DevOps — S0-02/S0-03, §16, §20): provision Supabase
(dev/staging/prod, Canada) and Vercel (yul1), configure backups + restore test,
authenticate the email domain, run the migration/cutover, execute UAT, and
resolve decisions D-01..D-10.

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

## 8. Alignment with the improved functional spec (v1.0, Aug 2026)

`docs/ESPECIFICACION_FUNCIONAL_MEJORADA.md` supersedes the original brief as
the product reference. Status of its deltas:

**Implemented**
- §3 Service catalog: `family` (clinic / coaching / home_care) and
  `billing_unit` (fixed / per_unit / per_hour / per_session) on services,
  editable in Settings, plus controlled categories and versioned prices.
- §7.1/§8 Encounter lines: services actually performed with quantities;
  invoices are generated from the signed encounter's lines
  (`generateInvoiceFromEncounterAction`), not from the booking.
- §10 Caregiver: care agreements (plan + default visit tasks), shifts with
  task checklist (done / not done / n/a + comment), incident reports with
  severity, clock-in/out with server timestamps, `needs_review` when actual
  time deviates > 15 min from schedule, `missed` state, admin hour approval
  (approved minutes ≠ scheduled), and one-click weekly invoice from approved
  hours (`generateCareInvoiceAction`).
- §13 Navigation: grouped sidebar (Vicaria Health / Vicaria Care / Shared);
  month calendars for both service lines; Patients service-line column and
  filters.

**Next (not yet built)**
- §9 Coaching packages UI: purchase, session balance, consumption on
  completed session (schema `packages`/`package_enrollments` already exists).
- §6 Form frequency rules (once / per visit / expiry) and blocking forms.
- §12 Reminders/communication log; §13 role-specific dashboards ("what do I
  have to do today"), caregiver mobile-first Today view.
- §14 Reports: caregiver hours/exceptions, package balances, certification
  expiry (needs team certifications, §4.1).
- §10.4 Rounding rules and payroll export of approved hours.
