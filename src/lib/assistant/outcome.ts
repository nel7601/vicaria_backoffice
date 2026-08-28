import { z } from "zod";

/**
 * The structured outcome of a turn (§4.2 of the assistant plan).
 *
 * Every turn ends as exactly one of these, produced by the model calling the
 * `respond` tool — never by parsing its prose. This is what keeps "the agent
 * said something that sounded like a confirmation" from ever becoming an
 * action: the decision is a typed field, not a sentence.
 */

export const OUTCOME_KINDS = [
  /** A grounded answer to what was asked. */
  "response",
  /** Out of scope, or not permitted. */
  "refusal",
  /** Ambiguous: the agent needs one more thing before it can answer or act. */
  "clarification",
  /** A proposed write, pending explicit confirmation (phase 5). */
  "action_proposal",
] as const;

export type OutcomeKind = (typeof OUTCOME_KINDS)[number];

export const respondSchema = z.object({
  kind: z.enum(OUTCOME_KINDS),
  /** What the user hears and reads. Plain language, in their locale. */
  message: z.string().min(1).max(4000),
  /**
   * Options for a clarification, e.g. two patients matching a nickname.
   * Labels only — the caller sends back the id, never a name.
   */
  options: z
    .array(z.object({ id: z.string().max(200), label: z.string().max(200) }))
    .max(10)
    .optional(),
});

export type RespondArgs = z.infer<typeof respondSchema>;

/** The standard out-of-scope reply, in the user's language (§1 of the plan). */
export const OUT_OF_SCOPE_MESSAGE: Record<"en" | "es", string> = {
  en: "I'm not trained for that; I can only work with information from the Vicaria backoffice.",
  es: "No estoy entrenada para eso; solo puedo trabajar con la información del backoffice de Vicaria.",
};

export interface TurnOutcome {
  kind: OutcomeKind;
  message: string;
  options?: { id: string; label: string }[];
  /** Tools actually run this turn, for audit and for debugging a bad answer. */
  toolsUsed: string[];
  /** True when the server ended the turn itself rather than the model. */
  terminatedByServer?: boolean;
}
