import { principalCan } from "@/lib/auth/authorize-principal";
import type { Principal } from "@/lib/auth/principal";
import {
  countCompletedAppointmentsTool,
  getAppointmentsForRangeTool,
} from "./appointments";
import { resolveDateTool } from "./resolve-date-tool";
import {
  ToolInputError,
  ToolNotAvailableError,
  type AssistantTool,
  type ToolContext,
} from "./types";

/**
 * The closed tool catalogue and the per-principal registry (§5.2 of the plan).
 *
 * Two checks, not one. The model is only *offered* the tools its roles allow,
 * and every invocation is checked again before it runs — offering and
 * authorising are separate, so a tool name that arrives some other way (a
 * replayed turn, a model that invents it) still fails server-side.
 */

/** Every tool that exists. Adding one here is the only way to add a tool. */
const ALL_TOOLS: AssistantTool[] = [
  resolveDateTool as AssistantTool,
  getAppointmentsForRangeTool as AssistantTool,
  countCompletedAppointmentsTool as AssistantTool,
];

/** May this principal use this tool at all? */
export function canUseTool(
  principal: Principal,
  tool: AssistantTool,
): boolean {
  // A tool that reads no patient data needs no resource permission.
  if (tool.resource === null) return true;
  return principalCan(principal, tool.resource, tool.action);
}

/** The tools to describe to the model for this principal, and no others. */
export function toolsFor(principal: Principal): AssistantTool[] {
  return ALL_TOOLS.filter((tool) => canUseTool(principal, tool));
}

/** Look up a tool by name regardless of permission (for auditing a refusal). */
export function findTool(name: string): AssistantTool | undefined {
  return ALL_TOOLS.find((tool) => tool.name === name);
}

/**
 * Run a tool for a principal: exists, is allowed, arguments valid, then run.
 *
 * An unknown name and a forbidden name fail the same way on purpose — telling
 * the caller which tools exist but are off-limits leaks the shape of other
 * people's permissions.
 */
export async function invokeTool(
  name: string,
  rawArgs: unknown,
  ctx: ToolContext,
): Promise<unknown> {
  const tool = findTool(name);
  if (!tool || !canUseTool(ctx.principal, tool)) {
    throw new ToolNotAvailableError(name);
  }

  const parsed = tool.input.safeParse(rawArgs);
  if (!parsed.success) {
    throw new ToolInputError(
      name,
      parsed.error.issues.map((i) =>
        i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message,
      ),
    );
  }

  return tool.execute(parsed.data, ctx);
}

export { ToolInputError, ToolNotAvailableError };
export type { AssistantTool, ToolContext };
