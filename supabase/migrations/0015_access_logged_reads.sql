-- Reads that cannot happen without being logged.
--
-- §12.2 requires a record of every access to a patient's data. Writes are
-- covered by triggers, but Postgres has no trigger on SELECT: a client reading
-- `patients` directly leaves no trace, and no amount of application code can
-- change that once the application is out of the path.
--
-- So the direct read is taken away and replaced by functions that log first.
-- Going through them is not a convention the client may follow — it is the
-- only way in.
--
-- The subtlety is keeping RLS. A SECURITY DEFINER function owned by `postgres`
-- would inherit its BYPASSRLS and quietly drop the row-level policies, leaving
-- the function's own logic as the only barrier. Instead the functions are
-- owned by a role that has SELECT and does *not* bypass RLS, so the policies
-- still run — and since they are written against auth.uid() rather than
-- current_user, they still evaluate the real caller.

-- ---------------------------------------------------------------------------
-- A reader that is subject to RLS
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_phi_reader') THEN
    CREATE ROLE app_phi_reader NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

-- Postgres has to be a member of the role before it can hand functions over
-- to it; without this, ALTER FUNCTION ... OWNER TO fails with "must be able to
-- SET ROLE".
GRANT app_phi_reader TO CURRENT_USER;

-- Every policy in this schema is written `TO authenticated`. Inside a
-- SECURITY DEFINER function the effective role is the owner, so without
-- membership no policy applies to it and RLS denies everything by default —
-- the functions returned zero rows until this was added. Membership makes the
-- existing policies apply, and they still evaluate the real caller through
-- auth.uid() rather than the role name.
GRANT authenticated TO app_phi_reader;

GRANT USAGE ON SCHEMA public, app TO app_phi_reader;
-- CREATE as well as USAGE: owning a function in a schema requires it, and the
-- ALTER FUNCTION ... OWNER TO below fails with "permission denied for schema"
-- without it.
GRANT CREATE ON SCHEMA app TO app_phi_reader;
GRANT SELECT ON patients, encounters, observations, appointments, employees,
                invoices, services TO app_phi_reader;

-- ---------------------------------------------------------------------------
-- Let a client session evaluate the policies at all
-- ---------------------------------------------------------------------------

-- Every RLS policy in this schema calls app.current_org(), app.has_role() and
-- friends, and `authenticated` had no access to the schema they live in. The
-- policies have therefore never run from a client session — nothing connects
-- that way today, since the web goes through the server as `postgres`. A
-- direct client needs this, and without it every read fails with "permission
-- denied for schema app" rather than with the policy's own verdict.
GRANT USAGE ON SCHEMA app TO authenticated;
GRANT EXECUTE ON FUNCTION app.jwt(), app.current_roles(), app.has_role(text),
                          app.has_any_role(text[]), app.current_org(),
                          app.current_employee_id(), app.current_user_id(),
                          app.is_client_session()
  TO authenticated;

-- ---------------------------------------------------------------------------
-- The log itself
-- ---------------------------------------------------------------------------

-- Owned by postgres so it can write regardless of who is reading. Separating
-- it this way means the reader role never needs INSERT anywhere: it reads
-- under RLS, and logging is somebody else's privilege.
CREATE OR REPLACE FUNCTION app.log_patient_access(
  p_patient_id uuid,
  p_action text,
  p_route text
) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO access_logs (organization_id, actor_user_id, patient_id, action, route, purpose)
  VALUES (app.current_org(), app.current_user_id(), p_patient_id, p_action, p_route,
          'Read through a logged access function');
END;
$$;

REVOKE ALL ON FUNCTION app.log_patient_access(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.log_patient_access(uuid, text, text) TO app_phi_reader;

-- ---------------------------------------------------------------------------
-- The reads
-- ---------------------------------------------------------------------------

-- Find a patient by name, nickname or number. Mirrors resolve_patient: the
-- caller gets candidates, never a silent pick, and every candidate returned is
-- an identity disclosed, so every candidate is logged.
CREATE OR REPLACE FUNCTION app.search_patients(p_query text)
RETURNS TABLE (
  patient_id uuid,
  legal_first_name text,
  legal_last_name text,
  preferred_name text,
  patient_number text,
  birth_year text,
  score real
)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  folded text := lower(trim(p_query));
  r record;
BEGIN
  IF folded = '' THEN RETURN; END IF;

  FOR r IN
    SELECT p.id, p.legal_first_name, p.legal_last_name, p.preferred_name,
           p.patient_number, p.date_of_birth,
           GREATEST(
             similarity(lower(p.legal_first_name || ' ' || p.legal_last_name), folded),
             similarity(lower(p.legal_first_name), folded),
             similarity(lower(p.legal_last_name), folded),
             similarity(lower(COALESCE(p.preferred_name, '')), folded),
             CASE WHEN lower(p.patient_number) = folded THEN 1.0 ELSE 0 END
           ) AS s
    FROM patients p
    WHERE p.deleted_at IS NULL
    ORDER BY s DESC
    LIMIT 5
  LOOP
    CONTINUE WHEN r.s < 0.3;
    PERFORM app.log_patient_access(r.id, 'assistant_read', 'app.search_patients');
    patient_id := r.id;
    legal_first_name := r.legal_first_name;
    legal_last_name := r.legal_last_name;
    preferred_name := r.preferred_name;
    patient_number := r.patient_number;
    -- Year only, and only useful for telling two people apart.
    birth_year := to_char(r.date_of_birth, 'YYYY');
    score := r.s;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- The schedule, with the names on it. Appointments alone carry no identity,
-- but a schedule does: it says who is coming and when.
CREATE OR REPLACE FUNCTION app.appointments_in_range(
  p_from timestamptz,
  p_to timestamptz,
  p_only_mine boolean DEFAULT false
)
RETURNS TABLE (
  appointment_id uuid,
  start_at timestamptz,
  end_at timestamptz,
  status text,
  modality text,
  patient_id uuid,
  patient_name text,
  practitioner_name text,
  service_name text
)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  mine uuid := app.current_employee_id();
  r record;
  seen uuid[] := '{}';
BEGIN
  FOR r IN
    SELECT a.id, a.start_at, a.end_at, a.status::text, a.modality::text,
           a.patient_id,
           p.legal_first_name || ' ' || p.legal_last_name AS patient_name,
           e.first_name || ' ' || e.last_name AS practitioner_name,
           s.name_en AS service_name
    FROM appointments a
    JOIN patients p ON p.id = a.patient_id
    JOIN employees e ON e.id = a.employee_id
    LEFT JOIN services s ON s.id = a.service_id
    WHERE a.start_at >= p_from AND a.start_at < p_to
      AND (NOT p_only_mine OR a.employee_id = mine)
      AND a.status NOT IN ('cancelled', 'no_show', 'rescheduled')
    ORDER BY a.start_at
  LOOP
    -- One row per patient, however many appointments they have.
    IF NOT (r.patient_id = ANY(seen)) THEN
      PERFORM app.log_patient_access(r.patient_id, 'assistant_read', 'app.appointments_in_range');
      seen := seen || r.patient_id;
    END IF;
    appointment_id := r.id;
    start_at := r.start_at;
    end_at := r.end_at;
    status := r.status;
    modality := r.modality;
    patient_id := r.patient_id;
    patient_name := r.patient_name;
    practitioner_name := r.practitioner_name;
    service_name := r.service_name;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- One patient, cut down to what someone needs before a visit. No clinical
-- notes: those are a separate permission and a separate function, when one
-- exists.
CREATE OR REPLACE FUNCTION app.get_patient_summary(p_patient_id uuid)
RETURNS TABLE (
  patient_id uuid,
  full_name text,
  preferred_name text,
  patient_number text,
  status text,
  preferred_language text,
  last_completed_visit timestamptz,
  next_appointment timestamptz,
  outstanding_cents bigint
)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p record;
BEGIN
  SELECT * INTO p FROM patients WHERE id = p_patient_id AND deleted_at IS NULL;
  -- Not found and not permitted answer alike: RLS has already filtered, so a
  -- missing row may mean either, and saying which would leak the difference.
  IF NOT FOUND THEN RETURN; END IF;

  PERFORM app.log_patient_access(p.id, 'assistant_read', 'app.get_patient_summary');

  patient_id := p.id;
  full_name := p.legal_first_name || ' ' || p.legal_last_name;
  preferred_name := p.preferred_name;
  patient_number := p.patient_number;
  status := p.status::text;
  preferred_language := p.preferred_language::text;

  SELECT max(a.start_at) INTO last_completed_visit
  FROM appointments a
  WHERE a.patient_id = p.id AND a.status = 'completed' AND a.start_at <= now();

  SELECT min(a.start_at) INTO next_appointment
  FROM appointments a
  WHERE a.patient_id = p.id AND a.start_at > now()
    AND a.status NOT IN ('cancelled', 'no_show', 'rescheduled');

  -- Billing is a separate permission; RLS on invoices decides whether this
  -- caller sees anything, and a role without it simply gets zero.
  SELECT COALESCE(sum(i.balance_cents), 0) INTO outstanding_cents
  FROM invoices i
  WHERE i.patient_id = p.id AND i.status <> 'void' AND i.balance_cents > 0;

  RETURN NEXT;
END;
$$;

-- The functions run as the reader role, which is subject to RLS.
ALTER FUNCTION app.search_patients(text) OWNER TO app_phi_reader;
ALTER FUNCTION app.appointments_in_range(timestamptz, timestamptz, boolean) OWNER TO app_phi_reader;
ALTER FUNCTION app.get_patient_summary(uuid) OWNER TO app_phi_reader;

REVOKE ALL ON FUNCTION app.search_patients(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.appointments_in_range(timestamptz, timestamptz, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.get_patient_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.search_patients(text) TO authenticated;
GRANT EXECUTE ON FUNCTION app.appointments_in_range(timestamptz, timestamptz, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION app.get_patient_summary(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Close the direct route
-- ---------------------------------------------------------------------------

-- With these revoked, a client session can no longer read a name at all except
-- through a function that logs it. The backoffice is unaffected: it connects
-- as `postgres`, which keeps its own grant.
REVOKE SELECT ON patients FROM authenticated, anon;
REVOKE SELECT ON encounters FROM authenticated, anon;
REVOKE SELECT ON observations FROM authenticated, anon;
