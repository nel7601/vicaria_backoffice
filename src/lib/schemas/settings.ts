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

/** Service catalog entry (FR-SVC-001 + spec §3). Price in cents; tax in bps. */
export const serviceSchema = z.object({
  nameEn: z.string().trim().min(1, "Required").max(160),
  nameEs: z.string().trim().min(1, "Required").max(160),
  category: z.string().trim().max(80).optional().or(z.literal("")),
  family: z.enum(["clinic", "coaching", "home_care"]),
  billingUnit: z.enum(["fixed", "per_unit", "per_hour", "per_session"]),
  defaultDurationMinutes: z.number().int().min(5).max(600),
  priceCents: z.number().int().min(0),
  taxRateBps: z.number().int().min(0).max(10000),
});

export type ServiceInput = z.infer<typeof serviceSchema>;

/** Service update — same fields plus active flag. */
export const updateServiceSchema = serviceSchema.extend({
  isActive: z.boolean(),
});

export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;

export const updateCategorySchema = z.object({
  name: z.string().trim().min(1, "Required").max(80),
  nameEs: z.string().trim().max(80).optional().or(z.literal("")),
  isActive: z.boolean(),
});

export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

/**
 * Acquisition source (spec §14 "Client Source"). Renaming one rewrites every
 * patient that pointed at the old name, so the report keeps counting the same
 * channel rather than splitting it in two.
 */
export const updateAcquisitionSourceSchema = z.object({
  name: z.string().trim().min(1, "Required").max(120),
  nameEs: z.string().trim().max(120).optional().or(z.literal("")),
  isActive: z.boolean(),
});

export type UpdateAcquisitionSourceInput = z.infer<
  typeof updateAcquisitionSourceSchema
>;

export const roleEnum = z.enum([
  "owner",
  "administrator",
  "practitioner",
  "reception",
  "billing",
  "marketing",
  "auditor",
]);

export const updateEmployeeSchema = z.object({
  firstName: z.string().trim().min(1, "Required").max(120),
  lastName: z.string().trim().min(1, "Required").max(120),
  title: z.string().trim().max(120).optional().or(z.literal("")),
  isPractitioner: z.boolean(),
  isCaregiver: z.boolean(),
  isActive: z.boolean(),
  roles: z.array(roleEnum),
});

export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;

export const employeeSchema = z.object({
  email: z.string().trim().email().max(255),
  firstName: z.string().trim().min(1, "Required").max(120),
  lastName: z.string().trim().min(1, "Required").max(120),
  title: z.string().trim().max(120).optional().or(z.literal("")),
  isPractitioner: z.boolean(),
  isCaregiver: z.boolean(),
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
