-- Synthetic demo data for reviewing the backoffice views.
-- Safe to run once in Supabase SQL Editor; aborts if already present.
-- Creates: 8 patients, 2 caregiver employees, appointments around today,
-- 2 encounters, 3 home-care agreements with contacts + shifts this week,
-- and 3 invoices (draft / issued+partial / paid) with payments.
-- Everything is clearly fictional (names, emails at example.com).

DO $$
DECLARE
  v_org uuid;
  v_emp uuid;               -- existing employee (practitioner/owner)
  v_cg1 uuid; v_cg2 uuid;   -- caregiver employees
  v_u  uuid;
  v_svc_coaching uuid; v_svc_skin uuid;
  v_p1 uuid; v_p2 uuid; v_p3 uuid; v_p4 uuid;
  v_s1 uuid; v_s2 uuid; v_s3 uuid;  -- senior care clients
  v_ag1 uuid; v_ag2 uuid; v_ag3 uuid;
  v_appt uuid;
  v_inv uuid; v_pay uuid;
  v_prefix text; v_seq int;
  d date := (now() AT TIME ZONE 'America/Toronto')::date;  -- today (clinic tz)
BEGIN
  SELECT id INTO v_org FROM organizations LIMIT 1;
  IF v_org IS NULL THEN RAISE EXCEPTION 'No organization found'; END IF;

  IF EXISTS (SELECT 1 FROM patients WHERE organization_id = v_org AND patient_number = 'PAT-9001') THEN
    RAISE NOTICE 'Demo data already present — nothing done.';
    RETURN;
  END IF;

  SELECT id INTO v_emp FROM employees WHERE organization_id = v_org ORDER BY created_at LIMIT 1;
  IF v_emp IS NULL THEN RAISE EXCEPTION 'No employee found — create your owner employee first'; END IF;

  -- Reuse existing services when present; otherwise create demo ones.
  SELECT id INTO v_svc_coaching FROM services WHERE organization_id = v_org ORDER BY created_at LIMIT 1;
  IF v_svc_coaching IS NULL THEN
    INSERT INTO services (organization_id, name_en, name_es, category, default_duration_minutes)
    VALUES (v_org, 'Health Coaching Session', 'Sesión de coaching de salud', NULL, 60)
    RETURNING id INTO v_svc_coaching;
    INSERT INTO service_prices (organization_id, service_id, price_cents, tax_rate_bps)
    VALUES (v_org, v_svc_coaching, 15000, 1300);
  END IF;
  SELECT id INTO v_svc_skin FROM services WHERE organization_id = v_org AND id <> v_svc_coaching ORDER BY created_at LIMIT 1;
  IF v_svc_skin IS NULL THEN v_svc_skin := v_svc_coaching; END IF;

  -- ---------------------------------------------------------------- patients
  INSERT INTO patients (organization_id, patient_number, legal_first_name, legal_last_name, preferred_name, date_of_birth, email, phone_e164, preferred_language, status, address)
  VALUES
    (v_org, 'PAT-9001', 'Amelia',  'Torres',   NULL,    '1988-04-12', 'amelia.demo@example.com',  '+14165550101', 'es', 'active',   '12 Maple Ave, Toronto'),
    (v_org, 'PAT-9002', 'Daniel',  'Fournier', 'Dan',   '1979-11-03', 'dan.demo@example.com',     '+14165550102', 'en', 'active',   '88 Queen St W, Toronto'),
    (v_org, 'PAT-9003', 'Priya',   'Sharma',   NULL,    '1992-06-25', 'priya.demo@example.com',   '+14165550103', 'en', 'active',   '250 Bloor St, Toronto'),
    (v_org, 'PAT-9004', 'Marcus',  'Lee',      NULL,    '1985-01-30', 'marcus.demo@example.com',  '+14165550104', 'en', 'prospect', NULL),
    (v_org, 'PAT-9005', 'Rosa',    'Delgado',  NULL,    '1941-09-17', 'rosa.family@example.com',  '+14165550105', 'es', 'active',   '31 Lakeshore Rd, Etobicoke'),
    (v_org, 'PAT-9006', 'Harold',  'Bennett',  'Harry', '1938-02-08', 'bennett.family@example.com','+14165550106','en', 'active',   '410 Eglinton Ave E, Toronto'),
    (v_org, 'PAT-9007', 'Giulia',  'Moretti',  NULL,    '1946-12-01', 'moretti.family@example.com','+14165550107','en', 'active',   '77 Davisville Ave, Toronto'),
    (v_org, 'PAT-9008', 'Sofía',   'Herrera',  NULL,    '1990-08-14', 'sofia.demo@example.com',   '+14165550108', 'es', 'inactive', NULL)
  ON CONFLICT DO NOTHING;

  SELECT id INTO v_p1 FROM patients WHERE organization_id=v_org AND patient_number='PAT-9001';
  SELECT id INTO v_p2 FROM patients WHERE organization_id=v_org AND patient_number='PAT-9002';
  SELECT id INTO v_p3 FROM patients WHERE organization_id=v_org AND patient_number='PAT-9003';
  SELECT id INTO v_p4 FROM patients WHERE organization_id=v_org AND patient_number='PAT-9004';
  SELECT id INTO v_s1 FROM patients WHERE organization_id=v_org AND patient_number='PAT-9005';
  SELECT id INTO v_s2 FROM patients WHERE organization_id=v_org AND patient_number='PAT-9006';
  SELECT id INTO v_s3 FROM patients WHERE organization_id=v_org AND patient_number='PAT-9007';

  -- ------------------------------------------------------------- caregivers
  INSERT INTO users (organization_id, email) VALUES (v_org, 'grace.caregiver@example.com') RETURNING id INTO v_u;
  INSERT INTO employees (organization_id, user_id, first_name, last_name, title, is_practitioner, is_caregiver)
  VALUES (v_org, v_u, 'Grace', 'Okafor', 'PSW', false, true) RETURNING id INTO v_cg1;
  INSERT INTO user_roles (organization_id, user_id, role) VALUES (v_org, v_u, 'practitioner');

  INSERT INTO users (organization_id, email) VALUES (v_org, 'martin.caregiver@example.com') RETURNING id INTO v_u;
  INSERT INTO employees (organization_id, user_id, first_name, last_name, title, is_practitioner, is_caregiver)
  VALUES (v_org, v_u, 'Martín', 'Suárez', 'PSW', false, true) RETURNING id INTO v_cg2;
  INSERT INTO user_roles (organization_id, user_id, role) VALUES (v_org, v_u, 'practitioner');

  -- ----------------------------------------------------------- appointments
  -- Non-overlapping slots for the same practitioner (exclusion constraint).
  INSERT INTO appointments (organization_id, patient_id, service_id, employee_id, start_at, end_at, modality, status, estimated_price_cents)
  VALUES
    (v_org, v_p1, v_svc_coaching, v_emp, ((d - 3) + time '10:00') AT TIME ZONE 'America/Toronto', ((d - 3) + time '11:00') AT TIME ZONE 'America/Toronto', 'in_person', 'completed', 15000),
    (v_org, v_p2, v_svc_skin,     v_emp, ((d - 1) + time '14:00') AT TIME ZONE 'America/Toronto', ((d - 1) + time '14:30') AT TIME ZONE 'America/Toronto', 'in_person', 'completed', 9000),
    (v_org, v_p3, v_svc_coaching, v_emp, (d + time '09:30') AT TIME ZONE 'America/Toronto', (d + time '10:30') AT TIME ZONE 'America/Toronto', 'virtual',   'confirmed', 15000),
    (v_org, v_p1, v_svc_skin,     v_emp, (d + time '11:00') AT TIME ZONE 'America/Toronto', (d + time '11:30') AT TIME ZONE 'America/Toronto', 'in_person', 'scheduled', 9000),
    (v_org, v_p4, v_svc_coaching, v_emp, (d + time '15:00') AT TIME ZONE 'America/Toronto', (d + time '16:00') AT TIME ZONE 'America/Toronto', 'in_person', 'scheduled', 15000),
    (v_org, v_p2, v_svc_coaching, v_emp, ((d + 1) + time '10:00') AT TIME ZONE 'America/Toronto', ((d + 1) + time '11:00') AT TIME ZONE 'America/Toronto', 'in_person', 'scheduled', 15000),
    (v_org, v_p3, v_svc_skin,     v_emp, ((d + 2) + time '13:00') AT TIME ZONE 'America/Toronto', ((d + 2) + time '13:30') AT TIME ZONE 'America/Toronto', 'in_person', 'scheduled', 9000),
    (v_org, v_p4, v_svc_coaching, v_emp, ((d - 2) + time '16:00') AT TIME ZONE 'America/Toronto', ((d - 2) + time '17:00') AT TIME ZONE 'America/Toronto', 'in_person', 'no_show', 15000);

  -- Cancelled appointment (kept out of overlap window anyway).
  INSERT INTO appointments (organization_id, patient_id, service_id, employee_id, start_at, end_at, modality, status, estimated_price_cents, cancellation_reason)
  VALUES (v_org, v_p1, v_svc_coaching, v_emp, ((d + 1) + time '15:00') AT TIME ZONE 'America/Toronto', ((d + 1) + time '16:00') AT TIME ZONE 'America/Toronto', 'in_person', 'cancelled', 15000, 'Client rescheduled by phone');

  -- ------------------------------------------------------------- encounters
  SELECT id INTO v_appt FROM appointments WHERE organization_id=v_org AND patient_id=v_p1 AND status='completed' LIMIT 1;
  INSERT INTO encounters (organization_id, appointment_id, patient_id, practitioner_id, service_id, modality, status, started_at, ended_at, content_snapshot, summary, signed_at, signed_by, content_hash)
  SELECT v_org, v_appt, v_p1, v_emp, v_svc_coaching, 'in_person', 'signed',
         ((d - 3) + time '10:00') AT TIME ZONE 'America/Toronto',
         ((d - 3) + time '11:00') AT TIME ZONE 'America/Toronto',
         '{"chief_concern":"Low energy, poor sleep","plan":"Sleep hygiene protocol, B12, follow-up in 2 weeks"}'::jsonb,
         'Initial coaching session — sleep protocol started.',
         ((d - 3) + time '11:05') AT TIME ZONE 'America/Toronto',
         u.id, 'demo-hash-0001'
  FROM employees e JOIN users u ON u.id = e.user_id WHERE e.id = v_emp;

  SELECT id INTO v_appt FROM appointments WHERE organization_id=v_org AND patient_id=v_p2 AND status='completed' LIMIT 1;
  INSERT INTO encounters (organization_id, appointment_id, patient_id, practitioner_id, service_id, modality, status, started_at, content_snapshot, summary)
  VALUES (v_org, v_appt, v_p2, v_emp, v_svc_skin, 'in_person', 'draft',
          ((d - 1) + time '14:00') AT TIME ZONE 'America/Toronto',
          '{"area":"Left shoulder, 2 lesions","assessment":"Benign appearance"}'::jsonb,
          'Skin check — draft pending review.');

  -- ---------------------------------------------------------- home care
  INSERT INTO care_agreements (organization_id, patient_id, status, weekly_minutes, start_date, end_date, hourly_rate_cents, care_plan, address)
  VALUES (v_org, v_s1, 'active', 1200, d - 21, NULL, 3500,
          'Companionship and meal prep. Medication reminders at 12:00. Light mobility exercises after lunch. Spanish-speaking caregiver preferred.',
          '31 Lakeshore Rd, Etobicoke')
  RETURNING id INTO v_ag1;
  INSERT INTO care_agreements (organization_id, patient_id, status, weekly_minutes, start_date, end_date, hourly_rate_cents, care_plan, address)
  VALUES (v_org, v_s2, 'active', 720, d - 10, d + 80, 3800,
          'Post-surgery recovery support: transfers, bathing assistance, walks. Track hydration.',
          '410 Eglinton Ave E, Toronto')
  RETURNING id INTO v_ag2;
  INSERT INTO care_agreements (organization_id, patient_id, status, weekly_minutes, start_date, hourly_rate_cents, care_plan, address)
  VALUES (v_org, v_s3, 'draft', 600, d + 7, 3500,
          'Assessment pending. Family requested mornings only.',
          '77 Davisville Ave, Toronto')
  RETURNING id INTO v_ag3;

  INSERT INTO care_contacts (organization_id, patient_id, name, relationship, phone, email, is_primary, can_approve)
  VALUES
    (v_org, v_s1, 'Carmen Delgado', 'daughter', '+14165550205', 'carmen.demo@example.com', true,  true),
    (v_org, v_s1, 'Luis Delgado',   'son',      '+14165550206', 'luis.demo@example.com',   false, false),
    (v_org, v_s2, 'Susan Bennett',  'daughter', '+14165550207', 'susan.demo@example.com',  true,  true),
    (v_org, v_s3, 'Paolo Moretti',  'son',      '+14165550208', 'paolo.demo@example.com',  true,  false);

  -- Shifts this week (non-overlapping per caregiver).
  INSERT INTO care_shifts (organization_id, agreement_id, patient_id, caregiver_id, start_at, end_at, status, check_in_at, check_out_at, visit_notes)
  VALUES
    -- Rosa (ag1) — Grace weekday mornings
    (v_org, v_ag1, v_s1, v_cg1, ((d - 1) + time '09:00') AT TIME ZONE 'America/Toronto', ((d - 1) + time '13:00') AT TIME ZONE 'America/Toronto', 'completed',
      ((d - 1) + time '08:58') AT TIME ZONE 'America/Toronto', ((d - 1) + time '13:04') AT TIME ZONE 'America/Toronto',
      'Breakfast and lunch prepared. Meds taken at 12:00. Short walk in the garden — good spirits.'),
    (v_org, v_ag1, v_s1, v_cg1, (d + time '09:00') AT TIME ZONE 'America/Toronto', (d + time '13:00') AT TIME ZONE 'America/Toronto', 'confirmed', NULL, NULL, NULL),
    (v_org, v_ag1, v_s1, v_cg1, ((d + 1) + time '09:00') AT TIME ZONE 'America/Toronto', ((d + 1) + time '13:00') AT TIME ZONE 'America/Toronto', 'scheduled', NULL, NULL, NULL),
    (v_org, v_ag1, v_s1, v_cg2, ((d + 2) + time '09:00') AT TIME ZONE 'America/Toronto', ((d + 2) + time '13:00') AT TIME ZONE 'America/Toronto', 'scheduled', NULL, NULL, NULL),
    -- Harold (ag2) — Martín afternoons
    (v_org, v_ag2, v_s2, v_cg2, ((d - 1) + time '15:00') AT TIME ZONE 'America/Toronto', ((d - 1) + time '18:00') AT TIME ZONE 'America/Toronto', 'completed',
      ((d - 1) + time '15:02') AT TIME ZONE 'America/Toronto', ((d - 1) + time '18:00') AT TIME ZONE 'America/Toronto',
      'Assisted with shower. 20-minute walk with walker. Hydration good (5 glasses).'),
    (v_org, v_ag2, v_s2, v_cg2, (d + time '15:00') AT TIME ZONE 'America/Toronto', (d + time '18:00') AT TIME ZONE 'America/Toronto', 'scheduled', NULL, NULL, NULL),
    (v_org, v_ag2, v_s2, v_cg1, ((d + 3) + time '15:00') AT TIME ZONE 'America/Toronto', ((d + 3) + time '18:00') AT TIME ZONE 'America/Toronto', 'scheduled', NULL, NULL, NULL);

  INSERT INTO care_shifts (organization_id, agreement_id, patient_id, caregiver_id, start_at, end_at, status, cancellation_reason)
  VALUES (v_org, v_ag2, v_s2, v_cg1, ((d - 2) + time '15:00') AT TIME ZONE 'America/Toronto', ((d - 2) + time '18:00') AT TIME ZONE 'America/Toronto', 'cancelled', 'Family visit — care not needed');

  -- --------------------------------------------------------------- invoices
  SELECT invoice_number_prefix, invoice_next_sequence INTO v_prefix, v_seq
  FROM company_settings WHERE organization_id = v_org FOR UPDATE;

  -- 1) Paid invoice
  INSERT INTO invoices (organization_id, patient_id, invoice_number, status, issue_date, issued_at, subtotal_cents, tax_cents, total_cents, paid_cents, balance_cents, snapshot)
  VALUES (v_org, v_p1, v_prefix || lpad(v_seq::text, 5, '0'), 'paid',
          ((d - 3) + time '11:30') AT TIME ZONE 'America/Toronto', ((d - 3) + time '11:30') AT TIME ZONE 'America/Toronto',
          15000, 1950, 16950, 16950, 0, '{"demo":true}'::jsonb)
  RETURNING id INTO v_inv;
  INSERT INTO invoice_items (organization_id, invoice_id, description, quantity, unit_price_cents, tax_rate_bps, line_total_cents, service_id)
  VALUES (v_org, v_inv, 'Health Coaching Session', 1, 15000, 1300, 16950, v_svc_coaching);
  INSERT INTO payments (organization_id, patient_id, method, status, amount_cents, received_at)
  VALUES (v_org, v_p1, 'cash', 'confirmed', 16950, ((d - 3) + time '11:35') AT TIME ZONE 'America/Toronto')
  RETURNING id INTO v_pay;
  INSERT INTO payment_allocations (organization_id, payment_id, invoice_id, amount_cents)
  VALUES (v_org, v_pay, v_inv, 16950);

  -- 2) Issued invoice, e-transfer pending verification
  INSERT INTO invoices (organization_id, patient_id, invoice_number, status, issue_date, issued_at, due_date, subtotal_cents, tax_cents, total_cents, paid_cents, balance_cents, snapshot)
  VALUES (v_org, v_p2, v_prefix || lpad((v_seq + 1)::text, 5, '0'), 'issued',
          ((d - 1) + time '15:00') AT TIME ZONE 'America/Toronto', ((d - 1) + time '15:00') AT TIME ZONE 'America/Toronto',
          ((d + 13) + time '23:59') AT TIME ZONE 'America/Toronto',
          9000, 1170, 10170, 0, 10170, '{"demo":true}'::jsonb)
  RETURNING id INTO v_inv;
  INSERT INTO invoice_items (organization_id, invoice_id, description, quantity, unit_price_cents, tax_rate_bps, line_total_cents, service_id)
  VALUES (v_org, v_inv, 'Skin Consultation', 1, 9000, 1300, 10170, v_svc_skin);
  INSERT INTO payments (organization_id, patient_id, method, status, amount_cents, received_at, etransfer_sender_name, etransfer_sender_email, reference)
  VALUES (v_org, v_p2, 'etransfer', 'pending', 10170, (d + time '08:12') AT TIME ZONE 'America/Toronto', 'Daniel Fournier', 'dan.demo@example.com', 'ET-58201');

  -- 3) Draft invoice (home-care hours for Rosa, first week)
  INSERT INTO invoices (organization_id, patient_id, status, subtotal_cents, tax_cents, total_cents, paid_cents, balance_cents)
  VALUES (v_org, v_s1, 'draft', 70000, 0, 70000, 0, 70000)
  RETURNING id INTO v_inv;
  INSERT INTO invoice_items (organization_id, invoice_id, description, quantity, unit_price_cents, tax_rate_bps, line_total_cents)
  VALUES (v_org, v_inv, 'Home care — 20 hours @ $35.00', 20, 3500, 0, 70000);

  UPDATE company_settings SET invoice_next_sequence = v_seq + 2, updated_at = now()
  WHERE organization_id = v_org;

  RAISE NOTICE 'Demo data created.';
END $$;
