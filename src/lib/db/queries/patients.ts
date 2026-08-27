import { and, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  appointments,
  invoices,
  patientConsents,
  patients,
} from "@/lib/db/schema";
import type { DuplicateCandidate } from "@/lib/domain/patient";

export interface ListPatientsParams {
  organizationId: string;
  search?: string;
  /** Restrict to a practitioner's assigned patients (practitioner scope). */
  assignedEmployeeId?: string;
  /** Marketing scope: only opted-in patients. */
  marketingOnly?: boolean;
  /**
   * Service line filter: "care" = has a home-care agreement; "clinic" =
   * has clinic activity (appointments/encounters) or no care agreement.
   */
  service?: "clinic" | "care";
  status?: string;
  limit?: number;
}

/** EXISTS: patient has at least one home-care agreement. */
const hasCareSql = sql<boolean>`EXISTS (
  SELECT 1 FROM care_agreements ca WHERE ca.patient_id = ${patients.id}
)`;

/** EXISTS: patient has clinic activity (appointments or encounters). */
const hasClinicSql = sql<boolean>`(EXISTS (
  SELECT 1 FROM appointments ap WHERE ap.patient_id = ${patients.id}
) OR EXISTS (
  SELECT 1 FROM encounters en WHERE en.patient_id = ${patients.id}
))`;

function buildPatientConditions(
  params: Omit<ListPatientsParams, "limit">,
) {
  const conditions = [eq(patients.organizationId, params.organizationId)];

  if (params.search && params.search.trim().length > 0) {
    const q = `%${params.search.trim()}%`;
    conditions.push(
      or(
        ilike(patients.legalFirstName, q),
        ilike(patients.legalLastName, q),
        ilike(patients.email, q),
        ilike(patients.phoneE164, q),
        ilike(patients.patientNumber, q),
      )!,
    );
  }
  if (params.assignedEmployeeId) {
    conditions.push(eq(patients.primaryPractitionerId, params.assignedEmployeeId));
  }
  if (params.marketingOnly) {
    conditions.push(eq(patients.marketingOptIn, true));
  }
  if (params.status) {
    conditions.push(
      sql`${patients.status} = ${params.status}::patient_status`,
    );
  }
  if (params.service === "care") {
    conditions.push(sql`${hasCareSql}`);
  } else if (params.service === "clinic") {
    // Clinic = has clinic activity, or is not a home-care client at all.
    conditions.push(sql`(${hasClinicSql} OR NOT ${hasCareSql})`);
  }

  return conditions;
}

export async function listPatients(params: ListPatientsParams) {
  const db = getDb();
  const conditions = buildPatientConditions(params);

  return db
    .select({
      id: patients.id,
      patientNumber: patients.patientNumber,
      legalFirstName: patients.legalFirstName,
      legalLastName: patients.legalLastName,
      preferredName: patients.preferredName,
      email: patients.email,
      phoneE164: patients.phoneE164,
      status: patients.status,
      preferredLanguage: patients.preferredLanguage,
      hasCare: hasCareSql,
      hasClinic: hasClinicSql,
    })
    .from(patients)
    .where(and(...conditions))
    .orderBy(desc(patients.createdAt))
    .limit(params.limit ?? 50);
}

/** Paginated variant of listPatients with a total count for the pager. */
export async function listPatientsPaged(
  params: Omit<ListPatientsParams, "limit"> & { page: number; pageSize: number },
) {
  const db = getDb();
  const conditions = buildPatientConditions(params);

  const [{ n: total }] = await db
    .select({ n: count() })
    .from(patients)
    .where(and(...conditions));

  const rows = await db
    .select({
      id: patients.id,
      patientNumber: patients.patientNumber,
      legalFirstName: patients.legalFirstName,
      legalLastName: patients.legalLastName,
      preferredName: patients.preferredName,
      email: patients.email,
      phoneE164: patients.phoneE164,
      status: patients.status,
      preferredLanguage: patients.preferredLanguage,
      hasCare: hasCareSql,
      hasClinic: hasClinicSql,
    })
    .from(patients)
    .where(and(...conditions))
    .orderBy(desc(patients.createdAt))
    .limit(params.pageSize)
    .offset((params.page - 1) * params.pageSize);

  return { rows, total: Number(total ?? 0) };
}

export async function getPatientById(organizationId: string, id: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(patients)
    .where(and(eq(patients.organizationId, organizationId), eq(patients.id, id)))
    .limit(1);
  return row ?? null;
}

/** Candidate set for duplicate detection (FR-PAT-002). */
export async function findDuplicateCandidates(
  organizationId: string,
  query: {
    email?: string | null;
    phoneE164?: string | null;
    legalLastName?: string | null;
  },
): Promise<DuplicateCandidate[]> {
  const db = getDb();
  const ors = [];
  if (query.email) ors.push(eq(patients.email, query.email));
  if (query.phoneE164) ors.push(eq(patients.phoneE164, query.phoneE164));
  if (query.legalLastName)
    ors.push(ilike(patients.legalLastName, query.legalLastName));
  if (ors.length === 0) return [];

  return db
    .select({
      id: patients.id,
      email: patients.email,
      phoneE164: patients.phoneE164,
      legalFirstName: patients.legalFirstName,
      legalLastName: patients.legalLastName,
      dateOfBirth: patients.dateOfBirth,
    })
    .from(patients)
    .where(and(eq(patients.organizationId, organizationId), or(...ors)))
    .limit(25);
}

export async function nextPatientSequence(
  organizationId: string,
): Promise<number> {
  const db = getDb();
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(patients)
    .where(eq(patients.organizationId, organizationId));
  return (count ?? 0) + 1;
}

/** Patient 360 aggregate (FR-PAT-003): profile + recent related records. */
export async function getPatient360(organizationId: string, id: string) {
  const db = getDb();
  const patient = await getPatientById(organizationId, id);
  if (!patient) return null;

  const [upcoming, recentInvoices, consents] = await Promise.all([
    db
      .select({
        id: appointments.id,
        startAt: appointments.startAt,
        endAt: appointments.endAt,
        status: appointments.status,
        modality: appointments.modality,
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.organizationId, organizationId),
          eq(appointments.patientId, id),
        ),
      )
      .orderBy(desc(appointments.startAt))
      .limit(10),
    db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        status: invoices.status,
        totalCents: invoices.totalCents,
        balanceCents: invoices.balanceCents,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.organizationId, organizationId),
          eq(invoices.patientId, id),
        ),
      )
      .orderBy(desc(invoices.createdAt))
      .limit(10),
    db
      .select()
      .from(patientConsents)
      .where(
        and(
          eq(patientConsents.organizationId, organizationId),
          eq(patientConsents.patientId, id),
        ),
      ),
  ]);

  return { patient, appointments: upcoming, invoices: recentInvoices, consents };
}
