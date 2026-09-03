-- Receipt numbering (§FR-REC-001).
--
-- receipts.receipt_number existed but nothing ever filled it. A receipt that
-- is handed to a patient needs an identifier they can quote back, and it has
-- to be its own sequence: one invoice can be receipted more than once
-- (a deposit, then the balance), so the invoice number cannot stand in.
ALTER TABLE company_settings
  ADD COLUMN receipt_number_prefix varchar(16) DEFAULT 'REC-';--> statement-breakpoint
ALTER TABLE company_settings
  ADD COLUMN receipt_next_sequence integer NOT NULL DEFAULT 1;--> statement-breakpoint

-- Backfill: number the receipts already issued, oldest first, then leave the
-- counter past the highest one so the next receipt cannot collide.
DO $$
DECLARE
  org record;
  r record;
  seq integer;
  prefix text;
BEGIN
  FOR org IN SELECT organization_id, receipt_number_prefix FROM company_settings LOOP
    seq := 1;
    prefix := COALESCE(org.receipt_number_prefix, 'REC-');
    FOR r IN
      SELECT id FROM receipts
      WHERE organization_id = org.organization_id AND receipt_number IS NULL
      ORDER BY issued_at, created_at, id
    LOOP
      UPDATE receipts
        SET receipt_number = prefix || lpad(seq::text, 5, '0'),
            updated_at = now()
        WHERE id = r.id;
      seq := seq + 1;
    END LOOP;
    UPDATE company_settings
      SET receipt_next_sequence = seq, updated_at = now()
      WHERE organization_id = org.organization_id;
  END LOOP;
END $$;--> statement-breakpoint

-- One receipt number per organization, only once assigned (mirrors
-- uq_invoice_number).
CREATE UNIQUE INDEX uq_receipt_number
  ON receipts (organization_id, receipt_number)
  WHERE receipt_number IS NOT NULL;
