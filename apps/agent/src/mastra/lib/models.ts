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
import { createAzure } from "@ai-sdk/azure";
import type { LanguageModelV3 } from "@ai-sdk/provider";

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
 *   STORYOS_ROUTER_PROVIDER  — "deepseek" | "alibaba" | "azure" (strict).
 * Optional env:
 *   STORYOS_ROUTER_MODEL     — per-provider model/deployment id, defaults
 *                              to a reasonable pick per provider.
 *
 * No implicit provider fallback — if the chosen provider's API key is
 * missing, the create* factory throws instead of silently switching to
 * another provider (that would hide real misconfiguration).
 */
export function defaultRouterModel(): LanguageModelV3 {
  return pickProviderModel("STORYOS_ROUTER_PROVIDER", "STORYOS_ROUTER_MODEL");
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
    throw new Error(`${providerEnv} is not set. Set to one of: deepseek | alibaba | azure.`);
  }
  if (provider === "azure") return createAzureModel(model || "gpt-4o");
  if (provider === "alibaba") return createAlibabaModel(model || "qwen3-max");
  if (provider === "deepseek") {
    return createDeepSeekModel((model as DeepSeekModelId | undefined) || "deepseek-chat");
  }
  throw new Error(`Unknown ${providerEnv}: "${provider}". Expected: deepseek | alibaba | azure.`);
}
