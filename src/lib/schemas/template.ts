import { z } from "zod";

/**
 * Encounter template DTOs (spec FR-ENC-002).
 * A template has a name, an optional linked service (auto-attach when starting
 * an encounter from an appointment for that service) and a list of fields.
 * Publishing creates an immutable version; edits create a new version.
 */

export const templateFieldSchema = z
  .object({
    key: z.string().trim().min(1).max(60).regex(/^[a-z0-9_]+$/, "Invalid key"),
    // A consent paragraph is the field label ("I understand that…"), so the
    // cap has to fit legal wording, not just a short question.
    label: z.string().trim().min(1, "Field label required").max(400),
    type: z.enum([
      "text",
      "textarea",
      "number",
      "scale",
      "select",
      "date",
      "checkbox",
      "heading",
    ]),
    required: z.boolean().optional(),
    options: z.array(z.string().trim().min(1).max(80)).optional(),
    min: z.number().int().optional(),
    max: z.number().int().optional(),
  })
  .refine((f) => f.type !== "select" || (f.options?.length ?? 0) > 0, {
    message: "Select fields need at least one option",
    path: ["options"],
  });

export const templateSchema = z.object({
  name: z.string().trim().min(1, "Required").max(160),
  serviceId: z.string().uuid().optional().or(z.literal("")),
  /**
   * Where the answers belong: in the clinical record, or on the patient's
   * administrative file (a signed release is not clinical history).
   */
  scope: z.enum(["clinical", "administrative"]),
  fields: z.array(templateFieldSchema).min(1, "Add at least one field"),
});

export type TemplateInput = z.infer<typeof templateSchema>;
export type TemplateFieldInput = z.infer<typeof templateFieldSchema>;
