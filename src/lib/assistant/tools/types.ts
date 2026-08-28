import type { z } from "zod";
import type { Action, Resource } from "@/lib/auth/rbac";
import type { Principal } from "@/lib/auth/principal";

/**
 * Tool contract for the assistant (§5 of the assistant plan).
 *
 * The closed catalogue is the main defence, not the system prompt: the model
 * can only ask for one of these by name, with arguments that must satisfy a
 * Zod schema, and the server re-checks the permission before running it. There
 * is no generic "query the database" tool, and no tool takes SQL.
 */

/** Everything a tool may know about who is asking. */
export interface ToolContext {
  /** Always tenant-bound: no tool runs without an organization to scope to. */
  principal: Principal & { organizationId: string; dbUserId: string };
  /** One instant for the whole turn, so two tools cannot disagree on "today". */
  now: Date;
  timeZone: string;
}

export interface AssistantTool<Input = unknown, Output = unknown> {
  name: string;
  /** Shown to the model. Says what it answers, not how it is implemented. */
  description: string;
  /**
   * Resource this tool reads, or null when it touches no patient data at all
   * (date arithmetic, for instance). A null resource is available to every
   * authenticated principal; anything else goes through the RBAC gate.
   */
  resource: Resource | null;
  action: Action;
  input: z.ZodType<Input>;
  execute(args: Input, ctx: ToolContext): Promise<Output>;
}

/** Raised when the model asks for a tool it may not use, or does not exist. */
export class ToolNotAvailableError extends Error {
  constructor(public readonly toolName: string) {
    super(`Tool "${toolName}" is not available for this user`);
    this.name = "ToolNotAvailableError";
  }
}

/** Raised when the arguments fail the tool's schema. */
export class ToolInputError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly issues: string[],
  ) {
    super(`Invalid arguments for "${toolName}": ${issues.join("; ")}`);
    this.name = "ToolInputError";
  }
}
