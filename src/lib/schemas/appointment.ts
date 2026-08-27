import { z } from "zod";

/** Appointment DTOs (spec §6.3). */

export const appointmentModality = z.enum(["in_person", "virtual", "phone"]);

export const appointmentStatus = z.enum([
  "scheduled",
  "confirmed",
  "checked_in",
  "in_progress",
  "completed",
  "cancelled",
  "no_show",
  "rescheduled",
]);

export const createAppointmentSchema = z
  .object({
    patientId: z.string().uuid(),
    serviceId: z.string().uuid().optional(),
    employeeId: z.string().uuid(),
    locationId: z.string().uuid().optional(),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    modality: appointmentModality.default("in_person"),
    estimatedPriceCents: z.number().int().min(0).default(0),
    notesAdmin: z.string().max(2000).optional(),
  })
  // §FR-APT-002: end must be after start.
  .refine((v) => new Date(v.endAt) > new Date(v.startAt), {
    message: "end_at must be after start_at",
    path: ["endAt"],
  });

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;

/** Editing an appointment while it is still upcoming (spec §7). */
export const updateAppointmentSchema = z
  .object({
    serviceId: z.string().uuid().optional().or(z.literal("")),
    employeeId: z.string().uuid(),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    modality: appointmentModality,
    notesAdmin: z.string().max(2000).optional().or(z.literal("")),
  })
  .refine((v) => new Date(v.endAt) > new Date(v.startAt), {
    message: "End must be after start",
    path: ["endAt"],
  });

export type UpdateAppointmentInput = z.infer<typeof updateAppointmentSchema>;

export const changeStatusSchema = z.object({
  status: appointmentStatus,
  reason: z.string().max(500).optional(),
});

export type ChangeStatusInput = z.infer<typeof changeStatusSchema>;
