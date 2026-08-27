# Square setup (card payments & POS terminal)

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
| `SQUARE_TERMINAL_DEVICE_ID` | server (optional) | Device id of the paired Square Terminal — enables the POS option |

The card option on the invoice page stays disabled ("not configured") until
`SQUARE_ACCESS_TOKEN`, a location id and `NEXT_PUBLIC_SQUARE_APPLICATION_ID`
are all present. Sandbox and production have **different** application ids,
tokens and signature keys — never mix them.

## Configure the webhook

1. Developer Dashboard → your application → Webhooks → Subscriptions.
2. Add the endpoint `https://<host>/api/webhooks/square`.
3. Subscribe at least to `payment.created`, `payment.updated` and — when the
   POS is used — `terminal.checkout.updated`
   (`refund.created`/`refund.updated` are stored for audit).
4. Copy the **Signature key** into `SQUARE_WEBHOOK_SIGNATURE_KEY`.

## POS (Square Terminal)

The **POS (Terminal)** option on the invoice page pushes a Terminal API
checkout for the open balance to the paired device; the patient taps or
inserts their card on the terminal. The backoffice polls Square (and listens
to `terminal.checkout.updated`) and, on completion, confirms the payment,
applies it to the invoice and issues the receipt automatically. The checkout
can be cancelled from the invoice page while it is still on the device, and
it times out on its own if nobody pays (Square's default is ~5 minutes).

To pair the terminal and get its device id:

1. `POST /v2/devices/codes` with `"product_type": "TERMINAL_API"` and your
   `location_id` (Developer Dashboard → API Explorer works well for this).
2. On the Square Terminal: **Settings → Device code** (under General),
   enter the code returned in step 1.
3. Read the paired device id from `GET /v2/devices/codes/{id}` (`device_id`)
   — or from the `device.code.paired` webhook — and set it as
   `SQUARE_TERMINAL_DEVICE_ID`.

Notes:

- Tipping is disabled in the checkout so the captured amount always equals
  the invoice charge; enable it deliberately in
  `src/lib/square/client.ts` if the practice wants tips.
- **Interac debit** payments (Canada) cannot be refunded from the dashboard
  or the Refunds API — the cardholder must be present and the refund done on
  the terminal itself. Credit card refunds work from the billing screen.
- In sandbox there is no physical device: Square provides simulated test
  device ids that auto-complete or auto-fail a checkout (see "Testing in the
  Sandbox" for the Terminal API in Square's docs).

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
