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

## Domain (admin.vicaria.ca)

Production is served at **https://admin.vicaria.ca**; `vicaria.ca` itself is the
public site and is not touched by this project.

DNS lives in Cloudflare:

| Type | Name | Target | Proxy |
|---|---|---|---|
| CNAME | `admin` | the value Vercel shows under Settings → Domains | **DNS only** |

The proxy setting is the part that bites. With Cloudflare's orange cloud on,
Vercel cannot answer the domain-validation challenge, so the certificate is
never issued, and a "Flexible" SSL mode in Cloudflare turns the same record
into an infinite redirect loop. Vercel already terminates TLS and fronts a CDN;
proxying it again buys nothing and hides the visitor's IP. Keep it grey.

When Vercel reports *Valid Configuration* it issues the certificate itself.

## Email links (invitations, password reset)

Supabase builds these links, not the app, and it will only redirect to a URL
that appears in the project's allow-list. Anything else is silently replaced by
the project's **Site URL** — which ships as `http://localhost:3000`, so a
production invitation arrives pointing at the employee's own machine and dies
with "Firefox can't connect to the server at localhost:3000".

Set both, per environment:

1. **Supabase → Authentication → URL Configuration**
   - *Site URL*: `https://admin.vicaria.ca`.
   - *Redirect URLs*: `https://admin.vicaria.ca/**`, plus
     `http://localhost:3000/**` for local work and the staging origin.
2. **Vercel → Environment Variables**
   - `NEXT_PUBLIC_SITE_URL=https://admin.vicaria.ca` — the origin the app builds
     invitation links from. Without it the app falls back to the deployment
     domain and then to the request's own host, which is right locally and
     wrong for a preview deployment sending real email. It is read at build
     time, so changing it needs a redeploy, not just a save.

Invitations land on `/auth/confirm?next=/reset-password`, which redeems the
token, establishes the session and forwards to the password form. A link that
was already opened, or that is older than the project's expiry, cannot be
redeemed twice — re-invite from Settings → Employees rather than resending the
old email.

## Personal calendar feeds

Practitioners and caregivers subscribe to `/api/calendar/<token>.ics`, issued
from Settings → Calendar sync. One link per person carries whichever kinds of
work apply to them — clinic appointments, home-care shifts, or both. Notes for
whoever operates this:

- **The URL is the credential.** A calendar client cannot sign in, so the token
  authorises the request on its own. Issuing a new link revokes the old one;
  revoked tokens are kept, not deleted, so a leaked link stays dead and
  traceable. `last fetched` on the card shows whether anyone actually uses it.
- **`calendar_feed_detail`** (same card) decides how much an event may say:
  service only, service and initials (default), or the patient's full name.
  These events are stored by Google/Apple/Zoho outside the clinic, so raising
  it is audited like a permission change. Every level links back to the
  appointment here for the rest.
- **Refresh is the subscriber's decision, not ours.** The feed asks for 15
  minutes; Apple honours something close to it, Google can take hours. Do not
  promise same-day accuracy on a Google calendar.
- Changing the public origin changes every issued link, since the URL embeds
  it. Re-issue them after a domain move.

## Anything else keyed to the public origin

Changing the domain means revisiting these too:

- **Square** webhook endpoint → `https://admin.vicaria.ca/api/webhooks/square`
  (see `square-setup.md`).
- **Assistant / MCP clients** point at `https://admin.vicaria.ca/api/assistant/v1`
  and `/api/mcp`.

## Database connections

`DATABASE_URL` must be Supabase's **transaction pooler** string (port `6543`,
host `…pooler.supabase.com`), not the direct connection on `5432`. Vercel runs
many short-lived function instances; each one opening its own direct connection
exhausts the project's limit, and the symptom is an intermittent "database not
reachable" that a refresh clears.

The client is configured to match (`src/lib/db/index.ts`): prepared statements
off, because the pooler gives each transaction a different backend; a small
`max` per instance, since the ceiling is the project total; and idle
connections closed before the pooler would close them, so a warm function never
inherits a socket that died while it was frozen. Reads in the calendar views
retry once on a connection-level failure.

## Rolling back
- App: redeploy the previous Vercel build.
- DB: forward-fix with a new migration. Never edit an applied migration; issued
  invoices, signed notes and audit rows are immutable.

## Notes
- `npm run db:generate` creates a new Drizzle migration from schema changes;
  review the SQL before committing.
- Never point Preview/Staging at the production database.
