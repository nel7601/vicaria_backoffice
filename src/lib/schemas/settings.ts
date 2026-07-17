import { z } from "zod";

/**
 * Settings DTOs (spec §6.1, FR-ADM-001/002).
 *
 * Form-facing schemas avoid `.default()` so the Zod input and output types
 * match (react-hook-form types the form on a single shape). Defaults are
 * supplied via the form's defaultValues instead.
 */

export const companySettingsSchema = z.object({
  legalName: z.string().trim().min(1, "Required").max(200),
  operatingName: z.string().trim().max(200).optional().or(z.literal("")),
  address: z.string().trim().max(500).optional().or(z.literal("")),
  phone: z.string().trim().max(32).optional().or(z.literal("")),
  email: z.string().trim().email().max(255).optional().or(z.literal("")),
  website: z.string().trim().url().max(255).optional().or(z.literal("")),
  timezone: z.string().trim().min(1).max(64),
  currency: z.string().trim().length(3),
  invoiceNumberPrefix: z.string().trim().min(1).max(16),
  legalFooterEn: z.string().trim().max(2000).optional().or(z.literal("")),
  legalFooterEs: z.string().trim().max(2000).optional().or(z.literal("")),
});

export type CompanySettingsInput = z.infer<typeof companySettingsSchema>;

export const locationSchema = z.object({
  name: z.string().trim().min(1, "Required").max(120),
  address: z.string().trim().max(500).optional().or(z.literal("")),
  phone: z.string().trim().max(32).optional().or(z.literal("")),
  timezone: z.string().trim().min(1).max(64),
});

export type LocationInput = z.infer<typeof locationSchema>;

/** Service catalog entry (FR-SVC-001). Price in cents; tax in basis points. */
export const serviceSchema = z.object({
  nameEn: z.string().trim().min(1, "Required").max(160),
  nameEs: z.string().trim().min(1, "Required").max(160),
  category: z.string().trim().max(80).optional().or(z.literal("")),
  defaultDurationMinutes: z.number().int().min(5).max(600),
  priceCents: z.number().int().min(0),
  taxRateBps: z.number().int().min(0).max(10000),
});

export type ServiceInput = z.infer<typeof serviceSchema>;

export const employeeSchema = z.object({
  email: z.string().trim().email().max(255),
  firstName: z.string().trim().min(1, "Required").max(120),
  lastName: z.string().trim().min(1, "Required").max(120),
  title: z.string().trim().max(120).optional().or(z.literal("")),
  isPractitioner: z.boolean(),
  role: z.enum([
    "owner",
    "administrator",
    "practitioner",
    "reception",
    "billing",
    "marketing",
    "auditor",
  ]),
});

export type EmployeeInput = z.infer<typeof employeeSchema>;
