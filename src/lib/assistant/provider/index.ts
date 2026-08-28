import { UnconfiguredProvider } from "./scripted";
import type { AiProvider } from "./types";

/**
 * Chooses the provider for a turn.
 *
 * There is no real model wired in yet, and that is deliberate: sending PHI to a
 * third party is gated on the privacy review in §8.3 of the plan (field
 * inventory per tool, retention, subprocessors, PIA). Until that closes, the
 * assistant runs end to end and refuses politely rather than quietly reaching
 * for a model nobody approved.
 *
 * When Claude is added it goes here, behind the same interface, and nothing
 * above this file changes.
 */
export function getProvider(): AiProvider {
  return new UnconfiguredProvider();
}

export type { AiProvider };
