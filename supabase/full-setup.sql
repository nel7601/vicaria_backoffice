-- =====================================================================
-- Vicaria Backoffice — Full database setup
-- Run this ONCE in the Supabase SQL Editor (Dashboard → SQL Editor → New query
-- → paste all → Run). It creates every table, security policy and the initial
-- organization/settings so the app is ready to use.
--
-- Safe to read top to bottom. It does NOT contain any secret.
-- =====================================================================

-- ############ 1/5  SCHEMA (tables, enums, constraints) ############
CREATE TYPE "public"."appointment_modality" AS ENUM('in_person', 'virtual', 'phone');--> statement-breakpoint
CREATE TYPE "public"."appointment_status" AS ENUM('scheduled', 'confirmed', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show', 'rescheduled');--> statement-breakpoint
CREATE TYPE "public"."body_side" AS ENUM('left', 'right', 'central', 'n_a');--> statement-breakpoint
CREATE TYPE "public"."cash_session_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."communication_channel" AS ENUM('email', 'phone', 'whatsapp', 'in_person', 'note');--> statement-breakpoint
CREATE TYPE "public"."communication_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."consent_method" AS ENUM('written', 'verbal', 'electronic');--> statement-breakpoint
CREATE TYPE "public"."consent_status" AS ENUM('active', 'withdrawn', 'expired');--> statement-breakpoint
CREATE TYPE "public"."consent_type" AS ENUM('care', 'privacy', 'communications', 'marketing', 'procedure', 'photography');--> statement-breakpoint
CREATE TYPE "public"."document_access_level" AS ENUM('administrative', 'clinical', 'financial', 'restricted');--> statement-breakpoint
CREATE TYPE "public"."encounter_status" AS ENUM('draft', 'signed', 'amended', 'entered_in_error');--> statement-breakpoint
CREATE TYPE "public"."follow_up_task_status" AS ENUM('open', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."goal_status" AS ENUM('not_started', 'in_progress', 'achieved', 'missed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'issued', 'partially_paid', 'paid', 'overdue', 'void', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."package_enrollment_status" AS ENUM('active', 'exhausted', 'expired', 'paused', 'transferred', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."patient_status" AS ENUM('prospect', 'active', 'inactive', 'blocked', 'deceased');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'e_transfer', 'square_card', 'square_invoice', 'debit', 'credit', 'other');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'confirmed', 'failed', 'cancelled', 'partially_refunded', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."preferred_language" AS ENUM('en', 'es');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('owner', 'administrator', 'practitioner', 'reception', 'billing', 'marketing', 'auditor');--> statement-breakpoint
CREATE TYPE "public"."skin_lesion_complexity" AS ENUM('simple', 'moderate', 'complex');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."treatment_plan_status" AS ENUM('draft', 'active', 'paused', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "company_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"address" text,
	"phone" varchar(32),
	"email" varchar(255),
	"website" varchar(255),
	"logo_storage_path" text,
	"invoice_number_prefix" varchar(16) DEFAULT 'INV-',
	"invoice_next_sequence" integer DEFAULT 1 NOT NULL,
	"tax_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"legal_footer_en" text,
	"legal_footer_es" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"address" text,
	"phone" varchar(32),
	"timezone" varchar(64) DEFAULT 'America/Toronto' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"open_time" time,
	"close_time" time,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legal_name" varchar(200) NOT NULL,
	"operating_name" varchar(200),
	"timezone" varchar(64) DEFAULT 'America/Toronto' NOT NULL,
	"currency" varchar(3) DEFAULT 'CAD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"first_name" varchar(120) NOT NULL,
	"last_name" varchar(120) NOT NULL,
	"title" varchar(120),
	"photo_storage_path" text,
	"signature_storage_path" text,
	"languages" jsonb DEFAULT '["en"]'::jsonb NOT NULL,
	"is_practitioner" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "role" NOT NULL,
	"location_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"auth_user_id" uuid,
	"email" varchar(255) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"mfa_enrolled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_auth_user_id_unique" UNIQUE("auth_user_id")
);
--> statement-breakpoint
CREATE TABLE "patient_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"label" varchar(160) NOT NULL,
	"severity" varchar(20) DEFAULT 'info' NOT NULL,
	"is_clinical" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"consent_type" "consent_type" NOT NULL,
	"document_version" varchar(40) NOT NULL,
	"method" "consent_method" NOT NULL,
	"status" "consent_status" DEFAULT 'active' NOT NULL,
	"scope" text,
	"signed_at" timestamp with time zone,
	"witness_name" varchar(200),
	"signature_storage_path" text,
	"withdrawn_at" timestamp with time zone,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"tag" varchar(60) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_patient_tag" UNIQUE("patient_id","tag")
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_number" varchar(32) NOT NULL,
	"legal_first_name" varchar(120) NOT NULL,
	"legal_last_name" varchar(120) NOT NULL,
	"preferred_name" varchar(120),
	"pronouns" varchar(40),
	"date_of_birth" date,
	"email" varchar(255),
	"phone_e164" varchar(20),
	"address" text,
	"preferred_language" "preferred_language" DEFAULT 'en' NOT NULL,
	"status" "patient_status" DEFAULT 'prospect' NOT NULL,
	"marketing_opt_in" boolean DEFAULT false NOT NULL,
	"emergency_contact_name" varchar(200),
	"emergency_contact_phone" varchar(20),
	"acquisition_source" varchar(120),
	"primary_practitioner_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "uq_patient_number" UNIQUE("organization_id","patient_number")
);
--> statement-breakpoint
CREATE TABLE "package_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"invoice_id" uuid,
	"status" "package_enrollment_status" DEFAULT 'active' NOT NULL,
	"total_sessions" integer NOT NULL,
	"sessions_used" integer DEFAULT 0 NOT NULL,
	"purchased_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "package_session_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"encounter_id" uuid,
	"delta" integer NOT NULL,
	"reason" text,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name_en" varchar(160) NOT NULL,
	"name_es" varchar(160) NOT NULL,
	"price_cents" integer NOT NULL,
	"total_sessions" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"validity_days" integer,
	"transferable" boolean DEFAULT false NOT NULL,
	"refundable" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"price_cents" integer NOT NULL,
	"tax_rate_bps" integer DEFAULT 0 NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name_en" varchar(160) NOT NULL,
	"name_es" varchar(160) NOT NULL,
	"category" varchar(80),
	"default_duration_minutes" integer DEFAULT 60 NOT NULL,
	"modality" "appointment_modality" DEFAULT 'in_person' NOT NULL,
	"accounting_code" varchar(40),
	"tax_code" varchar(40),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointment_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"from_status" "appointment_status",
	"to_status" "appointment_status" NOT NULL,
	"reason" text,
	"changed_by" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"service_id" uuid,
	"employee_id" uuid NOT NULL,
	"location_id" uuid,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"modality" "appointment_modality" DEFAULT 'in_person' NOT NULL,
	"status" "appointment_status" DEFAULT 'scheduled' NOT NULL,
	"estimated_price_cents" integer DEFAULT 0 NOT NULL,
	"cancellation_reason" text,
	"rescheduled_from_id" uuid,
	"notes_admin" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "encounter_amendments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"encounter_id" uuid NOT NULL,
	"body" text NOT NULL,
	"authored_by" uuid NOT NULL,
	"authored_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content_hash" varchar(128)
);
--> statement-breakpoint
CREATE TABLE "encounter_template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "encounter_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"service_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "encounters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"appointment_id" uuid,
	"patient_id" uuid NOT NULL,
	"practitioner_id" uuid NOT NULL,
	"service_id" uuid,
	"template_version_id" uuid,
	"modality" "appointment_modality" DEFAULT 'in_person' NOT NULL,
	"status" "encounter_status" DEFAULT 'draft' NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"content_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"summary" text,
	"signed_at" timestamp with time zone,
	"signed_by" uuid,
	"content_hash" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"encounter_id" uuid,
	"observation_type" varchar(80) NOT NULL,
	"value_numeric" integer,
	"value_text" text,
	"unit" varchar(32),
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" varchar(60),
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follow_up_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"task_type" varchar(60),
	"assigned_to" uuid,
	"due_date" timestamp with time zone,
	"priority" "task_priority" DEFAULT 'normal' NOT NULL,
	"status" "follow_up_task_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skin_lesions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"procedure_id" uuid NOT NULL,
	"lesion_type" varchar(120) NOT NULL,
	"size_mm" integer,
	"quantity" integer DEFAULT 1 NOT NULL,
	"location" varchar(120),
	"side" "body_side" DEFAULT 'n_a' NOT NULL,
	"complexity" "skin_lesion_complexity" DEFAULT 'simple' NOT NULL,
	"unit_price_cents" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skin_procedures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"encounter_id" uuid,
	"practitioner_id" uuid NOT NULL,
	"procedure_type" varchar(120) NOT NULL,
	"body_area" varchar(120),
	"technique" varchar(120),
	"performed_at" timestamp with time zone,
	"result" text,
	"aftercare_instructions" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treatment_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"description" text NOT NULL,
	"baseline" varchar(120),
	"target" varchar(120),
	"status" "goal_status" DEFAULT 'not_started' NOT NULL,
	"target_date" timestamp with time zone,
	"last_progress_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treatment_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"objective" text,
	"status" "treatment_plan_status" DEFAULT 'draft' NOT NULL,
	"responsible_id" uuid,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"cash_session_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"kind" varchar(40) NOT NULL,
	"payment_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid,
	"status" "cash_session_status" DEFAULT 'open' NOT NULL,
	"opening_float_cents" integer DEFAULT 0 NOT NULL,
	"expected_cents" integer,
	"counted_cents" integer,
	"difference_cents" integer,
	"opened_by" uuid,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"reason" text,
	"issued_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"description" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"discount_cents" integer DEFAULT 0 NOT NULL,
	"tax_rate_bps" integer DEFAULT 0 NOT NULL,
	"line_total_cents" integer NOT NULL,
	"service_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"invoice_number" varchar(40),
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"issue_date" timestamp with time zone,
	"due_date" timestamp with time zone,
	"subtotal_cents" integer DEFAULT 0 NOT NULL,
	"discount_cents" integer DEFAULT 0 NOT NULL,
	"tax_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"paid_cents" integer DEFAULT 0 NOT NULL,
	"balance_cents" integer DEFAULT 0 NOT NULL,
	"currency" char(3) DEFAULT 'CAD' NOT NULL,
	"language" "preferred_language" DEFAULT 'en' NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"issued_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_invoice_total_nonneg" CHECK ("invoices"."total_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" char(3) DEFAULT 'CAD' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_by" uuid,
	"external_provider" varchar(40),
	"external_id" varchar(120),
	"reference" varchar(120),
	"etransfer_sender_name" varchar(200),
	"etransfer_sender_email" varchar(255),
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"cash_session_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_payment_amount_pos" CHECK ("payments"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"invoice_id" uuid,
	"receipt_number" varchar(40),
	"amount_cents" integer NOT NULL,
	"language" "preferred_language" DEFAULT 'en' NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"reason" text,
	"external_provider" varchar(40),
	"external_id" varchar(120),
	"processed_by" uuid,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "communications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"channel" "communication_channel" NOT NULL,
	"direction" "communication_direction" DEFAULT 'outbound' NOT NULL,
	"subject" varchar(200),
	"outcome" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_id" uuid,
	"category" varchar(60) NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"mime_type" varchar(120),
	"size_bytes" integer,
	"sha256" varchar(64),
	"storage_path" text NOT NULL,
	"access_level" "document_access_level" DEFAULT 'administrative' NOT NULL,
	"requires_consent" boolean DEFAULT false NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "square_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"square_payment_id" varchar(120) NOT NULL,
	"square_order_id" varchar(120),
	"square_customer_id" varchar(120),
	"status" varchar(40),
	"amount_cents" integer,
	"tender" varchar(40),
	"payment_id" uuid,
	"reconciled" boolean DEFAULT false NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_square_payment" UNIQUE("square_payment_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"provider" varchar(40) NOT NULL,
	"event_id" varchar(160) NOT NULL,
	"event_type" varchar(120),
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_webhook_event" UNIQUE("provider","event_id")
);
--> statement-breakpoint
CREATE TABLE "access_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" uuid,
	"actor_user_id" uuid,
	"patient_id" uuid,
	"action" varchar(60) NOT NULL,
	"route" varchar(200),
	"purpose" varchar(120),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" uuid,
	"actor_user_id" uuid,
	"action" varchar(60) NOT NULL,
	"entity_type" varchar(80) NOT NULL,
	"entity_id" varchar(80),
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"ip_hash" varchar(64),
	"user_agent" varchar(255),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "privacy_requests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" uuid,
	"patient_id" uuid,
	"request_type" varchar(40) NOT NULL,
	"status" varchar(40) DEFAULT 'open' NOT NULL,
	"assigned_to" uuid,
	"due_date" timestamp with time zone,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_alerts" ADD CONSTRAINT "patient_alerts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_alerts" ADD CONSTRAINT "patient_alerts_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_consents" ADD CONSTRAINT "patient_consents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_consents" ADD CONSTRAINT "patient_consents_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_consents" ADD CONSTRAINT "patient_consents_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_tags" ADD CONSTRAINT "patient_tags_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_tags" ADD CONSTRAINT "patient_tags_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_primary_practitioner_id_employees_id_fk" FOREIGN KEY ("primary_practitioner_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_enrollments" ADD CONSTRAINT "package_enrollments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_enrollments" ADD CONSTRAINT "package_enrollments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_enrollments" ADD CONSTRAINT "package_enrollments_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_session_usage" ADD CONSTRAINT "package_session_usage_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_session_usage" ADD CONSTRAINT "package_session_usage_enrollment_id_package_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."package_enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_session_usage" ADD CONSTRAINT "package_session_usage_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_prices" ADD CONSTRAINT "service_prices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_prices" ADD CONSTRAINT "service_prices_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_status_history" ADD CONSTRAINT "appointment_status_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_status_history" ADD CONSTRAINT "appointment_status_history_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_status_history" ADD CONSTRAINT "appointment_status_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_amendments" ADD CONSTRAINT "encounter_amendments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_amendments" ADD CONSTRAINT "encounter_amendments_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_amendments" ADD CONSTRAINT "encounter_amendments_authored_by_users_id_fk" FOREIGN KEY ("authored_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_template_versions" ADD CONSTRAINT "encounter_template_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_template_versions" ADD CONSTRAINT "encounter_template_versions_template_id_encounter_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."encounter_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_template_versions" ADD CONSTRAINT "encounter_template_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_templates" ADD CONSTRAINT "encounter_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_templates" ADD CONSTRAINT "encounter_templates_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_practitioner_id_employees_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_template_version_id_encounter_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."encounter_template_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_signed_by_users_id_fk" FOREIGN KEY ("signed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_tasks" ADD CONSTRAINT "follow_up_tasks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_tasks" ADD CONSTRAINT "follow_up_tasks_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_tasks" ADD CONSTRAINT "follow_up_tasks_assigned_to_employees_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skin_lesions" ADD CONSTRAINT "skin_lesions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skin_lesions" ADD CONSTRAINT "skin_lesions_procedure_id_skin_procedures_id_fk" FOREIGN KEY ("procedure_id") REFERENCES "public"."skin_procedures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skin_procedures" ADD CONSTRAINT "skin_procedures_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skin_procedures" ADD CONSTRAINT "skin_procedures_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skin_procedures" ADD CONSTRAINT "skin_procedures_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skin_procedures" ADD CONSTRAINT "skin_procedures_practitioner_id_employees_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_goals" ADD CONSTRAINT "treatment_goals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_goals" ADD CONSTRAINT "treatment_goals_plan_id_treatment_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."treatment_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_responsible_id_employees_id_fk" FOREIGN KEY ("responsible_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_cash_session_id_cash_sessions_id_fk" FOREIGN KEY ("cash_session_id") REFERENCES "public"."cash_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_processed_by_users_id_fk" FOREIGN KEY ("processed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "square_transactions" ADD CONSTRAINT "square_transactions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "square_transactions" ADD CONSTRAINT "square_transactions_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_logs" ADD CONSTRAINT "access_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_logs" ADD CONSTRAINT "access_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_invoice_number" ON "invoices" USING btree ("organization_id","invoice_number") WHERE "invoices"."invoice_number" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payment_external" ON "payments" USING btree ("external_provider","external_id") WHERE "payments"."external_id" IS NOT NULL;
-- ############ 2/5  INDEXES + RLS ENABLED ############
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

-- ############ 3/5  RLS POLICIES + IMMUTABILITY TRIGGERS ############
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

-- ############ 4/5  RECEIPTS ADJUSTMENT ############
-- Allow invoice-level receipts that aggregate confirmed payments (§FR-REC-001).
-- A per-payment receipt still sets payment_id; an invoice-level one leaves it null.
ALTER TABLE receipts ALTER COLUMN payment_id DROP NOT NULL;

-- ############ 5/5  INITIAL DATA (organization, settings, location, template) ############
-- EDIT the values below to match Vicaria before running (name, email, tax rate,
-- invoice prefix). Amounts/rates: rate_bps 1300 = 13% (HST Ontario).
with org as (
  insert into organizations (legal_name, operating_name, timezone, currency)
  values ('Vicaria Health Inc.', 'Vicaria Health', 'America/Toronto', 'CAD')
  returning id
),
cs as (
  insert into company_settings
    (organization_id, email, invoice_number_prefix, invoice_next_sequence, tax_config)
  select id, 'hello@vicariahealth.com', 'VIC-', 1000, '{"HST":{"rate_bps":1300}}'::jsonb
  from org
),
loc as (
  insert into locations (organization_id, name, timezone)
  select id, 'Main Clinic', 'America/Toronto' from org
),
tpl as (
  insert into encounter_templates (organization_id, name)
  select id, 'Coaching Session Note' from org
  returning id, organization_id
)
insert into encounter_template_versions
  (organization_id, template_id, version, schema, published_at)
select organization_id, id, 1,
  '{"fields":[
     {"key":"chief_complaint","label":"Chief complaint","type":"textarea","required":true},
     {"key":"weight","label":"Weight","type":"number","min":0,"max":500},
     {"key":"mood","label":"Mood","type":"select","options":["good","neutral","low"]},
     {"key":"pain","label":"Pain (0-10)","type":"scale","min":0,"max":10},
     {"key":"plan_notes","label":"Plan notes","type":"textarea"}
   ]}'::jsonb,
  now()
from tpl;

-- Verify: this should return 1 organization and a bunch of tables.
select 'organizations' as check, count(*) from organizations
union all select 'company_settings', count(*) from company_settings
union all select 'locations', count(*) from locations
union all select 'encounter_template_versions', count(*) from encounter_template_versions;
