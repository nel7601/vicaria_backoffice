import { afterEach, describe, expect, it } from "vitest";
import { getProvider, providerConfigured } from "@/lib/assistant/provider";
import { tokenLimitField } from "@/lib/assistant/provider/openai";

/**
 * The seam exists so that moving to a model you host is configuration, not a
 * rewrite. These pin the two halves of that promise: nothing runs unless it
 * was chosen explicitly, and choosing a self-hosted endpoint reaches the same
 * code path as the public one.
 */

const VARS = [
  "ASSISTANT_AI_PROVIDER",
  "ASSISTANT_AI_API_KEY",
  "ASSISTANT_AI_BASE_URL",
  "ASSISTANT_AI_MODEL",
  "ASSISTANT_AI_LABEL",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
];

afterEach(() => {
  for (const v of VARS) delete process.env[v];
});

describe("choosing a provider", () => {
  it("refuses everything when nothing is configured", () => {
    expect(getProvider().name).toBe("unconfigured");
    expect(providerConfigured()).toBe(false);
  });

  it("refuses when a provider is named but has no key", () => {
    process.env.ASSISTANT_AI_PROVIDER = "openai";
    expect(getProvider().name).toBe("unconfigured");
  });

  it("does not reach for a model just because a key is lying around", () => {
    // A key in the environment for some other purpose must not switch the
    // assistant on by itself.
    process.env.OPENAI_API_KEY = "sk-test";
    expect(getProvider().name).toBe("unconfigured");
  });

  it("uses the OpenAI-compatible provider when asked", () => {
    process.env.ASSISTANT_AI_PROVIDER = "openai";
    process.env.ASSISTANT_AI_API_KEY = "sk-test";
    expect(getProvider().name).toBe("openai");
  });

  it("reaches the same implementation for a self-hosted endpoint", () => {
    process.env.ASSISTANT_AI_PROVIDER = "vllm";
    process.env.ASSISTANT_AI_API_KEY = "local";
    process.env.ASSISTANT_AI_BASE_URL = "http://gpu.internal:8000/v1";
    // Named after the deployment so audit says which one answered.
    expect(getProvider().name).toBe("vllm");
  });

  it("lets a deployment name itself", () => {
    process.env.ASSISTANT_AI_PROVIDER = "local";
    process.env.ASSISTANT_AI_API_KEY = "local";
    process.env.ASSISTANT_AI_LABEL = "vicaria-gpu-01";
    expect(getProvider().name).toBe("vicaria-gpu-01");
  });

  it("still supports Claude behind the same seam", () => {
    process.env.ASSISTANT_AI_PROVIDER = "claude";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    expect(getProvider().name).toBe("claude");
  });
});

describe("the output cap changes name by model", () => {
  it("uses the reasoning-model field for gpt-5 and later", () => {
    expect(tokenLimitField("gpt-5.1")).toBe("max_completion_tokens");
    expect(tokenLimitField("gpt-5-mini")).toBe("max_completion_tokens");
  });

  it("uses the classic field elsewhere, which is what self-hosted servers know", () => {
    expect(tokenLimitField("gpt-4.1")).toBe("max_tokens");
    expect(tokenLimitField("llama-3.3-70b-instruct")).toBe("max_tokens");
    expect(tokenLimitField("qwen2.5-72b")).toBe("max_tokens");
  });
});
