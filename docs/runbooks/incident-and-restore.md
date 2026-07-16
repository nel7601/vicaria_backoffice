# Runbook — Incident response & restore

## Security incident (spec §12, SEC-12)
1. **Contain**: disable the affected user(s) in Settings → Employees (revokes
   sessions), rotate exposed secrets (Supabase keys, Square tokens, email key).
2. **Assess**: query `audit_events` and `access_logs` for the actor/time window
   to scope what was accessed or changed (PHI access is logged, §12.2).
3. **Record** in the breach register: what, when, who, data categories, actions.
4. **Notify** per legal guidance (PIPEDA/PHIPA — see decision D-01).
5. **Remediate & review**: fix root cause, add a regression test, post-mortem.

## Suspected unauthorized access
- Pull `access_logs` filtered by `patient_id` or `actor_user_id`.
- Confirm RLS policies and role assignments in `user_roles` are correct.
- If a role was mis-assigned, correct it and audit the `permission_change`.

## Database restore (spec §12.4, SEC-08)
1. Identify the recovery point (RPO target 24h; RTO target 8h for MVP).
2. Restore the PostgreSQL backup into an **isolated** environment first.
3. Restore Storage objects separately — the DB backup does not include files.
4. Validate: row counts, latest invoices/payments reconcile, signed-note hashes
   intact.
5. Cut over only after validation; keep the original copies until confirmed.

## Restore test (quarterly, first year)
- Perform the full restore into a scratch project, run the validation queries,
  record evidence, and tear the scratch project down.
