import { and, eq, gte, isNull, lt } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { appointments, employees, patients } from "@/lib/db/schema";
import { planRead } from "../policy/scope";
import type { ToolContext } from "../tools/types";

/**
 * The names worth telling the recogniser about.
 *
 * Not every patient: the prompt is capped, a longer list dilutes the bias, and
 * sending the whole roster to a transcription service is more exposure for no
 * gain. What people actually say out loud is who is on the schedule around
 * now, so that is what goes.
 *
 * Scope applies here as everywhere else. A practitioner's vocabulary is built
 * from their own schedule, so the service never receives names they could not
 * have seen in the first place.
 */

/** How far either side of today counts as "coming up". */
const WINDOW_DAYS = 7;

export async function buildVocabulary(
  ctx: ToolContext,
  windowDays: number = WINDOW_DAYS,
): Promise<string[]> {
  const plan = planRead(ctx.principal, "patients_demographic");
  // A caller who may not see identities gets no name list — the recogniser
  // would be biased towards people they are not allowed to know about.
  if (plan.mode === "denied" || !plan.identifiable) return [];

  const db = getDb();
  const from = new Date(ctx.now.getTime() - windowDays * 86_400_000);
  const to = new Date(ctx.now.getTime() + windowDays * 86_400_000);

  const conditions = [
    eq(appointments.organizationId, ctx.principal.organizationId),
    gte(appointments.startAt, from),
    lt(appointments.startAt, to),
    isNull(patients.deletedAt),
  ];
  if (plan.mode === "own" && plan.employeeId) {
    conditions.push(eq(appointments.employeeId, plan.employeeId));
  }

  const rows = await db
    .selectDistinct({
      first: patients.legalFirstName,
      last: patients.legalLastName,
      preferred: patients.preferredName,
    })
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .where(and(...conditions));

  const names = new Set<string>();
  for (const row of rows) {
    names.add(`${row.first} ${row.last}`.trim());
    // The nickname matters more than the legal name here: it is what gets
    // said out loud and what the recogniser is least likely to know.
    if (row.preferred) names.add(`${row.preferred} ${row.last}`.trim());
  }

  // Practitioners are named constantly ("with Dr. Suárez") and there are few
  // of them, so they are cheap to include.
  const staff = await db
    .select({ first: employees.firstName, last: employees.lastName })
    .from(employees)
    .where(eq(employees.organizationId, ctx.principal.organizationId));
  for (const s of staff) names.add(`${s.first} ${s.last}`.trim());

  return [...names];
}

/** Exported for the tests that pin the scoping rules. */
export const VOCABULARY_WINDOW_DAYS = WINDOW_DAYS;
