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
    baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1",
    apiKey,
  });
  return provider.chatModel(modelId);
}

// ─── Alibaba DashScope ────────────────────────────────────────────────

type AlibabaModelId = "qwen3-max" | "qwen-plus" | "qwen-turbo" | "qwen-max" | string;

export function createAlibabaModel(modelId: AlibabaModelId = "qwen3-max"): LanguageModelV3 {
  const apiKey = process.env.ALIBABA_API_KEY ?? process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    throw new Error("ALIBABA_API_KEY (or DASHSCOPE_API_KEY) is not set.");
  }
  const provider = createAlibaba({
    apiKey,
    baseURL: process.env.ALIBABA_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1",
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
 * Provider selection (via env):
 *   STORYOS_ROUTER_PROVIDER=azure    → Azure OpenAI / Foundry
 *   STORYOS_ROUTER_PROVIDER=alibaba  → Alibaba DashScope (qwen)
 *   (anything else or unset)         → DeepSeek (default when API key present)
 *                                      falls back to Alibaba if DeepSeek key
 *                                      is missing.
 *
 * STORYOS_ROUTER_MODEL is interpreted per-provider:
 *   azure    → deployment name
 *   alibaba  → qwen model id
 *   deepseek → "deepseek-chat" | "deepseek-reasoner"
 */
export function defaultRouterModel(): LanguageModelV3 {
  const provider = process.env.STORYOS_ROUTER_PROVIDER;
  if (provider === "azure") {
    return createAzureModel(process.env.STORYOS_ROUTER_MODEL ?? "gpt-4o");
  }
  if (provider === "alibaba" || !process.env.DEEPSEEK_API_KEY) {
    return createAlibabaModel(process.env.STORYOS_ROUTER_MODEL ?? "qwen3-max");
  }
  return createDeepSeekModel(
    (process.env.STORYOS_ROUTER_MODEL as DeepSeekModelId | undefined) ?? "deepseek-chat"
  );
}

/**
 * Persona agents (role-designer, scriptwriter, storyboard-artist, mood-master,
 * art-director, scene-designer, analyst, episode-planner, evaluator).
 *
 * Provider selection mirrors defaultRouterModel, via STORYOS_PERSONA_PROVIDER
 * and STORYOS_PERSONA_MODEL. For creative Chinese writing DeepSeek / Qwen
 * tend to be stronger; Azure GPT-4o shines on structured reasoning and
 * tool-use stability.
 */
export function defaultPersonaModel(): LanguageModelV3 {
  const provider = process.env.STORYOS_PERSONA_PROVIDER;
  if (provider === "azure") {
    return createAzureModel(process.env.STORYOS_PERSONA_MODEL ?? "gpt-4o");
  }
  if (provider === "alibaba") {
    return createAlibabaModel(process.env.STORYOS_PERSONA_MODEL ?? "qwen3-max");
  }
  return createDeepSeekModel(
    (process.env.STORYOS_PERSONA_MODEL as DeepSeekModelId | undefined) ?? "deepseek-chat"
  );
}
