import { z } from "zod";

/**
 * Patient DTO contracts (spec §6.2). Shared between client forms
 * (React Hook Form) and server validation (§9.1 "validación compartida").
 */

export const patientLanguage = z.enum(["en", "es"]);

export const patientStatus = z.enum([
  "prospect",
  "active",
  "inactive",
  "blocked",
  "deceased",
]);

// Loose E.164: optional +, 8-15 digits. Normalization happens server-side.
const phoneE164 = z
  .string()
  .trim()
  .regex(/^\+?[1-9]\d{7,14}$/, "Invalid phone number")
  .optional()
  .or(z.literal(""));

export const createPatientSchema = z.object({
  legalFirstName: z.string().trim().min(1, "Required").max(120),
  legalLastName: z.string().trim().min(1, "Required").max(120),
  preferredName: z.string().trim().max(120).optional(),
  pronouns: z.string().trim().max(40).optional(),
  dateOfBirth: z.string().date().optional(),
  email: z.string().trim().toLowerCase().email().max(255).optional().or(z.literal("")),
  phoneE164,
  address: z.string().trim().max(500).optional(),
  preferredLanguage: patientLanguage,
  status: patientStatus,
  emergencyContactName: z.string().trim().max(200).optional(),
  emergencyContactPhone: phoneE164,
  acquisitionSource: z.string().trim().max(120).optional(),
});

export type CreatePatientInput = z.infer<typeof createPatientSchema>;

/** Duplicate-check query (§FR-PAT-002). */
export const duplicateCheckSchema = z.object({
  email: z.string().email().optional(),
  phoneE164: z.string().optional(),
  legalFirstName: z.string().optional(),
  legalLastName: z.string().optional(),
  dateOfBirth: z.string().date().optional(),
});

export type DuplicateCheckInput = z.infer<typeof duplicateCheckSchema>;
