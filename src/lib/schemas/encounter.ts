import { z } from "zod";

/** Encounter DTOs (spec §6.4). */

export const createEncounterSchema = z.object({
  patientId: z.string().uuid(),
  practitionerId: z.string().uuid(),
  serviceId: z.string().uuid().optional(),
  templateVersionId: z.string().uuid().optional(),
  appointmentId: z.string().uuid().optional(),
  modality: z.enum(["in_person", "virtual", "phone"]),
});

export type CreateEncounterInput = z.infer<typeof createEncounterSchema>;

export const saveDraftSchema = z.object({
  answers: z.record(z.string(), z.unknown()),
  summary: z.string().max(5000).optional(),
});

export type SaveDraftInput = z.infer<typeof saveDraftSchema>;

export const amendmentSchema = z.object({
  body: z.string().trim().min(1, "Amendment text is required").max(5000),
});

export type AmendmentInput = z.infer<typeof amendmentSchema>;

export const measurementSchema = z.object({
  observationType: z.string().trim().min(1).max(80),
  valueNumeric: z.number().int().optional(),
  valueText: z.string().max(500).optional(),
  unit: z.string().max(32).optional(),
  comment: z.string().max(500).optional(),
});

export type MeasurementInput = z.infer<typeof measurementSchema>;
