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
) {
  const db = getDb();
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
        eq(appointments.organizationId, organizationId),
        eq(appointments.employeeId, employeeId),
        lt(appointments.startAt, to),
        gte(appointments.endAt, from),
      ),
    );
}

export async function listActiveEmployees(organizationId: string) {
  const db = getDb();
  return db
    .select({
      id: employees.id,
      firstName: employees.firstName,
      lastName: employees.lastName,
      isPractitioner: employees.isPractitioner,
    })
    .from(employees)
    .where(eq(employees.organizationId, organizationId));
}
