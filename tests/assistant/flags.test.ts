import { afterEach, describe, expect, it } from "vitest";
import { assistantFlags } from "@/lib/assistant/flags";

const FLAG_VARS = [
  "ASSISTANT_ENABLED",
  "ASSISTANT_VOICE_ENABLED",
  "ASSISTANT_WRITE_ACTIONS_ENABLED",
  "ASSISTANT_RESCHEDULE_ENABLED",
];

afterEach(() => {
  for (const name of FLAG_VARS) delete process.env[name];
});

describe("assistant feature flags", () => {
  it("is entirely off when nothing is configured", () => {
    expect(assistantFlags()).toEqual({
      assistantEnabled: false,
      voiceEnabled: false,
      writeActionsEnabled: false,
      rescheduleEnabled: false,
    });
  });

  it("keeps voice and writes off while the assistant itself is off", () => {
    process.env.ASSISTANT_VOICE_ENABLED = "on";
    process.env.ASSISTANT_WRITE_ACTIONS_ENABLED = "on";
    process.env.ASSISTANT_RESCHEDULE_ENABLED = "on";
    const flags = assistantFlags();
    expect(flags.voiceEnabled).toBe(false);
    expect(flags.writeActionsEnabled).toBe(false);
    expect(flags.rescheduleEnabled).toBe(false);
  });

  it("gates reschedule behind the wider write switch", () => {
    process.env.ASSISTANT_ENABLED = "on";
    process.env.ASSISTANT_RESCHEDULE_ENABLED = "on";
    expect(assistantFlags().rescheduleEnabled).toBe(false);

    process.env.ASSISTANT_WRITE_ACTIONS_ENABLED = "on";
    expect(assistantFlags().rescheduleEnabled).toBe(true);
  });

  it("only accepts the exact opt-in value", () => {
    process.env.ASSISTANT_ENABLED = "true";
    expect(assistantFlags().assistantEnabled).toBe(false);
    process.env.ASSISTANT_ENABLED = "ON";
    expect(assistantFlags().assistantEnabled).toBe(true);
  });
});
