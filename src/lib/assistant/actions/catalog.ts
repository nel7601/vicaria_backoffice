import { z } from "zod";
import type { Action, Resource } from "@/lib/auth/rbac";
import type { ToolContext } from "../tools/types";

/**
 * The catalogue of things the assistant can change.
 *
 * Every write goes through the same three steps — propose, confirm, execute —
 * so defining one is declaring four things: what it needs, what permission it
 * requires, how to describe it to the person confirming, and how to carry it
 * out. The mechanics live once, in proposals.ts and execute.ts.
 *
 * The description matters as much as the code. It is the sentence someone
 * reads before agreeing, so it states the effect in absolute terms — a date,
 * a name, an amount — never "the appointment you mentioned".
 */

export interface ActionContext extends ToolContext {
  principal: ToolContext["principal"];
}

export interface ActionDefinition<Args = unknown> {
  name: string;
  /** Shown to the model when deciding whether to propose this. */
  description: string;
  resource: Resource;
  action: Action;
  input: z.ZodType<Args>;
  /**
   * Resolve the arguments against current state and describe the effect.
   *
   * Returns the summary shown to the user plus the canonical arguments that
   * will be stored and executed — resolved now so that what runs later is
   * what was agreed to, not what the model reconstructs.
   *
   * Refusing here is normal: an appointment that cannot move, a patient who
   * does not exist. Better to fail before asking someone to confirm.
   */
  prepare(
    args: Args,
    ctx: ActionContext,
  ): Promise<
    | { ok: true; summary: string; arguments: Record<string, unknown> }
    | { ok: false; reason: string }
  >;
  /** Carry out the confirmed action. Runs after the proposal is claimed. */
  perform(
    stored: Record<string, unknown>,
    ctx: ActionContext,
  ): Promise<{ ok: true; result: Record<string, unknown>; message: string } | { ok: false; reason: string }>;
  /**
   * Irreversible in the ordinary sense: signing a clinical note, voiding an
   * invoice, issuing a refund. Surfaced so the confirmation can say so and so
   * a deployment can switch these off separately.
   */
  irreversible?: boolean;
}

const registry = new Map<string, ActionDefinition>();

export function defineAction<Args>(definition: ActionDefinition<Args>): ActionDefinition<Args> {
  registry.set(definition.name, definition as ActionDefinition);
  return definition;
}

export function findAction(name: string): ActionDefinition | undefined {
  return registry.get(name);
}

export function allActions(): ActionDefinition[] {
  return [...registry.values()];
}
