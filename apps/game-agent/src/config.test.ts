import { expect, it } from "vitest";
import { readGameAgentModelConfig, readGameAgentServiceConfig } from "./config.js";

const modelEnvironment = {
  GAME_AGENT_MODEL: "qwen3.7-flash",
  GAME_AGENT_OPENAI_BASE_URL: "https://provider.example/compatible-mode/v1/",
  GAME_AGENT_OPENAI_API_KEY: "local-test-key",
};

it("uses its own provider configuration and preserves the full compatibility path", () => {
  expect(readGameAgentModelConfig(modelEnvironment)).toEqual({
    model: { model: "qwen3.7-flash", enableThinking: false, maxTokens: 8192 },
    route: { baseUrl: "https://provider.example/compatible-mode/v1", apiKey: "local-test-key" },
  });
});

it("does not silently inherit Agent OS credentials or model selection", () => {
  expect(() =>
    readGameAgentModelConfig({
      AGENT_OS_OPENAI_BASE_URL: "https://provider.example/v1",
      AGENT_OS_OPENAI_API_KEY: "unrelated-secret",
      AGENT_OS_APPEARANCE_MODEL_PROFILE: "qwen3.7-flash",
    })
  ).toThrow("GAME_AGENT_MODEL is required");
  expect(() =>
    readGameAgentModelConfig({ ...modelEnvironment, GAME_AGENT_OPENAI_API_KEY: "" })
  ).toThrow("GAME_AGENT_OPENAI_API_KEY is required");
});

it("rejects unsafe provider URLs without including credentials in the error", () => {
  for (const url of [
    "file:///tmp/model",
    "https://user:secret@provider.example/v1",
    "https://provider.example/v1?key=secret",
  ]) {
    expect(() =>
      readGameAgentModelConfig({ ...modelEnvironment, GAME_AGENT_OPENAI_BASE_URL: url })
    ).toThrow(/GAME_AGENT_OPENAI_BASE_URL/);
  }
});

it("rejects malformed tuning rather than silently falling back", () => {
  expect(() =>
    readGameAgentModelConfig({ ...modelEnvironment, GAME_AGENT_THINKING: "off" })
  ).toThrow("true or false");
  expect(() =>
    readGameAgentModelConfig({ ...modelEnvironment, GAME_AGENT_MAX_TOKENS: "NaN" })
  ).toThrow("integer");
});

it("requires independent service credentials and defaults only the bind address", () => {
  const environment = {
    GAME_AGENT_PORT: "4396",
    GAME_AGENT_INTERNAL_TOKEN: "test-independent-secret",
    GAME_AGENT_WORKSPACE_ROOT: "/var/lib/game-agent/workspaces",
  };
  expect(readGameAgentServiceConfig(environment)).toEqual({
    port: 4396,
    internalToken: "test-independent-secret",
    bindAddress: "127.0.0.1",
    workspaceRoot: "/var/lib/game-agent/workspaces",
  });
  expect(() => readGameAgentServiceConfig({ ...environment, GAME_AGENT_PORT: "" })).toThrow(
    "required"
  );
  expect(() =>
    readGameAgentServiceConfig({
      ...environment,
      GAME_AGENT_INTERNAL_TOKEN: "dev-only-change-me-16+",
    })
  ).toThrow("real secret");
});

it("requires an explicit durable workspace directory and rejects unsafe paths", () => {
  const environment = {
    GAME_AGENT_PORT: "4396",
    GAME_AGENT_INTERNAL_TOKEN: "test-independent-secret",
  };
  expect(() => readGameAgentServiceConfig(environment)).toThrow(
    "GAME_AGENT_WORKSPACE_ROOT is required"
  );
  for (const root of ["relative/workspaces", "/", "/var/lib/../workspaces", "/tmp/workspaces/"])
    expect(() =>
      readGameAgentServiceConfig({ ...environment, GAME_AGENT_WORKSPACE_ROOT: root })
    ).toThrow("absolute normalized private directory");
});
