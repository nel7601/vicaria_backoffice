import { and, desc, eq, gte, lt, ne } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  careAgreements,
  careContacts,
  careShifts,
  employees,
  patients,
} from "@/lib/db/schema";

/** Agreements with client names, newest first. */
export async function listCareAgreements(organizationId: string) {
  const db = getDb();
  return db
    .select({
      id: careAgreements.id,
      status: careAgreements.status,
      weeklyMinutes: careAgreements.weeklyMinutes,
      startDate: careAgreements.startDate,
      endDate: careAgreements.endDate,
      hourlyRateCents: careAgreements.hourlyRateCents,
      patientId: patients.id,
      patientFirst: patients.legalFirstName,
      patientLast: patients.legalLastName,
      patientNumber: patients.patientNumber,
    })
    .from(careAgreements)
    .innerJoin(patients, eq(patients.id, careAgreements.patientId))
    .where(eq(careAgreements.organizationId, organizationId))
    .orderBy(desc(careAgreements.createdAt));
}

export async function getCareAgreement(organizationId: string, id: string) {
  const db = getDb();
  const [row] = await db
    .select({
      id: careAgreements.id,
      status: careAgreements.status,
      weeklyMinutes: careAgreements.weeklyMinutes,
      startDate: careAgreements.startDate,
      endDate: careAgreements.endDate,
      hourlyRateCents: careAgreements.hourlyRateCents,
      currency: careAgreements.currency,
      carePlan: careAgreements.carePlan,
      address: careAgreements.address,
      patientId: patients.id,
      patientFirst: patients.legalFirstName,
      patientLast: patients.legalLastName,
      patientNumber: patients.patientNumber,
    })
    .from(careAgreements)
    .innerJoin(patients, eq(patients.id, careAgreements.patientId))
    .where(
      and(
        eq(careAgreements.organizationId, organizationId),
        eq(careAgreements.id, id),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listCareContacts(
  organizationId: string,
  patientId: string,
) {
  const db = getDb();
  return db
    .select()
    .from(careContacts)
    .where(
      and(
        eq(careContacts.organizationId, organizationId),
        eq(careContacts.patientId, patientId),
      ),
    )
    .orderBy(desc(careContacts.isPrimary), careContacts.name);
}

/** Shifts of one agreement inside [from, to), with caregiver names. */
export async function listAgreementShifts(
  organizationId: string,
  agreementId: string,
  from: Date,
  to: Date,
) {
  const db = getDb();
  return db
    .select({
      id: careShifts.id,
      startAt: careShifts.startAt,
      endAt: careShifts.endAt,
      status: careShifts.status,
      checkInAt: careShifts.checkInAt,
      checkOutAt: careShifts.checkOutAt,
      visitNotes: careShifts.visitNotes,
      tasks: careShifts.tasks,
      approvedMinutes: careShifts.approvedMinutes,
      caregiverId: careShifts.caregiverId,
      caregiverFirst: employees.firstName,
      caregiverLast: employees.lastName,
    })
    .from(careShifts)
    .innerJoin(employees, eq(employees.id, careShifts.caregiverId))
    .where(
      and(
        eq(careShifts.organizationId, organizationId),
        eq(careShifts.agreementId, agreementId),
        gte(careShifts.startAt, from),
        lt(careShifts.startAt, to),
      ),
    )
    .orderBy(careShifts.startAt);
}

/** All shifts inside a window, org-wide (schedule board), optional caregiver. */
export async function listShiftsInWindow(params: {
  organizationId: string;
  from: Date;
  to: Date;
  caregiverId?: string;
}) {
  const db = getDb();
  const conditions = [
    eq(careShifts.organizationId, params.organizationId),
    gte(careShifts.startAt, params.from),
    lt(careShifts.startAt, params.to),
  ];
  if (params.caregiverId) {
    conditions.push(eq(careShifts.caregiverId, params.caregiverId));
  }
  return db
    .select({
      id: careShifts.id,
      agreementId: careShifts.agreementId,
      startAt: careShifts.startAt,
      endAt: careShifts.endAt,
      status: careShifts.status,
      caregiverId: careShifts.caregiverId,
      caregiverFirst: employees.firstName,
      caregiverLast: employees.lastName,
      patientFirst: patients.legalFirstName,
      patientLast: patients.legalLastName,
    })
    .from(careShifts)
    .innerJoin(employees, eq(employees.id, careShifts.caregiverId))
    .innerJoin(patients, eq(patients.id, careShifts.patientId))
    .where(and(...conditions))
    .orderBy(careShifts.startAt);
}

/** A caregiver's shifts overlapping-candidate window (conflict detection). */
export async function caregiverShiftsAround(
  organizationId: string,
  caregiverId: string,
  from: Date,
  to: Date,
  excludeShiftId?: string,
) {
  const db = getDb();
  const conditions = [
    eq(careShifts.organizationId, organizationId),
    eq(careShifts.caregiverId, caregiverId),
    lt(careShifts.startAt, to),
    gte(careShifts.endAt, from),
  ];
  if (excludeShiftId) conditions.push(ne(careShifts.id, excludeShiftId));
  return db
    .select({
      id: careShifts.id,
      startAt: careShifts.startAt,
      endAt: careShifts.endAt,
      status: careShifts.status,
    })
    .from(careShifts)
    .where(and(...conditions));
}

/** Active employees flagged as caregivers (falls back to empty list). */
export async function listCaregivers(organizationId: string) {
  const db = getDb();
  const { users } = await import("@/lib/db/schema");
  return db
    .select({
      id: employees.id,
      firstName: employees.firstName,
      lastName: employees.lastName,
    })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .where(
      and(
        eq(employees.organizationId, organizationId),
        eq(employees.isCaregiver, true),
        eq(users.isActive, true),
      ),
    )
    .orderBy(employees.firstName);
}
