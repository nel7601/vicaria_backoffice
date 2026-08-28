-- Voice-grade patient lookup (assistant plan §4.4).
--
-- The backoffice already has a trigram index on the legal name
-- (ix_patients_name_trgm, migration 0001), and pg_trgm is already installed.
-- What is missing is the field people actually say out loud: a patient known
-- as "Cuco" is not findable by any legal-name search, and speech recognition
-- mangles proper nouns often enough that exact matching is not enough either.
--
-- Both indexes are GIN over the lowercased expression, so the query must
-- lowercase the same way for the index to be used.

CREATE INDEX IF NOT EXISTS ix_patients_preferred_name_trgm
  ON patients USING gin ((lower(preferred_name)) gin_trgm_ops);

-- The number is spoken as digits and matched exactly or by prefix, so a
-- btree on the lowercased value serves it better than a trigram index.
CREATE INDEX IF NOT EXISTS ix_patients_number_lower
  ON patients ((lower(patient_number)));
