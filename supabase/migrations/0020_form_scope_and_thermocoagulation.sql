-- Form scope + the Thermocoagulation forms.
--
-- 1. Templates gain a scope. A release of liability is signed by the patient
--    and kept on file, but it is not clinical history: it belongs to the
--    patient's administrative file, not to the chart's Evolution or to an
--    encounter note. Everything that existed stays 'clinical'.
-- 2. Loads the two pages of Thermocoagulation_Client_Form_EN.docx: the client
--    form (clinical) and the Vasculyze 2G release of liability
--    (administrative). The third page, the take-home care instructions, is a
--    handout with nothing to record, so it is not a form.
-- 3. Drops the Spanish Health History; only the English one is kept. It is
--    deleted when nothing ever used it, and archived otherwise — answers
--    already collected are never destroyed.
CREATE TYPE "template_scope" AS ENUM ('clinical', 'administrative');--> statement-breakpoint
ALTER TABLE encounter_templates
  ADD COLUMN scope "template_scope" NOT NULL DEFAULT 'clinical';--> statement-breakpoint

DO $$
DECLARE
  org uuid;
  tpl uuid;
  used integer;
BEGIN
  FOR org IN SELECT id FROM organizations LOOP
    -- Page 1 — clinical intake and skin analysis.
    IF NOT EXISTS (
      SELECT 1 FROM encounter_templates
       WHERE organization_id = org AND name = 'Thermocoagulation Client Form'
    ) THEN
      INSERT INTO encounter_templates (organization_id, name, scope)
      VALUES (org, 'Thermocoagulation Client Form', 'clinical')
      RETURNING id INTO tpl;
      INSERT INTO encounter_template_versions
        (organization_id, template_id, version, schema, published_at)
      VALUES (org, tpl, 1, '[{"key":"h_history","label":"Treatment history","type":"heading"},{"key":"date_of_first_visit","label":"Date of first visit","type":"date"},{"key":"previous_treatment","label":"Have you received treatment for skin lesions before?","type":"select","options":["Yes","No"]},{"key":"previous_treatment_type","label":"What type of treatment did you use?","type":"text"},{"key":"previous_treatment_result","label":"What result did you obtain?","type":"textarea"},{"key":"previous_skin_reaction","label":"How did your skin react to the treatment?","type":"textarea"},{"key":"h_medical","label":"Medical information — do you suffer from any of the following conditions?","type":"heading"},{"key":"cond_diabetes_mellitus","label":"Diabetes mellitus","type":"checkbox"},{"key":"cond_high_blood_pressure","label":"High blood pressure","type":"checkbox"},{"key":"cond_hemophilia","label":"Hemophilia","type":"checkbox"},{"key":"cond_hepatitis","label":"Hepatitis","type":"checkbox"},{"key":"cond_epilepsy","label":"Epilepsy","type":"checkbox"},{"key":"cond_rosacea","label":"Rosacea","type":"checkbox"},{"key":"cond_pacemaker","label":"Pacemaker","type":"checkbox"},{"key":"cond_scleroderma","label":"Scleroderma","type":"checkbox"},{"key":"cond_allergies","label":"Allergies","type":"checkbox"},{"key":"cond_hiv","label":"HIV","type":"checkbox"},{"key":"cond_aids","label":"AIDS","type":"checkbox"},{"key":"h_skin_analysis","label":"Skin analysis","type":"heading"},{"key":"telangiectasia_size","label":"Telangiectasia — size","type":"select","options":["Small","Medium","Large"]},{"key":"telangiectasia_depth","label":"Telangiectasia — depth","type":"select","options":["Superficial or red","Purple or deep"]},{"key":"vascular_moles","label":"Red spots or vascular moles","type":"select","options":["Raised","Flat"]},{"key":"warts_or_skin_tags","label":"Warts or skin tags","type":"select","options":["Thick stem","Thin stem","Flat"]},{"key":"hyperpigmentation_relief","label":"Hyperpigmentation — relief","type":"select","options":["Flat","Thickened"]},{"key":"hyperpigmentation_degree","label":"Hyperpigmentation — degree","type":"select","options":["Highly pigmented","Moderately pigmented","Not pigmented"]},{"key":"cholesterol_deposits","label":"Cholesterol deposits","type":"checkbox"},{"key":"millium","label":"Millium","type":"checkbox"},{"key":"other_lesions","label":"Other lesions","type":"text"},{"key":"lesion_location","label":"Location","type":"text"},{"key":"h_post_treatment","label":"Post-treatment reaction","type":"heading"},{"key":"post_treatment_reaction","label":"Post-treatment reaction","type":"textarea"},{"key":"h_declaration","label":"Declaration","type":"heading"},{"key":"declaration_signed_by","label":"I declare that I have answered the questionnaire to the best of my knowledge — signed by","type":"text","required":true},{"key":"declaration_signed_on","label":"Date signed","type":"date","required":true}]'::jsonb, now());
    END IF;

    -- Page 2 — consent kept on the patient's file, not in the chart.
    IF NOT EXISTS (
      SELECT 1 FROM encounter_templates
       WHERE organization_id = org AND name = 'Vasculyze 2G — Release of Liability'
    ) THEN
      INSERT INTO encounter_templates (organization_id, name, scope)
      VALUES (org, 'Vasculyze 2G — Release of Liability', 'administrative')
      RETURNING id INTO tpl;
      INSERT INTO encounter_template_versions
        (organization_id, template_id, version, schema, published_at)
      VALUES (org, tpl, 1, '[{"key":"h_consent","label":"Patient consent — initial each statement","type":"heading"},{"key":"ack_read_and_agree","label":"I have read the information and agree to receive treatment with Vasculyze. Its nature and purpose have been explained to me and my questions have been answered.","type":"checkbox","required":true},{"key":"ack_no_contraindications","label":"I have no conditions that contraindicate the treatment, such as pacemaker, metal implants, diabetes, pregnancy, healing disorders, or use of anticoagulants.","type":"checkbox","required":true},{"key":"ack_assume_risks","label":"I understand that with any treatment there are risks, complications or side effects of known or unknown causes, and I freely assume these risks.","type":"checkbox","required":true},{"key":"ack_side_effects","label":"I understand side effects may include redness, swelling, bruising, pain, burning sensation, skin darkening or infection, and that most are temporary and disappear within one to three weeks.","type":"checkbox","required":true},{"key":"ack_scab_and_sun_care","label":"I have been advised not to touch, scratch or remove the scabs and to let them fall off naturally, to keep the area clean, to avoid sun exposure for one week, and to use moisturizing or healing products and sunscreen until it is fully healed.","type":"checkbox","required":true},{"key":"ack_received_instructions","label":"I have received a copy of the post-treatment care instructions.","type":"checkbox","required":true},{"key":"ack_defer_while_active_eruption","label":"I will not receive treatment if I have herpes simplex type 1 (oral), inflammatory acne or other eruptions, until my skin is completely healed.","type":"checkbox","required":true},{"key":"ack_follow_home_care","label":"I agree to follow the home care instructions recommended by my therapist and will inform them immediately of any concern or complication that may arise.","type":"checkbox","required":true},{"key":"ack_over_18","label":"I am over 18 years of age.","type":"checkbox","required":true},{"key":"ack_no_guaranteed_outcome","label":"I understand that although satisfactory results are usually achieved with a single treatment, it may need to be repeated, and that the outcome cannot be guaranteed.","type":"checkbox","required":true},{"key":"h_signatures","label":"Signatures","type":"heading"},{"key":"patient_name","label":"Patient name","type":"text","required":true},{"key":"patient_phone","label":"Patient phone","type":"text"},{"key":"patient_signed_on","label":"Patient signature date","type":"date","required":true},{"key":"witness_name","label":"Witness name","type":"text"},{"key":"witness_signed_on","label":"Witness signature date","type":"date"}]'::jsonb, now());
    END IF;

    -- Retire the Spanish Health History.
    tpl := NULL;
    SELECT id INTO tpl FROM encounter_templates
     WHERE organization_id = org AND name = 'Historia de Salud (ES)';
    IF tpl IS NOT NULL THEN
      SELECT count(*) INTO used FROM (
        SELECT 1 FROM encounters e
          JOIN encounter_template_versions v ON v.id = e.template_version_id
         WHERE v.template_id = tpl
        UNION ALL
        SELECT 1 FROM patient_forms pf
          JOIN encounter_template_versions v ON v.id = pf.template_version_id
         WHERE v.template_id = tpl
      ) q;
      IF used = 0 THEN
        DELETE FROM encounter_template_versions WHERE template_id = tpl;
        DELETE FROM encounter_templates WHERE id = tpl;
      ELSE
        UPDATE encounter_templates
           SET archived_at = now(), updated_at = now()
         WHERE id = tpl AND archived_at IS NULL;
      END IF;
    END IF;
  END LOOP;
END $$;
