# ADR-004 — Private documents & storage

**Status:** Accepted (from spec §6.8, §12, SEC-04).

## Context

Consents, lab results, plans, before/after photos and receipts are sensitive.
Storage paths must never be public, and photos require consent (FR-SKIN-003).

## Decision

- All files live in **private Supabase Storage buckets**. No public bucket ever
  holds PHI.
- `documents` stores only metadata (name, MIME, size, SHA-256, category,
  patient, uploader, access level) plus the private `storage_path`.
- Files are served exclusively through **short-lived signed URLs** generated
  server-side after an authorization check.
- Photos and other consent-gated documents set `requires_consent = true`; the
  server refuses to issue a signed URL without a valid, current consent.
- Exact-duplicate detection uses the SHA-256 hash where appropriate
  (FR-DOC-002).

## Consequences

- A leaked/expired signed URL grants no lasting access (tested per §15.1).
- Every upload/view/download/delete-request is written to `audit_events`
  (SEC-05).
- Storage backups are separate from the database backup (§12.4).
