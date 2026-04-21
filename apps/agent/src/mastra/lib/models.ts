/**
 * Language model factories — thin wrappers over AI SDK providers.
 *
 * We intentionally use the AI SDK directly instead of Mastra's model-router
 * string form (`"deepseek/deepseek-chat"`). Rationale:
 *   - Explicit dependencies (the packages you need appear in package.json)
 *   - Standard AI SDK inputs/outputs — no Mastra-specific magic
 *   - Easier to customize (add headers, override fetch, inject middleware)
 *   - Type system catches model-id typos at build time via provider unions
 *
 * Usage from an Agent:
 *   import { defaultRouterModel, rolePersonaModel } from '../lib/models';
 *   new Agent({ model: defaultRouterModel(), ... })
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAlibaba } from "@ai-sdk/alibaba";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createAzure } from "@ai-sdk/azure";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { hardenAnthropicModel } from "./model-hardening";

/**
 * Env var reader that treats empty/whitespace strings as missing. Crucial
 * because docker-compose's `${VAR:-}` pattern yields an empty string when
 * the .env doesn't set VAR — and `??` only tripwires null/undefined, so
 * a naive `process.env.FOO ?? default` hands the SDK an empty baseURL and
 * it crashes with ERR_INVALID_URL when it tries to append `/chat/completions`.
 */
function envOrDefault(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v : fallback;
}

// ─── DeepSeek (OpenAI-compatible) ─────────────────────────────────────

type DeepSeekModelId = "deepseek-chat" | "deepseek-reasoner";

export function createDeepSeekModel(modelId: DeepSeekModelId = "deepseek-chat"): LanguageModelV3 {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error(
      "DEEPSEEK_API_KEY is not set. DeepSeek uses the OpenAI-compatible API at https://api.deepseek.com."
    );
  }
  const provider = createOpenAICompatible({
    name: "deepseek",
    baseURL: envOrDefault("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1"),
    apiKey,
  });
  return provider.chatModel(modelId);
}

// ─── Alibaba DashScope ────────────────────────────────────────────────

type AlibabaModelId = "qwen3-max" | "qwen-plus" | "qwen-turbo" | "qwen-max" | string;

export function createAlibabaModel(modelId: AlibabaModelId = "qwen3-max"): LanguageModelV3 {
  const alibabaKey = process.env.ALIBABA_API_KEY?.trim();
  const dashscopeKey = process.env.DASHSCOPE_API_KEY?.trim();
  const apiKey = alibabaKey || dashscopeKey;
  if (!apiKey) {
    throw new Error("ALIBABA_API_KEY (or DASHSCOPE_API_KEY) is not set.");
  }
  const provider = createAlibaba({
    apiKey,
    baseURL: envOrDefault("ALIBABA_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1"),
  });
  return provider(modelId);
}

// ─── Anthropic (Claude) ──────────────────────────────────────────────

/**
 * Claude model IDs. Use a string union for the common current ones but
 * allow arbitrary strings — Anthropic ships new snapshots frequently and
 * we don't want a compile error when someone sets STORYOS_ROUTER_MODEL
 * to a new date-pinned snapshot like `claude-sonnet-4-5-20250929`.
 */
type AnthropicModelId =
  | "claude-sonnet-4-5"
  | "claude-opus-4-6"
  | "claude-opus-4-7"
  | "claude-haiku-4-5"
  | (string & {});

/**
 * Anthropic direct (not via Replicate). Used for the supervisor where
 * long-prompt instruction following and Chinese nuance matter. Personas
 * stay on DeepSeek for cost (persona = high token volume, supervisor =
 * low frequency), so Claude's $3/$15 per MTok pricing shows up only in
 * the routing layer's small footprint.
 */
export function createAnthropicModel(
  modelId: AnthropicModelId = "claude-sonnet-4-5"
): LanguageModelV3 {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Get one from https://console.anthropic.com/settings/keys."
    );
  }
  const provider = createAnthropic({
    apiKey,
    baseURL: envOrDefault("ANTHROPIC_BASE_URL", "https://api.anthropic.com/v1"),
  });
  return provider(modelId);
}

// ─── Azure OpenAI / AI Foundry ────────────────────────────────────────

/**
 * Azure OpenAI deployments hosted on AI Foundry.
 *
 * Required env:
 *   AZURE_OPENAI_API_KEY        — API key from Foundry
 *   AZURE_OPENAI_RESOURCE_NAME  — the "resourceName" part of
 *                                 https://<resource>.openai.azure.com
 *
 * Optional env:
 *   AZURE_OPENAI_API_VERSION    — default "2024-10-21"
 *   AZURE_OPENAI_BASE_URL       — full override for custom endpoints
 *                                 (Foundry regional endpoints, AI gateway,
 *                                 etc.). Wins over resourceName if set.
 *
 * The string passed in must be an Azure **deployment name** (what you
 * configured in Foundry), NOT the underlying model id. Two deployments
 * of the same model are distinct.
 */
export function createAzureModel(deploymentName: string): LanguageModelV3 {
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const resourceName = process.env.AZURE_OPENAI_RESOURCE_NAME;
  const baseURL = process.env.AZURE_OPENAI_BASE_URL;
  if (!apiKey) {
    throw new Error("AZURE_OPENAI_API_KEY is not set. Grab it from your Foundry project settings.");
  }
  if (!resourceName && !baseURL) {
    throw new Error("Either AZURE_OPENAI_RESOURCE_NAME or AZURE_OPENAI_BASE_URL must be set.");
  }
  const azure = createAzure({
    apiKey,
    ...(baseURL ? { baseURL } : { resourceName: resourceName! }),
    apiVersion: process.env.AZURE_OPENAI_API_VERSION ?? "2024-10-21",
  });
  return azure(deploymentName);
}

// ─── Agent-level defaults ─────────────────────────────────────────────

/**
 * Supervisor / router model.
 *
 * Required env:
 *   STORYOS_ROUTER_PROVIDER  — "deepseek" | "alibaba" | "anthropic" | "azure"
 *                              (strict).
 * Optional env:
 *   STORYOS_ROUTER_MODEL     — per-provider model/deployment id, defaults
 *                              to a reasonable pick per provider.
 *
 * No implicit provider fallback — if the chosen provider's API key is
 * missing, the create* factory throws instead of silently switching to
 * another provider (that would hide real misconfiguration).
 *
 * Recommended for supervisor: anthropic / claude-sonnet-4-5 — best
 * tool-use stability and long-prompt instruction following on our
 * 500-line supervisor prompt. DeepSeek cheaper but has known
 * weaknesses (jumps steps, echoes button labels as prose).
 *
 * When the router is Anthropic, the returned model is wrapped with
 * `hardenAnthropicModel` — a three-layer middleware chain (rate-limit
 * queue → circuit breaker → DeepSeek fallback) that keeps the supervisor
 * responsive under Tier-limited burst load. Other providers pass through
 * unwrapped; DeepSeek self-throttles at the gateway (500-concurrent
 * loadtest was clean).
 */
export function defaultRouterModel(): LanguageModelV3 {
  const provider = process.env.STORYOS_ROUTER_PROVIDER?.trim();
  const base = pickProviderModel("STORYOS_ROUTER_PROVIDER", "STORYOS_ROUTER_MODEL");
  if (provider !== "anthropic") return base;
  // Fallback target must exist *before* the first Claude call so a
  // mid-turn fallback doesn't crash on "DeepSeek not configured".
  const fallback = createDeepSeekModel(
    (process.env.STORYOS_ROUTER_FALLBACK_MODEL as
      | "deepseek-chat"
      | "deepseek-reasoner"
      | undefined) ?? "deepseek-chat"
  );
  return hardenAnthropicModel(base, fallback);
}

/**
 * Persona agents (role-designer, scriptwriter, storyboarder, etc).
 * Same strict selection as defaultRouterModel, via STORYOS_PERSONA_PROVIDER
 * and STORYOS_PERSONA_MODEL.
 */
export function defaultPersonaModel(): LanguageModelV3 {
  return pickProviderModel("STORYOS_PERSONA_PROVIDER", "STORYOS_PERSONA_MODEL");
}

/**
 * Shared provider resolver. Strict — throws if PROVIDER env isn't set or
 * isn't one of the known values. Silent fallbacks to "some other provider
 * because my key wasn't set" make misconfiguration invisible (you think
 * you're running DeepSeek, you're actually on Qwen), so we refuse to guess.
 *
 * Model id inside each provider falls back to a sensible default — that's
 * tuning, not provider selection.
 */
function pickProviderModel(providerEnv: string, modelEnv: string): LanguageModelV3 {
  const provider = process.env[providerEnv]?.trim();
  const model = process.env[modelEnv]?.trim();
  if (!provider) {
    throw new Error(
      `${providerEnv} is not set. Set to one of: deepseek | alibaba | anthropic | azure.`
    );
  }
  if (provider === "azure") return createAzureModel(model || "gpt-4o");
  if (provider === "alibaba") return createAlibabaModel(model || "qwen3-max");
  if (provider === "anthropic") return createAnthropicModel(model || "claude-sonnet-4-5");
  if (provider === "deepseek") {
    return createDeepSeekModel((model as DeepSeekModelId | undefined) || "deepseek-chat");
  }
  throw new Error(
    `Unknown ${providerEnv}: "${provider}". Expected: deepseek | alibaba | anthropic | azure.`
  );
}
