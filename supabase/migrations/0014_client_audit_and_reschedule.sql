-- Groundwork for a client that talks to Postgres directly (no application
-- server in the path).
--
-- Two things stop being trustworthy the moment the server is removed:
-- auditing, because a client writes it only if it chooses to, and multi-step
-- writes, because supabase-js has no transactions. Both move here.

-- ---------------------------------------------------------------------------
-- Who is acting
-- ---------------------------------------------------------------------------

-- The local users.id for the current JWT. app.current_employee_id() already
-- exists for the employee side; audit rows reference users.id instead.
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id FROM users u WHERE u.auth_user_id = auth.uid() LIMIT 1
$$;

-- True when this statement arrives from a Supabase session (a JWT is present)
-- rather than from the backoffice server, which connects with DATABASE_URL and
-- carries no claims.
--
-- This is what keeps the trigger from duplicating what the server already
-- writes: the server audits in application code, the client cannot, so the
-- trigger fires only for the client.
CREATE OR REPLACE FUNCTION app.is_client_session() RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT auth.uid() IS NOT NULL $$;

-- ---------------------------------------------------------------------------
-- Auditing that does not depend on the caller
-- ---------------------------------------------------------------------------

-- Records every change made through a client session. Postgres has no trigger
-- on SELECT, so reads still need their own path (see access_logs work); this
-- covers writes, which are the ones that alter a patient's record.
CREATE OR REPLACE FUNCTION app.audit_row_change() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid;
  org uuid;
  entity_id text;
BEGIN
  -- The server audits its own writes with more context than a trigger can
  -- reconstruct (a reason, the operation's intent), so it is left alone.
  IF NOT app.is_client_session() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  actor := app.current_user_id();
  org := COALESCE(
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE (to_jsonb(NEW) ->> 'organization_id')::uuid END,
    CASE WHEN TG_OP = 'DELETE' THEN (to_jsonb(OLD) ->> 'organization_id')::uuid ELSE NULL END
  );
  entity_id := COALESCE(
    CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ->> 'id' ELSE to_jsonb(NEW) ->> 'id' END,
    ''
  );

  INSERT INTO audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id,
    before, after, reason
  ) VALUES (
    org,
    actor,
    lower(TG_OP),
    TG_TABLE_NAME,
    entity_id,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END,
    'Recorded by database trigger (client session)'
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- The tables whose changes are a patient's record changing. Catalog and
-- configuration tables are deliberately absent: they are noise here and the
-- backoffice audits them where it has the context to say why.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'appointments', 'patients', 'invoices', 'payments', 'encounters',
    'care_shifts', 'follow_up_tasks'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%1$s ON %1$I;', t);
    EXECUTE format(
      'CREATE TRIGGER trg_audit_%1$s AFTER INSERT OR UPDATE OR DELETE ON %1$I
       FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Rescheduling, as one transaction
-- ---------------------------------------------------------------------------

-- Moving an appointment is five writes that must all happen or none: close the
-- original, create its successor linked by rescheduled_from_id, a history row
-- for each, and the conflict check repeated immediately before the insert. A
-- client cannot do that — supabase-js sends one statement at a time — so a
-- failure half way would leave a closed appointment with no replacement.
--
-- SECURITY DEFINER because it writes history and audit rows the caller may not
-- write directly; the role check is therefore done here, mirroring the
-- application's matrix: rescheduling is patients_demographic/update, which
-- practitioners do not hold.
CREATE OR REPLACE FUNCTION app.reschedule_appointment(
  p_appointment_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_employee_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL
) RETURNS TABLE (
  appointment_id uuid,
  original_id uuid,
  start_at timestamptz,
  end_at timestamptz,
  employee_id uuid,
  patient_id uuid
)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  current_row appointments%ROWTYPE;
  target_employee uuid;
  created appointments%ROWTYPE;
  org uuid := app.current_org();
BEGIN
  IF NOT app.has_any_role(ARRAY['owner', 'administrator', 'reception']) THEN
    RAISE EXCEPTION 'not_authorized'
      USING HINT = 'Your role cannot change appointments.';
  END IF;

  IF p_end_at <= p_start_at THEN
    RAISE EXCEPTION 'invalid_time_range'
      USING HINT = 'The end time must be after the start time.';
  END IF;

  -- Locked and re-read inside the transaction: the state that mattered when
  -- the user was shown the proposal is not the state that matters now.
  SELECT * INTO current_row
  FROM appointments
  WHERE id = p_appointment_id AND organization_id = org
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found'
      USING HINT = 'That appointment no longer exists.';
  END IF;

  IF current_row.status NOT IN ('scheduled', 'confirmed', 'checked_in') THEN
    RAISE EXCEPTION 'invalid_state'
      USING HINT = format('This appointment is %s and can no longer be moved.',
                          current_row.status);
  END IF;

  target_employee := COALESCE(p_employee_id, current_row.employee_id);

  -- Checked here, immediately before the insert, because a slot that was free
  -- when the card was shown may be taken by the time it is confirmed.
  -- ex_appointment_no_overlap remains the last line if two writers still race.
  IF EXISTS (
    SELECT 1 FROM appointments a
    WHERE a.organization_id = org
      AND a.employee_id = target_employee
      AND a.id <> current_row.id
      AND a.status NOT IN ('cancelled', 'no_show', 'rescheduled')
      AND a.start_at < p_end_at
      AND a.end_at > p_start_at
  ) THEN
    RAISE EXCEPTION 'slot_taken'
      USING HINT = 'That time is no longer free for this practitioner.';
  END IF;

  UPDATE appointments
  SET status = 'rescheduled', updated_at = now()
  WHERE id = current_row.id;

  INSERT INTO appointment_status_history
    (organization_id, appointment_id, from_status, to_status, reason, changed_by)
  VALUES
    (org, current_row.id, current_row.status, 'rescheduled', p_reason,
     app.current_user_id());

  -- The successor copies the booking, not its history: service, price and
  -- modality carry over, status starts fresh.
  INSERT INTO appointments (
    organization_id, patient_id, service_id, employee_id, location_id,
    start_at, end_at, modality, estimated_price_cents, notes_admin,
    status, rescheduled_from_id
  ) VALUES (
    org, current_row.patient_id, current_row.service_id, target_employee,
    current_row.location_id, p_start_at, p_end_at, current_row.modality,
    current_row.estimated_price_cents, current_row.notes_admin,
    'scheduled', current_row.id
  ) RETURNING * INTO created;

  INSERT INTO appointment_status_history
    (organization_id, appointment_id, from_status, to_status, reason, changed_by)
  VALUES
    (org, created.id, NULL, 'scheduled', p_reason, app.current_user_id());

  RETURN QUERY SELECT created.id, current_row.id, created.start_at,
                      created.end_at, created.employee_id, created.patient_id;
END;
$$;

-- Only signed-in users may call it; the function decides the rest.
REVOKE ALL ON FUNCTION app.reschedule_appointment(uuid, timestamptz, timestamptz, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.reschedule_appointment(uuid, timestamptz, timestamptz, uuid, text) TO authenticated;
