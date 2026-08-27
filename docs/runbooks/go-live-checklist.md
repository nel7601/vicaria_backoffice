# Go-live checklist (spec §16.3)

Complete and sign off before enabling production access.

- [ ] Users and roles approved (owner sign-off).
- [ ] MFA configured and enforced for Owner/Administrator/Billing/Auditor.
- [ ] Company settings, logo, signatures and invoice numbering confirmed.
- [ ] Services, prices, taxes and packages validated with the accountant.
- [ ] Square **production** credentials and webhook signature key verified;
      webhook endpoint reachable and returning 2xx.
- [ ] Email sending domain authenticated (SPF/DKIM/DMARC).
- [ ] Backups configured (DB + Storage) and a restore test completed (§16, SEC-08).
- [ ] Privacy/legal review recorded; decisions D-01..D-10 resolved (§20).
- [ ] UAT signed off by Owner, practitioner, reception and billing.
- [ ] Runbooks, support contacts and rollback plan in place.
- [ ] Data migrated and reconciled against source totals (§16.2).
- [ ] RLS/authorization CI checks green (AC-08); no critical vulnerabilities open.
- [ ] Monitoring/alerting live with no PHI in logs (SEC-06, NFR-08).

## Environment configuration to verify

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (client-safe).
- `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` (server only).
- `SQUARE_ACCESS_TOKEN`, `SQUARE_WEBHOOK_SIGNATURE_KEY`, `SQUARE_ENVIRONMENT=production`,
  `NEXT_PUBLIC_SQUARE_APPLICATION_ID`, `NEXT_PUBLIC_SQUARE_LOCATION_ID`,
  `SQUARE_TERMINAL_DEVICE_ID` when using the POS
  (see `docs/runbooks/square-setup.md`).
- `EMAIL_PROVIDER_API_KEY`, `SENTRY_DSN`.
- Supabase project region = Canada (A-05); Vercel function region = yul1.
