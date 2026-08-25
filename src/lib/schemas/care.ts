import { z } from "zod";

/** Home-care DTOs (Vicaria Care service). */

export const careAgreementSchema = z.object({
  patientId: z.string().uuid("Select a client"),
  weeklyHours: z.number().min(0.5, "At least 30 minutes").max(168),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Start date required"),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal("")),
  hourlyRateDollars: z.number().min(0).max(10000),
  carePlan: z.string().trim().max(4000).optional().or(z.literal("")),
  address: z.string().trim().max(500).optional().or(z.literal("")),
});

export type CareAgreementInput = z.infer<typeof careAgreementSchema>;

export const careContactSchema = z.object({
  name: z.string().trim().min(1, "Required").max(200),
  relationship: z.string().trim().max(80).optional().or(z.literal("")),
  phone: z.string().trim().max(32).optional().or(z.literal("")),
  email: z.string().trim().email().max(255).optional().or(z.literal("")),
  isPrimary: z.boolean(),
  canApprove: z.boolean(),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});

export type CareContactInput = z.infer<typeof careContactSchema>;

export const careShiftSchema = z.object({
  caregiverId: z.string().uuid("Select a caregiver"),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  visitNotes: z.string().trim().max(2000).optional().or(z.literal("")),
});

export type CareShiftInput = z.infer<typeof careShiftSchema>;

export const careShiftStatusChangeSchema = z.object({
  status: z.enum([
    "confirmed",
    "in_progress",
    "completed",
    "cancelled",
    "no_show",
  ]),
  reason: z.string().trim().max(500).optional().or(z.literal("")),
  visitNotes: z.string().trim().max(2000).optional().or(z.literal("")),
});

export type CareShiftStatusChangeInput = z.infer<
  typeof careShiftStatusChangeSchema
>;
