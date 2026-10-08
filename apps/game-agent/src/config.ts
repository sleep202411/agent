import { z } from "zod";
import { isAbsolute, normalize, parse, sep } from "node:path";

const required = (environment: NodeJS.ProcessEnv, name: string) => {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required for Game Agent.`);
  return value;
};

export function validateGameAgentWorkspaceRoot(value: string) {
  if (
    !isAbsolute(value) ||
    value !== normalize(value) ||
    value === parse(value).root ||
    value.endsWith(sep) ||
    value.length > 4096 ||
    [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    throw new Error("GAME_AGENT_WORKSPACE_ROOT must be an absolute normalized private directory.");
  return value;
}

/** Provider credentials belong to this service, never to Studio or the game iframe. */
export function readGameAgentModelConfig(environment: NodeJS.ProcessEnv = process.env) {
  const model = z.string().min(1).max(128).parse(required(environment, "GAME_AGENT_MODEL"));
  const apiKey = required(environment, "GAME_AGENT_OPENAI_API_KEY");
  let endpoint: URL;
  try {
    endpoint = new URL(required(environment, "GAME_AGENT_OPENAI_BASE_URL"));
  } catch {
    throw new Error("GAME_AGENT_OPENAI_BASE_URL must be a complete HTTP(S) provider base URL.");
  }
  if (
    !["http:", "https:"].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  )
    throw new Error(
      "GAME_AGENT_OPENAI_BASE_URL must be an HTTP(S) URL without embedded credentials, query or fragment."
    );
  const thinking = environment.GAME_AGENT_THINKING?.trim() || "false";
  if (!["true", "false"].includes(thinking))
    throw new Error("GAME_AGENT_THINKING must be true or false.");
  const maxTokens = Number(environment.GAME_AGENT_MAX_TOKENS?.trim() || "8192");
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 200_000)
    throw new Error("GAME_AGENT_MAX_TOKENS must be an integer between 1 and 200000.");
  return {
    model: { model, maxTokens, enableThinking: thinking === "true" },
    route: { baseUrl: endpoint.href.replace(/\/$/, ""), apiKey },
  };
}

export function readGameAgentServiceConfig(environment: NodeJS.ProcessEnv = process.env) {
  const internalToken = required(environment, "GAME_AGENT_INTERNAL_TOKEN");
  if (
    internalToken.length < 16 ||
    internalToken.length > 256 ||
    /change-me|dev-only/i.test(internalToken)
  )
    throw new Error("GAME_AGENT_INTERNAL_TOKEN must be a real secret of 16–256 characters.");
  const port = Number(required(environment, "GAME_AGENT_PORT"));
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("GAME_AGENT_PORT must be an integer between 1024 and 65535.");
  const bindAddress = environment.GAME_AGENT_BIND_ADDRESS?.trim() || "127.0.0.1";
  if (!["127.0.0.1", "0.0.0.0", "::1", "::"].includes(bindAddress))
    throw new Error("GAME_AGENT_BIND_ADDRESS must be a supported loopback or wildcard address.");
  const workspaceRoot = validateGameAgentWorkspaceRoot(
    required(environment, "GAME_AGENT_WORKSPACE_ROOT")
  );
  return { internalToken, port, bindAddress, workspaceRoot };
}
