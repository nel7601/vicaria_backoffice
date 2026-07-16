-- Allow invoice-level receipts that aggregate confirmed payments (§FR-REC-001).
-- A per-payment receipt still sets payment_id; an invoice-level one leaves it null.
ALTER TABLE receipts ALTER COLUMN payment_id DROP NOT NULL;
