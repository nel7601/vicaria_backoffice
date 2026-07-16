-- Fine-grained RLS policies (spec §4.2, ADR-003) + immutability triggers.
--
-- Model: server code paths use the Supabase service_role (BYPASSRLS) and are
-- gated by src/lib/auth. End-user (authenticated) access is governed by the
-- policies below, which mirror the §4.2 permission matrix. Enabling RLS with
-- no matching policy denies access — the safe default set in 0001.
--
-- Roles and organization come from JWT app_metadata claims (roles: text[],
-- organization_id: uuid). See src/lib/auth/session.ts.

-- ---------------------------------------------------------------------------
-- Claim helpers (schema `app`)
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS app;

CREATE OR REPLACE FUNCTION app.jwt() RETURNS jsonb
  LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

CREATE OR REPLACE FUNCTION app.current_roles() RETURNS text[]
  LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    ARRAY(SELECT jsonb_array_elements_text(app.jwt() -> 'app_metadata' -> 'roles')),
    '{}'::text[]
  )
$$;

CREATE OR REPLACE FUNCTION app.has_role(r text) RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT r = ANY(app.current_roles()) $$;

CREATE OR REPLACE FUNCTION app.has_any_role(rs text[]) RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT app.current_roles() && rs $$;

CREATE OR REPLACE FUNCTION app.current_org() RETURNS uuid
  LANGUAGE sql STABLE AS $$
  SELECT NULLIF(app.jwt() -> 'app_metadata' ->> 'organization_id', '')::uuid
$$;

-- Maps the authenticated user to their employee row (for assigned/own scopes).
-- SECURITY DEFINER so the mapping is readable regardless of table grants.
CREATE OR REPLACE FUNCTION app.current_employee_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.id
  FROM employees e
  JOIN users u ON u.id = e.user_id
  WHERE u.auth_user_id = auth.uid()
  LIMIT 1
$$;

-- ===========================================================================
-- Patients (patients_demographic)
-- ===========================================================================
CREATE POLICY patients_select ON patients FOR SELECT TO authenticated
USING (
  organization_id = app.current_org() AND (
    app.has_any_role(ARRAY['owner','administrator','reception','billing','auditor'])
    OR (app.has_role('practitioner') AND primary_practitioner_id = app.current_employee_id())
    OR (app.has_role('marketing') AND marketing_opt_in = true)
  )
);
CREATE POLICY patients_insert ON patients FOR INSERT TO authenticated
WITH CHECK (
  organization_id = app.current_org()
  AND app.has_any_role(ARRAY['owner','administrator','reception'])
);
CREATE POLICY patients_update ON patients FOR UPDATE TO authenticated
USING (
  organization_id = app.current_org()
  AND app.has_any_role(ARRAY['owner','administrator','reception'])
)
WITH CHECK (organization_id = app.current_org());
CREATE POLICY patients_delete ON patients FOR DELETE TO authenticated
USING (
  organization_id = app.current_org()
  AND app.has_any_role(ARRAY['owner','administrator','reception'])
);

-- Patient sub-records follow the patient's demographic access for reads and
-- allow clinical/reception writes as appropriate.
CREATE POLICY patient_consents_rw ON patient_consents FOR ALL TO authenticated
USING (
  organization_id = app.current_org()
  AND app.has_any_role(ARRAY['owner','administrator','reception','auditor','practitioner'])
)
WITH CHECK (
  organization_id = app.current_org()
  AND app.has_any_role(ARRAY['owner','administrator','reception','practitioner'])
);

CREATE POLICY patient_alerts_rw ON patient_alerts FOR ALL TO authenticated
USING (
  organization_id = app.current_org()
  AND app.has_any_role(ARRAY['owner','administrator','reception','practitioner','auditor'])
)
WITH CHECK (
  organization_id = app.current_org()
  AND app.has_any_role(ARRAY['owner','administrator','reception','practitioner'])
);

CREATE POLICY patient_tags_rw ON patient_tags FOR ALL TO authenticated
USING (
  organization_id = app.current_org()
  AND app.has_any_role(ARRAY['owner','administrator','reception','marketing','auditor'])
)
WITH CHECK (
  organization_id = app.current_org()
  AND app.has_any_role(ARRAY['owner','administrator','reception'])
);

-- ===========================================================================
-- Appointments
-- ===========================================================================
CREATE POLICY appointments_select ON appointments FOR SELECT TO authenticated
USING (
  organization_id = app.current_org() AND (
    app.has_any_role(ARRAY['owner','administrator','reception','billing','auditor'])
    OR (app.has_role('practitioner') AND employee_id = app.current_employee_id())
  )
);
CREATE POLICY appointments_write ON appointments FOR ALL TO authenticated
USING (
  organization_id = app.current_org()
  AND app.has_any_role(ARRAY['owner','administrator','reception'])
)
WITH CHECK (
  organization_id = app.current_org()
  AND app.has_any_role(ARRAY['owner','administrator','reception'])
);
CREATE POLICY appt_status_history_select ON appointment_status_history FOR SELECT TO authenticated
USING (
  organization_id = app.current_org()
  AND app.has_any_role(ARRAY['owner','administrator','reception','billing','auditor','practitioner'])
);

-- ===========================================================================
-- Encounters / clinical notes (clinical_notes)
-- ===========================================================================
CREATE POLICY encounters_select ON encounters FOR SELECT TO authenticated
USING (
  organization_id = app.current_org() AND (
    app.has_any_role(ARRAY['owner','administrator','auditor'])
    OR (app.has_role('practitioner') AND practitioner_id = app.current_employee_id())
  )
);
CREATE POLICY encounters_write ON encounters FOR ALL TO authenticated
USING (
  organization_id = app.current_org()
  AND app.has_role('practitioner')
  AND practitioner_id = app.current_employee_id()
)
WITH CHECK (
  organization_id = app.current_org()
  AND app.has_role('practitioner')
  AND practitioner_id = app.current_employee_id()
);

CREATE POLICY encounter_amendments_select ON encounter_amendments FOR SELECT TO authenticated
USING (
  organization_id = app.current_org()
  AND app.has_any_role(ARRAY['owner','administrator','auditor','practitioner'])
);
CREATE POLICY encounter_amendments_insert ON encounter_amendments FOR INSERT TO authenticated
WITH CHECK (
  organization_id = app.current_org()
  AND app.has_role('practitioner')
);

CREATE POLICY observations_select ON observations FOR SELECT TO authenticated
USING (
  organization_id = app.current_org()
  AND app.has_any_role(ARRAY['owner','administrator','auditor','practitioner'])
);
CREATE POLICY observations_write ON observations FOR ALL TO authenticated
USING (organization_id = app.current_org() AND app.has_role('practitioner'))
WITH CHECK (organization_id = app.current_org() AND app.has_role('practitioner'));

-- ===========================================================================
-- Billing (invoices_payments). Marketing gets ONLY aggregate views, never rows.
-- ===========================================================================
CREATE POLICY invoices_select ON invoices FOR SELECT TO authenticated
USING (
  organization_id = app.current_org()
  AND app.has_any_role(ARRAY['owner','administrator','billing','reception','auditor','practitioner'])
);
CREATE POLICY invoices_insert ON invoices FOR INSERT TO authenticated
WITH CHECK (
  organization_id = app.current_org()
  AND app.has_any_role(ARRAY['owner','administrator','billing','reception'])
);
CREATE POLICY invoices_update ON invoices FOR UPDATE TO authenticated
USING (
  organization_id = app.current_org()
  AND app.has_any_role(ARRAY['owner','administrator','billing'])
)
WITH CHECK (organization_id = app.current_org());

CREATE POLICY invoice_items_rw ON invoice_items FOR ALL TO authenticated
USING (
  organization_id = app.current_org()
  AND app.has_any_role(ARRAY['owner','administrator','billing','reception','auditor'])
)
WITH CHECK (
  organization_id = app.current_org()
  AND app.has_any_role(ARRAY['owner','administrator','billing','reception'])
);

CREATE POLICY payments_select ON payments FOR SELECT TO authenticated
USING (
  organization_id = app.current_org()
  AND app.has_any_role(ARRAY['owner','administrator','billing','reception','auditor'])
);
CREATE POLICY payments_insert ON payments FOR INSERT TO authenticated
WITH CHECK (
  organization_id = app.current_org()
  AND app.has_any_role(ARRAY['owner','administrator','billing','reception'])
);
CREATE POLICY payments_update ON payments FOR UPDATE TO authenticated
USING (
  organization_id = app.current_org()
  AND app.has_any_role(ARRAY['owner','administrator','billing'])
)
WITH CHECK (organization_id = app.current_org());

CREATE POLICY payment_allocations_rw ON payment_allocations FOR ALL TO authenticated
USING (
  organization_id = app.current_org()
  AND app.has_any_role(ARRAY['owner','administrator','billing','reception','auditor'])
)
WITH CHECK (
  organization_id = app.current_org()
  AND app.has_any_role(ARRAY['owner','administrator','billing','reception'])
);

-- ===========================================================================
-- Documents (private; app enforces signed-URL + consent, RLS scopes rows)
-- ===========================================================================
CREATE POLICY documents_select ON documents FOR SELECT TO authenticated
USING (
  organization_id = app.current_org() AND (
    app.has_any_role(ARRAY['owner','administrator','reception','billing','auditor'])
    OR (app.has_role('practitioner') AND access_level IN ('clinical','administrative'))
  )
);
CREATE POLICY documents_write ON documents FOR ALL TO authenticated
USING (
  organization_id = app.current_org()
  AND app.has_any_role(ARRAY['owner','administrator','reception','billing','practitioner'])
)
WITH CHECK (
  organization_id = app.current_org()
  AND app.has_any_role(ARRAY['owner','administrator','reception','billing','practitioner'])
);

-- ===========================================================================
-- Audit & access logs — read-only for auditor/owner/admin; append-only.
-- (Writes happen server-side via service_role, so no insert policy is needed.)
-- ===========================================================================
CREATE POLICY audit_events_select ON audit_events FOR SELECT TO authenticated
USING (
  organization_id = app.current_org()
  AND app.has_any_role(ARRAY['owner','administrator','auditor'])
);
CREATE POLICY access_logs_select ON access_logs FOR SELECT TO authenticated
USING (
  organization_id = app.current_org()
  AND app.has_any_role(ARRAY['owner','auditor'])
);
CREATE POLICY privacy_requests_select ON privacy_requests FOR SELECT TO authenticated
USING (
  organization_id = app.current_org()
  AND app.has_any_role(ARRAY['owner','administrator','auditor'])
);

-- ===========================================================================
-- Immutability triggers (spec §6.4, §6.7, §8.1)
-- ===========================================================================

-- FR-ENC-004: a signed note cannot be edited; only its status may advance to
-- 'amended'. Corrections go through encounter_amendments.
CREATE OR REPLACE FUNCTION app.enforce_signed_encounter_immutable()
  RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('signed', 'amended') THEN
    IF NEW.content_snapshot IS DISTINCT FROM OLD.content_snapshot
       OR NEW.summary IS DISTINCT FROM OLD.summary
       OR NEW.signed_at IS DISTINCT FROM OLD.signed_at
       OR NEW.signed_by IS DISTINCT FROM OLD.signed_by
       OR NEW.content_hash IS DISTINCT FROM OLD.content_hash THEN
      RAISE EXCEPTION 'Signed encounter % is immutable; use an amendment', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_encounter_immutable
  BEFORE UPDATE ON encounters
  FOR EACH ROW EXECUTE FUNCTION app.enforce_signed_encounter_immutable();

-- FR-INV-002: an assigned invoice_number is immutable once set.
CREATE OR REPLACE FUNCTION app.enforce_invoice_number_immutable()
  RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.invoice_number IS NOT NULL
     AND NEW.invoice_number IS DISTINCT FROM OLD.invoice_number THEN
    RAISE EXCEPTION 'invoice_number is immutable once issued (invoice %)', OLD.id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_invoice_number_immutable
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION app.enforce_invoice_number_immutable();
