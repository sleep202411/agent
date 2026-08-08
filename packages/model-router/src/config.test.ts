import { describe, expect, it } from "vitest";

import {
  isLiveModelConfigured,
  normalizeOpenAiCompatibleBaseUrl,
  readLiteLlmConfigFromEnv,
} from "./config.js";

describe("normalizeOpenAiCompatibleBaseUrl", () => {
  it("does not double-append /v1 for Qwen compatible-mode", () => {
    const url = "https://example.maas.aliyuncs.com/compatible-mode/v1";
    expect(normalizeOpenAiCompatibleBaseUrl(url)).toBe(url);
  });

  it("appends /v1 for bare hosts", () => {
    expect(normalizeOpenAiCompatibleBaseUrl("https://litellm.local")).toBe(
      "https://litellm.local/v1"
    );
  });
});

describe("readLiteLlmConfigFromEnv", () => {
  it("accepts AGENT_OS_OPENAI_* for direct Qwen", () => {
    const config = readLiteLlmConfigFromEnv({
      AGENT_OS_OPENAI_BASE_URL: "https://example.maas.aliyuncs.com/compatible-mode/v1",
      AGENT_OS_OPENAI_API_KEY: "sk-test",
      AGENT_OS_DEFAULT_MODEL: "qwen-plus",
    });
    expect(config.baseUrl).toContain("compatible-mode/v1");
    expect(config.apiKey).toBe("sk-test");
    expect(config.defaultModel).toBe("qwen-plus");
  });

  it("detects live config", () => {
    expect(
      isLiveModelConfigured({
        AGENT_OS_OPENAI_BASE_URL: "https://x/v1",
        AGENT_OS_OPENAI_API_KEY: "k",
      })
    ).toBe(true);
    expect(isLiveModelConfigured({})).toBe(false);
  });
});
