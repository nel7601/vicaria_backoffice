import { and, desc, eq, gte, isNull, lt } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { appointments, employees, patients } from "@/lib/db/schema";
import { planRead } from "../policy/scope";
import type { ToolContext } from "../tools/types";

/**
 * The names worth telling the recogniser about.
 *
 * Two tiers, because a first attempt that only listed the coming week's
 * schedule failed the plan's own example: asked to move "Cuco Tetilla", the
 * decoder heard "contigo", because Cuco had no appointment and so was not in
 * the list. The patient you want to book is by definition the one without a
 * booking yet.
 *
 * So: everyone on the schedule around now first, since those names are the
 * most likely to be said, then other active patients until the budget is
 * spent. Still not the whole roster — the prompt is capped, a longer list
 * dilutes the bias, and sending every name to a transcription service is more
 * exposure for less accuracy.
 *
 * Scope applies here as everywhere else. A practitioner's vocabulary is built
 * from their own patients, so the service never receives names they could not
 * have seen in the first place.
 */

/** How far either side of today counts as "coming up". */
const WINDOW_DAYS = 7;

/** Matches the transcription prompt's cap; filling past it is wasted. */
const VOCABULARY_BUDGET = 60;

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
  const add = (first: string, last: string, preferred: string | null) => {
    names.add(`${first} ${last}`.trim());
    // The nickname matters more than the legal name here: it is what gets
    // said out loud and what the recogniser is least likely to know.
    if (preferred) names.add(`${preferred} ${last}`.trim());
  };

  for (const row of rows) add(row.first, row.last, row.preferred);

  // Fill the remaining budget with other patients on the books. Someone with
  // no upcoming appointment is exactly who gets named when booking one.
  if (names.size < VOCABULARY_BUDGET) {
    const otherConditions = [
      eq(patients.organizationId, ctx.principal.organizationId),
      isNull(patients.deletedAt),
    ];
    if (plan.mode === "own" && plan.employeeId) {
      otherConditions.push(eq(patients.primaryPractitionerId, plan.employeeId));
    }

    const others = await db
      .select({
        first: patients.legalFirstName,
        last: patients.legalLastName,
        preferred: patients.preferredName,
      })
      .from(patients)
      .where(and(...otherConditions))
      .orderBy(desc(patients.updatedAt))
      .limit(VOCABULARY_BUDGET);

    for (const row of others) {
      if (names.size >= VOCABULARY_BUDGET) break;
      add(row.first, row.last, row.preferred);
    }
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
export const VOCABULARY_MAX_TERMS = VOCABULARY_BUDGET;
