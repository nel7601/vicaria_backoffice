# Runbook — Deploy & migrations

## Environments (spec §9.2)
- **Preview** — every PR on Vercel; points at a testing database.
- **Staging** — QA/UAT; anonymized or synthetic data.
- **Production** — real PHI; restricted, audited access.

## Deploy flow
1. Merge to the default branch → Vercel builds and deploys.
2. Apply DB migrations **before** the app depends on them:
   ```bash
   # migrations live in supabase/migrations, applied in lexical order
   supabase db push            # or: supabase migration up
   ```
   Order: `0000_init_schema` → `0001_indexes_rls` → `0002_rls_policies` →
   `0003_receipts_payment_nullable`.
3. Verify health: sign in, load Patient 360, issue a test invoice in staging.

## Rolling back
- App: redeploy the previous Vercel build.
- DB: forward-fix with a new migration. Never edit an applied migration; issued
  invoices, signed notes and audit rows are immutable.

## Notes
- `npm run db:generate` creates a new Drizzle migration from schema changes;
  review the SQL before committing.
- Never point Preview/Staging at the production database.
