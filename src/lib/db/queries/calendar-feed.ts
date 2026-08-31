import { and, asc, eq, gte, isNull, lt } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  appointments,
  calendarFeedTokens,
  companySettings,
  employees,
  patients,
  services,
} from "@/lib/db/schema";
import type { CalendarDetail } from "@/lib/domain/icalendar";

/** How far either side of today the feed publishes. */
export const FEED_PAST_DAYS = 30;
export const FEED_FUTURE_DAYS = 180;

export interface FeedSubscription {
  organizationId: string;
  employeeId: string;
  employeeName: string;
  detail: CalendarDetail;
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

/** The employee's own appointments, in the window the feed publishes. */
export async function listFeedAppointments(
  subscription: FeedSubscription,
  now: Date,
) {
  const db = getDb();
  const from = new Date(now.getTime() - FEED_PAST_DAYS * 86_400_000);
  const to = new Date(now.getTime() + FEED_FUTURE_DAYS * 86_400_000);

  return db
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
    )
    .orderBy(asc(appointments.startAt));
}

/**
 * Practitioners and their live subscription link, for the Settings card.
 *
 * Only employees who see patients: a calendar of appointments means nothing
 * for someone who never appears in one. Home-care caregivers get their own
 * feed when Vicaria Care joins this.
 */
export async function listPractitionerFeeds(organizationId: string) {
  const db = getDb();
  const { users } = await import("@/lib/db/schema");
  return db
    .select({
      employeeId: employees.id,
      firstName: employees.firstName,
      lastName: employees.lastName,
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
        eq(employees.isPractitioner, true),
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
