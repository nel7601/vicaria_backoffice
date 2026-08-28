import { and, asc, eq, gte, lt } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  appointments,
  employees,
  patients,
  services,
} from "@/lib/db/schema";

export interface ListAppointmentsParams {
  organizationId: string;
  from: Date;
  to: Date;
  employeeId?: string;
}

export async function listAppointments(params: ListAppointmentsParams) {
  const db = getDb();
  const conditions = [
    eq(appointments.organizationId, params.organizationId),
    gte(appointments.startAt, params.from),
    lt(appointments.startAt, params.to),
  ];
  if (params.employeeId) {
    conditions.push(eq(appointments.employeeId, params.employeeId));
  }

  return db
    .select({
      id: appointments.id,
      startAt: appointments.startAt,
      endAt: appointments.endAt,
      status: appointments.status,
      modality: appointments.modality,
      patientId: appointments.patientId,
      patientFirst: patients.legalFirstName,
      patientLast: patients.legalLastName,
      employeeFirst: employees.firstName,
      employeeLast: employees.lastName,
      serviceNameEn: services.nameEn,
    })
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .innerJoin(employees, eq(employees.id, appointments.employeeId))
    .leftJoin(services, eq(services.id, appointments.serviceId))
    .where(and(...conditions))
    .orderBy(asc(appointments.startAt));
}

/** Appointments for a practitioner overlapping a window (conflict check). */
export async function employeeAppointmentsInWindow(
  organizationId: string,
  employeeId: string,
  from: Date,
  to: Date,
  excludeId?: string,
) {
  const db = getDb();
  const { ne } = await import("drizzle-orm");
  const conditions = [
    eq(appointments.organizationId, organizationId),
    eq(appointments.employeeId, employeeId),
    lt(appointments.startAt, to),
    gte(appointments.endAt, from),
  ];
  if (excludeId) conditions.push(ne(appointments.id, excludeId));
  return db
    .select({
      id: appointments.id,
      startAt: appointments.startAt,
      endAt: appointments.endAt,
      status: appointments.status,
    })
    .from(appointments)
    .where(
      and(
        ...conditions,
      ),
    );
}

export async function listActiveEmployees(organizationId: string) {
  const db = getDb();
  const { users } = await import("@/lib/db/schema");
  return db
    .select({
      id: employees.id,
      firstName: employees.firstName,
      lastName: employees.lastName,
      isPractitioner: employees.isPractitioner,
    })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .where(
      and(eq(employees.organizationId, organizationId), eq(users.isActive, true)),
    );
}

/** Full appointment detail with related names and its status history. */
export async function getAppointmentDetail(
  organizationId: string,
  id: string,
) {
  const db = getDb();
  const { services, appointmentStatusHistory, users } = await import(
    "@/lib/db/schema"
  );
  const { desc } = await import("drizzle-orm");

  const [appt] = await db
    .select({
      id: appointments.id,
      patientId: appointments.patientId,
      serviceId: appointments.serviceId,
      employeeId: appointments.employeeId,
      startAt: appointments.startAt,
      endAt: appointments.endAt,
      modality: appointments.modality,
      status: appointments.status,
      notesAdmin: appointments.notesAdmin,
      cancellationReason: appointments.cancellationReason,
      createdAt: appointments.createdAt,
      patientFirst: patients.legalFirstName,
      patientLast: patients.legalLastName,
      patientNumber: patients.patientNumber,
      employeeFirst: employees.firstName,
      employeeLast: employees.lastName,
      serviceNameEn: services.nameEn,
    })
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .innerJoin(employees, eq(employees.id, appointments.employeeId))
    .leftJoin(services, eq(services.id, appointments.serviceId))
    .where(
      and(
        eq(appointments.organizationId, organizationId),
        eq(appointments.id, id),
      ),
    )
    .limit(1);
  if (!appt) return null;

  const history = await db
    .select({
      id: appointmentStatusHistory.id,
      fromStatus: appointmentStatusHistory.fromStatus,
      toStatus: appointmentStatusHistory.toStatus,
      reason: appointmentStatusHistory.reason,
      changedAt: appointmentStatusHistory.changedAt,
      changedByEmail: users.email,
    })
    .from(appointmentStatusHistory)
    .leftJoin(users, eq(users.id, appointmentStatusHistory.changedBy))
    .where(eq(appointmentStatusHistory.appointmentId, id))
    .orderBy(desc(appointmentStatusHistory.changedAt));

  return { appointment: appt, history };
}
