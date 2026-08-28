import { z } from "zod";

/**
 * Zod schema -> JSON Schema for the provider's tool definitions.
 *
 * Zod 4 does this natively, so the tool's runtime validation and the schema
 * the model is shown come from the same source. Describing a tool one way and
 * validating it another is how a model ends up being told to send a field the
 * server then rejects.
 */
export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
}
