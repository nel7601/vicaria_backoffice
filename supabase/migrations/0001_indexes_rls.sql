-- Supplementary migration: extensions, indexes and RLS scaffolding (spec §8.4, §12).
-- Drizzle Kit emits table/column/constraint DDL; this file adds the pieces that
-- are expressed as raw SQL: extensions, performance indexes, trigram search and
-- Row Level Security enablement.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;      -- case-insensitive email
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- fuzzy name/tag search (§8.4)

-- ---------------------------------------------------------------------------
-- Hot-path indexes: patient_id + created_at (§8.4)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS ix_appointments_patient_created
  ON appointments (patient_id, created_at);
CREATE INDEX IF NOT EXISTS ix_encounters_patient_created
  ON encounters (patient_id, created_at);
CREATE INDEX IF NOT EXISTS ix_invoices_patient_created
  ON invoices (patient_id, created_at);
CREATE INDEX IF NOT EXISTS ix_payments_patient_created
  ON payments (patient_id, created_at);
CREATE INDEX IF NOT EXISTS ix_documents_patient_created
  ON documents (patient_id, created_at);
CREATE INDEX IF NOT EXISTS ix_audit_events_org_occurred
  ON audit_events (organization_id, occurred_at);
CREATE INDEX IF NOT EXISTS ix_access_logs_patient_occurred
  ON access_logs (patient_id, occurred_at);

-- Calendar lookups by practitioner + time window (conflict detection, §FR-APT-003).
CREATE INDEX IF NOT EXISTS ix_appointments_employee_start
  ON appointments (employee_id, start_at);

-- ---------------------------------------------------------------------------
-- Trigram search for patient name/tags (§8.4)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS ix_patients_name_trgm
  ON patients USING gin (
    (lower(legal_first_name || ' ' || legal_last_name)) gin_trgm_ops
  );
CREATE INDEX IF NOT EXISTS ix_patient_tags_trgm
  ON patient_tags USING gin (tag gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Appointment overlap prevention (§8.4)
-- Reject two overlapping appointments for the same practitioner unless one is
-- cancelled/no_show. Uses btree_gist for the equality part of the exclusion.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE appointments
  ADD CONSTRAINT ex_appointment_no_overlap
  EXCLUDE USING gist (
    employee_id WITH =,
    tstzrange(start_at, end_at) WITH &&
  )
  WHERE (status NOT IN ('cancelled', 'no_show', 'rescheduled'));

-- ---------------------------------------------------------------------------
-- Row Level Security (§4 "Regla de mínimo privilegio", SEC-02)
-- Enable RLS on business tables. Fine-grained policies (per role/scope) are
-- added in the authorization migration once auth claims are finalized (ADR-003).
-- Enabling RLS with no policy denies all access by default, which is the safe
-- baseline: server code uses the service role, app users go through policies.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  business_tables text[] := ARRAY[
    'patients', 'patient_consents', 'patient_alerts', 'patient_tags',
    'appointments', 'appointment_status_history',
    'encounters', 'encounter_amendments', 'observations',
    'treatment_plans', 'treatment_goals', 'follow_up_tasks',
    'skin_procedures', 'skin_lesions',
    'invoices', 'invoice_items', 'payments', 'payment_allocations',
    'refunds', 'credit_notes', 'receipts', 'cash_sessions', 'cash_movements',
    'package_enrollments', 'package_session_usage',
    'documents', 'communications',
    'audit_events', 'access_logs', 'privacy_requests'
  ];
BEGIN
  FOREACH t IN ARRAY business_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
  END LOOP;
END $$;
