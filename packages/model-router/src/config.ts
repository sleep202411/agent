export interface LiteLlmConfig {
  /**
   * OpenAI-compatible base URL including `/v1` or provider path
   * (e.g. `.../compatible-mode/v1`). Never double-append `/v1`.
   */
  baseUrl: string;
  apiKey: string;
  /**
   * Optional default model id when a profile's litellmModel is a logical name
   * that should be overridden for a provider (e.g. Qwen MaaS).
   */
  defaultModel?: string;
}

/**
 * Normalize provider base URLs so ChatOpenAI does not produce `.../v1/v1`.
 */
export function normalizeOpenAiCompatibleBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/$/, "");
  if (!trimmed) {
    throw new Error("OpenAI-compatible base URL must not be empty.");
  }
  if (
    trimmed.endsWith("/v1") ||
    trimmed.endsWith("/compatible-mode/v1") ||
    /\/v\d+$/.test(trimmed)
  ) {
    return trimmed;
  }
  return `${trimmed}/v1`;
}

/**
 * Required when using live models. Missing config fails loud (no silent defaults
 * for credentials). Tests inject models and never call this.
 *
 * Env (either LiteLLM proxy or direct OpenAI-compatible provider such as Qwen):
 * - AGENT_OS_LITELLM_BASE_URL or AGENT_OS_OPENAI_BASE_URL
 * - AGENT_OS_LITELLM_API_KEY or AGENT_OS_OPENAI_API_KEY
 * - AGENT_OS_DEFAULT_MODEL (optional, e.g. qwen-plus)
 */
export function readLiteLlmConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LiteLlmConfig {
  const baseUrlRaw = env.AGENT_OS_OPENAI_BASE_URL?.trim() || env.AGENT_OS_LITELLM_BASE_URL?.trim();
  const apiKey = env.AGENT_OS_OPENAI_API_KEY?.trim() || env.AGENT_OS_LITELLM_API_KEY?.trim();
  if (!baseUrlRaw) {
    throw new Error(
      "AGENT_OS_OPENAI_BASE_URL or AGENT_OS_LITELLM_BASE_URL is required for live Agent OS model calls."
    );
  }
  if (!apiKey) {
    throw new Error(
      "AGENT_OS_OPENAI_API_KEY or AGENT_OS_LITELLM_API_KEY is required for live Agent OS model calls."
    );
  }
  const defaultModel = env.AGENT_OS_DEFAULT_MODEL?.trim() || undefined;
  return {
    baseUrl: normalizeOpenAiCompatibleBaseUrl(baseUrlRaw),
    apiKey,
    defaultModel,
  };
}

export function isLiveModelConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const base = env.AGENT_OS_OPENAI_BASE_URL?.trim() || env.AGENT_OS_LITELLM_BASE_URL?.trim();
  const key = env.AGENT_OS_OPENAI_API_KEY?.trim() || env.AGENT_OS_LITELLM_API_KEY?.trim();
  return Boolean(base && key);
}
