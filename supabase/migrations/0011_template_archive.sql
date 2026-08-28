-- Archive/unarchive for encounter templates: an archived template stops
-- appearing in selection menus (Add form, new encounter, auto-attach) but
-- keeps its history and can be unarchived from Settings.
ALTER TABLE encounter_templates ADD COLUMN archived_at timestamp with time zone;
