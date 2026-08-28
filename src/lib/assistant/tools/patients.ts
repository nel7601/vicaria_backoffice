import { and, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { recordAccess } from "@/lib/audit/record";
import { getDb } from "@/lib/db";
import { patients } from "@/lib/db/schema";
import { planRead } from "../policy/scope";
import {
  MINIMUM_CANDIDATE,
  classifyMatches,
  looksLikeNumber,
  nameScore,
  normalizeName,
  normalizeNumber,
} from "./patient-match";
import type { AssistantTool, ToolContext } from "./types";

/**
 * `resolve_patient` — turn a spoken reference into a patient id (§4.4).
 *
 * The backoffice's own search does not serve this: it matches the legal name
 * with ILIKE, so a patient everyone calls "Cuco" is unfindable, and a name
 * that speech recognition heard slightly wrong returns nothing at all.
 *
 * The rule that matters is what it does NOT do. It never picks a patient when
 * more than one is plausible, and never resolves a weak match silently — it
 * reports candidates and the conversation asks. Acting on the wrong patient is
 * not recoverable by apologising afterwards.
 */

const inputSchema = z.object({
  /** What the user called the patient: a name, a nickname, or a number. */
  query: z.string().trim().min(1).max(120),
});

type Input = z.infer<typeof inputSchema>;

export const resolvePatientTool: AssistantTool<Input, unknown> = {
  name: "resolve_patient",
  description:
    "Find which patient the user means from a name, nickname or patient number. " +
    "Returns one match only when it is unambiguous; otherwise returns candidates to choose from. " +
    "Never assume a candidate — if more than one comes back, ask the user which one.",
  resource: "patients_demographic",
  action: "read",
  input: inputSchema,

  async execute(args, ctx: ToolContext) {
    const plan = planRead(ctx.principal, "patients_demographic");
    if (plan.mode === "denied") {
      return { refused: true, reason: plan.reason };
    }
    // A caller who may not see identities cannot be told who someone is.
    if (!plan.identifiable) {
      return {
        refused: true,
        reason: "This role cannot look up individual patients.",
      };
    }

    const db = getDb();
    const query = args.query.trim();
    const conditions = [
      eq(patients.organizationId, ctx.principal.organizationId),
      isNull(patients.deletedAt),
    ];
    if (plan.mode === "own") {
      // A practitioner resolves only among their own patients: a name they
      // cannot see is a name that does not exist for them.
      conditions.push(eq(patients.primaryPractitionerId, plan.employeeId!));
    }

    // A spoken number is exact: no fuzzy matching, no near misses.
    if (looksLikeNumber(query)) {
      const number = normalizeNumber(query);
      const rows = await db
        .select(candidateColumns())
        .from(patients)
        .where(
          and(
            ...conditions,
            sql`lower(${patients.patientNumber}) = ${number}`,
          ),
        )
        .limit(5);

      return respond(ctx, rows.map((r) => ({ ...r, score: 1 })), "number");
    }

    // Narrow in the database with trigram similarity, then score in code so
    // the rules (exact match, first-name match, tie handling) live in one
    // tested place rather than half in SQL.
    const folded = normalizeName(query);
    const rows = await db
      .select(candidateColumns())
      .from(patients)
      .where(
        and(
          ...conditions,
          // Each part is compared separately as well as the whole: a spoken
          // first name is diluted by the surname when the two are joined, so
          // "Prya" would never reach the scorer if only the full name were
          // tested here.
          or(
            sql`similarity(lower(${patients.legalFirstName} || ' ' || ${patients.legalLastName}), ${folded}) >= ${MINIMUM_CANDIDATE}`,
            sql`similarity(lower(${patients.legalFirstName}), ${folded}) >= ${MINIMUM_CANDIDATE}`,
            sql`similarity(lower(${patients.legalLastName}), ${folded}) >= ${MINIMUM_CANDIDATE}`,
            sql`similarity(lower(coalesce(${patients.preferredName}, '')), ${folded}) >= ${MINIMUM_CANDIDATE}`,
          ),
        ),
      )
      .limit(25);

    const scored = rows.map((row) => ({
      ...row,
      score: Math.max(
        nameScore(query, `${row.legalFirstName} ${row.legalLastName}`),
        row.preferredName ? nameScore(query, row.preferredName) : 0,
        row.preferredName
          ? nameScore(query, `${row.preferredName} ${row.legalLastName}`)
          : 0,
      ),
    }));

    return respond(ctx, scored, "name");
  },
};

function candidateColumns() {
  return {
    id: patients.id,
    legalFirstName: patients.legalFirstName,
    legalLastName: patients.legalLastName,
    preferredName: patients.preferredName,
    patientNumber: patients.patientNumber,
    dateOfBirth: patients.dateOfBirth,
  };
}

interface Candidate {
  id: string;
  legalFirstName: string;
  legalLastName: string;
  preferredName: string | null;
  patientNumber: string;
  dateOfBirth: string | null;
  score: number;
}

/**
 * Shape the answer, showing only what disambiguation needs.
 *
 * Birth year appears only when there is more than one candidate, because that
 * is the only situation where it helps a person tell them apart. With a single
 * match it would be PHI handed over for no reason.
 */
async function respond(
  ctx: ToolContext,
  scored: Candidate[],
  matchedOn: "name" | "number",
) {
  const { status, matches } = classifyMatches(scored);

  if (status === "none") {
    return {
      status,
      matchedOn,
      candidates: [],
      guidance: "No patient matched. Ask the user to repeat or spell the name.",
    };
  }

  await Promise.all(
    matches.map((m) =>
      recordAccess({
        organizationId: ctx.principal.organizationId,
        actorUserId: ctx.principal.dbUserId,
        patientId: m.id,
        action: "assistant_read",
        route: "assistant:resolve_patient",
        purpose: "Assistant resolved a patient reference",
      }),
    ),
  );

  const showBirthYear = matches.length > 1;

  return {
    status,
    matchedOn,
    candidates: matches.map((m) => ({
      patientId: m.id,
      name: `${m.legalFirstName} ${m.legalLastName}`.trim(),
      goesBy: m.preferredName ?? undefined,
      patientNumber: m.patientNumber,
      birthYear:
        showBirthYear && m.dateOfBirth ? m.dateOfBirth.slice(0, 4) : undefined,
      confidence: Number(m.score.toFixed(2)),
    })),
    guidance:
      status === "one"
        ? "One clear match. Use this patientId for the rest of the turn."
        : "More than one patient could be meant. Ask the user which one before doing anything else.",
  };
}
