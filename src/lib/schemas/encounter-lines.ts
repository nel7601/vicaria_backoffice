import { z } from "zod";

/**
 * Encounter service lines (spec §7.1/§8): what was actually performed, with
 * quantities — e.g. 1 consultation + 5 simple lesions + 1 complex.
 */
export const encounterLineSchema = z.object({
  serviceId: z.string().uuid().optional().or(z.literal("")),
  description: z.string().trim().min(1, "Description required").max(300),
  quantity: z.number().int().min(1).max(999),
  unitPriceCents: z.number().int().min(0),
  taxRateBps: z.number().int().min(0).max(10000),
});

export type EncounterLineInput = z.infer<typeof encounterLineSchema>;
