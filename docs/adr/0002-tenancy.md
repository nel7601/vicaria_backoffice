# ADR-002 — Multi-tenant isolation strategy

**Status:** Accepted (from spec §9.3).

## Context

The MVP serves a single organization, but the spec requires preparing logical
isolation to avoid a future redesign, and to keep RLS policies uniform.

## Decision

- Every business table carries `organization_id` and references
  `organizations.id`.
- RLS policies scope rows by `organization_id` (and, where relevant, by
  `location_id` and assignment).
- We do **not** build commercial multi-tenant features (billing per tenant,
  tenant onboarding) in the MVP — only the logical boundary.

## Consequences

- A single `organizations` row exists in production for Vicaria.
- Cross-organization access is impossible by construction once policies are in
  place; server code that uses the service role must still filter by
  `organization_id` explicitly.
- Location-scoped roles (`user_roles.location_id`) let a user be limited to one
  branch without schema changes.
