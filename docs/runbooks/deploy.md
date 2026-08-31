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

## Email links (invitations, password reset)

Supabase builds these links, not the app, and it will only redirect to a URL
that appears in the project's allow-list. Anything else is silently replaced by
the project's **Site URL** — which ships as `http://localhost:3000`, so a
production invitation arrives pointing at the employee's own machine and dies
with "Firefox can't connect to the server at localhost:3000".

Set both, per environment:

1. **Supabase → Authentication → URL Configuration**
   - *Site URL*: the deployment's own origin, e.g. `https://<app>.vercel.app`.
   - *Redirect URLs*: add `https://<app>.vercel.app/**` (and the staging and
     `http://localhost:3000/**` entries for local work).
2. **Vercel → Environment Variables**
   - `NEXT_PUBLIC_SITE_URL=https://<app>.vercel.app` — the origin the app
     builds invitation links from. Without it the app falls back to the
     deployment domain and then to the request's own host, which is right
     locally and wrong for a preview deployment sending real email.

Invitations land on `/auth/confirm?next=/reset-password`, which redeems the
token, establishes the session and forwards to the password form. A link that
was already opened, or that is older than the project's expiry, cannot be
redeemed twice — re-invite from Settings → Employees rather than resending the
old email.

## Rolling back
- App: redeploy the previous Vercel build.
- DB: forward-fix with a new migration. Never edit an applied migration; issued
  invoices, signed notes and audit rows are immutable.

## Notes
- `npm run db:generate` creates a new Drizzle migration from schema changes;
  review the SQL before committing.
- Never point Preview/Staging at the production database.
