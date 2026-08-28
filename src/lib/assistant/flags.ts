/**
 * Assistant feature flags (§3 of the assistant plan).
 *
 * The assistant and its write actions must be switchable off without touching
 * the backoffice web. Every flag defaults to OFF so that deploying this code
 * changes nothing until someone opts in explicitly.
 *
 * The flags are nested on purpose: voice and write actions are meaningless
 * with the assistant disabled, and `reschedule_enabled` gates the single write
 * action of the pilot inside the wider write gate.
 */
export interface AssistantFlags {
  assistantEnabled: boolean;
  voiceEnabled: boolean;
  writeActionsEnabled: boolean;
  rescheduleEnabled: boolean;
}

function enabled(name: string): boolean {
  return (process.env[name] ?? "").toLowerCase() === "on";
}

export function assistantFlags(): AssistantFlags {
  const assistantEnabled = enabled("ASSISTANT_ENABLED");
  const writeActionsEnabled = assistantEnabled && enabled("ASSISTANT_WRITE_ACTIONS_ENABLED");
  return {
    assistantEnabled,
    voiceEnabled: assistantEnabled && enabled("ASSISTANT_VOICE_ENABLED"),
    writeActionsEnabled,
    rescheduleEnabled: writeActionsEnabled && enabled("ASSISTANT_RESCHEDULE_ENABLED"),
  };
}

/**
 * Minimum APK version this API still serves. The app compares it against its
 * own version and forces an update rather than failing in obscure ways when a
 * tool contract changes.
 */
export const MINIMUM_APP_VERSION = "0.1.0";

/** Assistant API contract version, mirrored in the `/v1` path segment. */
export const ASSISTANT_API_VERSION = 1;
