-- Run in a SEPARATE query AFTER 0006: Postgres cannot use a new enum value
-- ('missed') in the same transaction that added it (error 55P04).
-- Missed shifts don't block caregiver time either.
ALTER TABLE care_shifts DROP CONSTRAINT ex_care_shift_no_overlap;--> statement-breakpoint
ALTER TABLE care_shifts ADD CONSTRAINT ex_care_shift_no_overlap
  EXCLUDE USING gist (
    caregiver_id WITH =,
    tstzrange(start_at, end_at) WITH &&
  ) WHERE (status NOT IN ('cancelled', 'no_show', 'missed'));
