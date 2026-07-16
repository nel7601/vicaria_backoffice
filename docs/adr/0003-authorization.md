# ADR-003 — Authorization (RBAC + RLS)

**Status:** Accepted (from spec §4, §12).

## Context

Seven roles (Owner, Administrator, Practitioner, Reception, Billing, Marketing,
Auditor) need least-privilege access across clinical, financial, administrative
and marketing resources. Clinical data must never leak to Marketing; auditors
are read-only; access must be provable (§15.1).

## Decision

Authorization is enforced at **two independent layers**:

1. **Server authorization** — `src/lib/auth/rbac.ts` encodes the §4.2 matrix as
   the single source of truth (`can()`, `readScopeFor()`, `accessFor()`).
   Route Handlers and Server Actions check it before any mutation/read.
2. **PostgreSQL RLS** — policies mirror the same matrix. RLS is enabled (and
   `FORCE`d) on all business tables in `0001_indexes_rls.sql`; fine-grained
   per-role/scope policies are added as auth claims are finalized.

Roles are carried in the Supabase JWT (`app_metadata.roles`) for the MVP; a
DB-backed `user_roles` lookup with location scopes supersedes the claim as the
authoritative source. Read scopes (`assigned`, `own`, `limited`, `aggregate`,
`audited`) narrow rows/fields beyond a boolean allow.

## Consequences

- UI gating (hiding nav items) is cosmetic only; every request is checked
  server-side and again by RLS.
- The role matrix is unit-tested (`tests/auth/rbac.test.ts`) and must stay green
  in CI (AC-08). RLS policies get their own database tests.
- Sensitive reads (clinical notes by Auditor) are logged to `access_logs`.
