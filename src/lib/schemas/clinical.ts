import { z } from "zod";

/** Treatment plan & follow-up task DTOs (spec §6.4). */

export const createPlanSchema = z.object({
  patientId: z.string().uuid(),
  title: z.string().trim().min(1, "Required").max(200),
  objective: z.string().trim().max(2000).optional(),
});

export type CreatePlanInput = z.infer<typeof createPlanSchema>;

export const createTaskSchema = z.object({
  patientId: z.string().uuid(),
  title: z.string().trim().min(1, "Required").max(200),
  dueDate: z.string().date().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
