import { and, asc, eq, gte, isNull, lt, or } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  appointments,
  calendarFeedTokens,
  careShifts,
  companySettings,
  employees,
  patients,
  services,
} from "@/lib/db/schema";
import type { CalendarDetail, FeedEvent } from "@/lib/domain/icalendar";

/** How far either side of today the feed publishes. */
export const FEED_PAST_DAYS = 30;
export const FEED_FUTURE_DAYS = 180;

export interface FeedSubscription {
  organizationId: string;
  employeeId: string;
  employeeName: string;
  detail: CalendarDetail;
  /** Whether to publish clinic appointments, home-care shifts, or both. */
  isPractitioner: boolean;
  isCaregiver: boolean;
}

/**
 * Resolve a feed token to the employee it belongs to.
 *
 * The caller is a calendar client with no session, so this reads with the
 * app's own connection: the token is the authorization, and every query below
 * is scoped explicitly by organization and employee rather than by RLS.
 * Revoked tokens resolve to null, which is what keeps a leaked link dead.
 */
export async function resolveFeedToken(
  token: string,
): Promise<FeedSubscription | null> {
  const db = getDb();
  const [row] = await db
    .select({
      organizationId: calendarFeedTokens.organizationId,
      employeeId: calendarFeedTokens.employeeId,
      firstName: employees.firstName,
      lastName: employees.lastName,
      isPractitioner: employees.isPractitioner,
      isCaregiver: employees.isCaregiver,
      detail: companySettings.calendarFeedDetail,
    })
    .from(calendarFeedTokens)
    .innerJoin(employees, eq(employees.id, calendarFeedTokens.employeeId))
    .leftJoin(
      companySettings,
      eq(companySettings.organizationId, calendarFeedTokens.organizationId),
    )
    .where(
      and(
        eq(calendarFeedTokens.token, token),
        isNull(calendarFeedTokens.revokedAt),
      ),
    )
    .limit(1);
  if (!row) return null;

  return {
    organizationId: row.organizationId,
    employeeId: row.employeeId,
    employeeName: `${row.firstName} ${row.lastName}`.trim(),
    isPractitioner: row.isPractitioner,
    isCaregiver: row.isCaregiver,
    // No settings row yet: keep the patient's name out of it.
    detail: (row.detail ?? "initials") as CalendarDetail,
  };
}

/** Note that a calendar client fetched the feed, so an unused link is visible. */
export async function touchFeedToken(token: string): Promise<void> {
  const db = getDb();
  await db
    .update(calendarFeedTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(calendarFeedTokens.token, token));
}

/**
 * Everything on this employee's calendar in the published window.
 *
 * An employee can be both a practitioner and a caregiver; they get one
 * subscription, and it carries whichever kinds of work apply to them. The two
 * sources are read only when relevant, so a caregiver's feed never touches the
 * appointments table.
 */
export async function listFeedEvents(
  subscription: FeedSubscription,
  now: Date,
): Promise<FeedEvent[]> {
  const db = getDb();
  const from = new Date(now.getTime() - FEED_PAST_DAYS * 86_400_000);
  const to = new Date(now.getTime() + FEED_FUTURE_DAYS * 86_400_000);

  const events: FeedEvent[] = [];

  if (subscription.isPractitioner) {
    const rows = await db
      .select({
        id: appointments.id,
        startAt: appointments.startAt,
        endAt: appointments.endAt,
        status: appointments.status,
        modality: appointments.modality,
        updatedAt: appointments.updatedAt,
        serviceName: services.nameEn,
        patientFirst: patients.legalFirstName,
        patientLast: patients.legalLastName,
      })
      .from(appointments)
      .innerJoin(patients, eq(patients.id, appointments.patientId))
      .leftJoin(services, eq(services.id, appointments.serviceId))
      .where(
        and(
          eq(appointments.organizationId, subscription.organizationId),
          eq(appointments.employeeId, subscription.employeeId),
          gte(appointments.startAt, from),
          lt(appointments.startAt, to),
        ),
      );

    events.push(
      ...rows.map((r) => ({
        id: r.id,
        kind: "appointment" as const,
        startAt: r.startAt,
        endAt: r.endAt,
        status: r.status,
        title: r.serviceName ?? "Appointment",
        where: r.modality,
        patientFirst: r.patientFirst,
        patientLast: r.patientLast,
        updatedAt: r.updatedAt,
        detailPath: `/calendar/${r.id}`,
      })),
    );
  }

  if (subscription.isCaregiver) {
    const rows = await db
      .select({
        id: careShifts.id,
        agreementId: careShifts.agreementId,
        startAt: careShifts.startAt,
        endAt: careShifts.endAt,
        status: careShifts.status,
        updatedAt: careShifts.updatedAt,
        patientFirst: patients.legalFirstName,
        patientLast: patients.legalLastName,
      })
      .from(careShifts)
      .innerJoin(patients, eq(patients.id, careShifts.patientId))
      .where(
        and(
          eq(careShifts.organizationId, subscription.organizationId),
          eq(careShifts.caregiverId, subscription.employeeId),
          gte(careShifts.startAt, from),
          lt(careShifts.startAt, to),
        ),
      );

    events.push(
      ...rows.map((r) => ({
        id: r.id,
        kind: "shift" as const,
        startAt: r.startAt,
        endAt: r.endAt,
        status: r.status,
        title: "Home care visit",
        // The address lives on the agreement, and an address in a third-party
        // calendar is exactly the detail this feed is careful about.
        where: "client's home",
        patientFirst: r.patientFirst,
        patientLast: r.patientLast,
        updatedAt: r.updatedAt,
        // The agreement is where a caregiver finds the visit's tasks.
        detailPath: `/care/${r.agreementId}`,
      })),
    );
  }

  return events.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

/**
 * Everyone who has work worth putting on a calendar, with their live link.
 *
 * Practitioners and caregivers alike; somebody who is both appears once,
 * because they get one subscription carrying both kinds of work.
 */
export async function listCalendarFeedEmployees(organizationId: string) {
  const db = getDb();
  const { users } = await import("@/lib/db/schema");
  return db
    .select({
      employeeId: employees.id,
      firstName: employees.firstName,
      lastName: employees.lastName,
      isPractitioner: employees.isPractitioner,
      isCaregiver: employees.isCaregiver,
      token: calendarFeedTokens.token,
      lastUsedAt: calendarFeedTokens.lastUsedAt,
    })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .leftJoin(
      calendarFeedTokens,
      and(
        eq(calendarFeedTokens.employeeId, employees.id),
        isNull(calendarFeedTokens.revokedAt),
      ),
    )
    .where(
      and(
        eq(employees.organizationId, organizationId),
        or(eq(employees.isPractitioner, true), eq(employees.isCaregiver, true)),
        eq(users.isActive, true),
      ),
    )
    .orderBy(asc(employees.firstName));
}

/** The organization's chosen detail level, defaulting to the cautious one. */
export async function getCalendarFeedDetail(
  organizationId: string,
): Promise<CalendarDetail> {
  const db = getDb();
  const [row] = await db
    .select({ detail: companySettings.calendarFeedDetail })
    .from(companySettings)
    .where(eq(companySettings.organizationId, organizationId))
    .limit(1);
  return (row?.detail ?? "initials") as CalendarDetail;
}
