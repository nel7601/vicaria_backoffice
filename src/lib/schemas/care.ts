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
  /** Default visit task labels copied onto each new shift (spec §10.1). */
  defaultTasks: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
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
    "missed",
  ]),
  reason: z.string().trim().max(500).optional().or(z.literal("")),
  visitNotes: z.string().trim().max(2000).optional().or(z.literal("")),
});

export type CareShiftStatusChangeInput = z.infer<
  typeof careShiftStatusChangeSchema
>;

export const shiftTaskSchema = z.object({
  label: z.string().trim().min(1).max(120),
  status: z.enum(["pending", "done", "not_done", "na"]),
  comment: z.string().trim().max(300).optional().or(z.literal("")),
});

export const updateShiftTasksSchema = z.object({
  tasks: z.array(shiftTaskSchema).max(30),
});

export const careIncidentSchema = z.object({
  severity: z.enum(["low", "medium", "high", "critical"]),
  description: z.string().trim().min(5, "Describe the incident").max(3000),
});

export const approveShiftSchema = z.object({
  /** Approved billable minutes; defaults to actual worked minutes. */
  approvedMinutes: z.number().int().min(0).max(24 * 60).optional(),
  visitNotes: z.string().trim().max(2000).optional().or(z.literal("")),
});
