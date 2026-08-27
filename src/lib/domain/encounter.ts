import { createHash } from "node:crypto";

/**
 * Encounter domain logic (spec §6.4).
 * Content hashing for signatures (FR-ENC-003), immutability guards
 * (FR-ENC-004) and dynamic template validation (FR-ENC-002). Pure functions.
 */

export type EncounterStatus = "draft" | "signed" | "amended" | "entered_in_error";

/** Deterministic JSON with sorted keys, so a hash reproduces from a snapshot. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortKeys((value as Record<string, unknown>)[k]);
        return acc;
      }, {});
  }
  return value;
}

/** SHA-256 over the canonical content, prefixed with the summary (FR-ENC-003). */
export function computeContentHash(content: unknown, summary: string): string {
  return createHash("sha256")
    .update(canonicalJson({ content, summary: summary ?? "" }))
    .digest("hex");
}

/** A signed or amended note is immutable in place (FR-ENC-004). */
export function isImmutable(status: EncounterStatus): boolean {
  return status === "signed" || status === "amended";
}

export function canSign(status: EncounterStatus): boolean {
  return status === "draft";
}

export function canAmend(status: EncounterStatus): boolean {
  return status === "signed" || status === "amended";
}

// --- Dynamic templates (FR-ENC-002) ---

export type FieldType =
  | "text"
  | "textarea"
  | "select"
  | "scale"
  | "number"
  | "date"
  | "checkbox"
  /** Section title — renders as a subheading, collects no answer. */
  | "heading";

export interface TemplateField {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[]; // for select
  min?: number; // for scale/number
  max?: number; // for scale/number
}

export interface TemplateSchema {
  fields: TemplateField[];
}

export interface ValidationResult {
  ok: boolean;
  errors: Record<string, string>;
}

/** Validate encounter answers against a published template schema. */
export function validateAnswers(
  schema: TemplateSchema,
  answers: Record<string, unknown>,
): ValidationResult {
  const errors: Record<string, string> = {};

  for (const field of schema.fields) {
    const value = answers[field.key];
    const empty =
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim() === "");

    if (field.required && empty) {
      errors[field.key] = `${field.label} is required`;
      continue;
    }
    if (empty) continue;

    if (field.type === "select" && field.options) {
      if (!field.options.includes(String(value))) {
        errors[field.key] = `${field.label} has an invalid option`;
      }
    }
    if (field.type === "scale" || field.type === "number") {
      const n = Number(value);
      if (Number.isNaN(n)) {
        errors[field.key] = `${field.label} must be a number`;
      } else if (field.min !== undefined && n < field.min) {
        errors[field.key] = `${field.label} must be ≥ ${field.min}`;
      } else if (field.max !== undefined && n > field.max) {
        errors[field.key] = `${field.label} must be ≤ ${field.max}`;
      }
    }
  }

  return { ok: Object.keys(errors).length === 0, errors };
}
