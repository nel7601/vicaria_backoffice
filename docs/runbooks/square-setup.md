# Square setup (card payments)

Card payments (spec §10.1) use two Square pieces:

- **Web Payments SDK** in the browser: renders Square-hosted card fields on
  the invoice page and returns a one-time token. Card numbers never touch our
  servers (PCI SAQ A).
- **Payments / Refunds API** on the server: charges the token for the
  invoice's open balance and refunds card payments. Every mutating call sends
  an idempotency key (the UUID of our own DB row), so retries can never
  charge or refund twice (NFR-11).

The **webhook** (`/api/webhooks/square`) verifies the HMAC signature, stores
each event once (unique `provider + event_id`), mirrors the payment into
`square_transactions`, and — idempotently — confirms/creates the matching
`payments` row, applies it to the invoice named in `reference_id` and issues
the receipt. It is the safety net when the app crashes mid-charge, and the
source for reconciliation.

## Environment variables

| Variable | Side | Where to find it |
|----------|------|------------------|
| `SQUARE_ACCESS_TOKEN` | server | Developer Dashboard → application → Credentials |
| `SQUARE_ENVIRONMENT` | server | `production` or `sandbox` (default) |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | server | Developer Dashboard → Webhooks → endpoint → Signature key |
| `SQUARE_LOCATION_ID` | server (optional) | Falls back to `NEXT_PUBLIC_SQUARE_LOCATION_ID` |
| `NEXT_PUBLIC_SQUARE_APPLICATION_ID` | browser | Developer Dashboard → application → Credentials |
| `NEXT_PUBLIC_SQUARE_LOCATION_ID` | browser | Dashboard → Locations (must be the charging location) |

The card option on the invoice page stays disabled ("not configured") until
`SQUARE_ACCESS_TOKEN`, a location id and `NEXT_PUBLIC_SQUARE_APPLICATION_ID`
are all present. Sandbox and production have **different** application ids,
tokens and signature keys — never mix them.

## Configure the webhook

1. Developer Dashboard → your application → Webhooks → Subscriptions.
2. Add the endpoint `https://<host>/api/webhooks/square`.
3. Subscribe at least to `payment.created` and `payment.updated`
   (`refund.created`/`refund.updated` are stored for audit).
4. Copy the **Signature key** into `SQUARE_WEBHOOK_SIGNATURE_KEY`.

The endpoint returns 503 while unconfigured, 401 on a bad signature, and 5xx
when processing fails so Square redelivers (processing is idempotent).

## Sandbox test

1. Set the sandbox credentials in `.env.local` and start the app.
2. Issue an invoice, choose **Card (Square)** and use a Square test card
   (e.g. `4111 1111 1111 1111`, any future expiry, CVV `111`).
3. Verify: invoice becomes `paid`, the receipt exists, and
   `square_transactions` has the mirrored payment with `reconciled = true`.
4. Refund the payment from the billing screen and confirm the refund appears
   in the Square sandbox dashboard.

## Reconciliation

`square_transactions` rows with `reconciled = false` are transactions Square
knows about that we could not match to a payment/invoice (e.g. a charge made
directly in the Square POS, or an amount mismatch). Review them regularly and
record/allocate the corresponding payment manually.
