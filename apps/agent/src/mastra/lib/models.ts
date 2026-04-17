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

// ─── Agent-level defaults ─────────────────────────────────────────────

/**
 * Router-agent model. Prefers DeepSeek (cheap, fast, decent for tool calling);
 * falls back to Alibaba qwen3-max only if DEEPSEEK_API_KEY is missing. The
 * router does structured tool calling, so stability matters — if DeepSeek
 * proves flaky in production, flip the default here.
 */
export function defaultRouterModel(): LanguageModelV3 {
  if (process.env.STORYOS_ROUTER_PROVIDER === "alibaba" || !process.env.DEEPSEEK_API_KEY) {
    return createAlibabaModel(process.env.STORYOS_ROUTER_MODEL ?? "qwen3-max");
  }
  return createDeepSeekModel(
    (process.env.STORYOS_ROUTER_MODEL as DeepSeekModelId | undefined) ?? "deepseek-chat"
  );
}

/**
 * Persona agents (role-designer, scriptwriter, storyboard-artist, mood-master)
 * — long-form structured output. DeepSeek is the default for cost; personas
 * that need stronger creative writing can override via env.
 */
export function defaultPersonaModel(): LanguageModelV3 {
  if (process.env.STORYOS_PERSONA_PROVIDER === "alibaba") {
    return createAlibabaModel(process.env.STORYOS_PERSONA_MODEL ?? "qwen3-max");
  }
  return createDeepSeekModel(
    (process.env.STORYOS_PERSONA_MODEL as DeepSeekModelId | undefined) ?? "deepseek-chat"
  );
}
