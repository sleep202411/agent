import { z } from "zod";

/**
 * Phase 1 model profiles. Billing/rate limits are intentionally absent.
 * Traffic goes through an OpenAI-compatible endpoint (LiteLLM proxy or Qwen MaaS).
 */
export const ModelProfileIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_-]*$/);

export type ModelProfileId = z.infer<typeof ModelProfileIdSchema>;

export interface ModelProfile {
  id: ModelProfileId;
  /**
   * Model id sent to the provider.
   * For Qwen MaaS dev, use ids like `qwen-plus` / `qwen-max` (override via
   * AGENT_OS_DEFAULT_MODEL when using logical profile ids).
   */
  litellmModel: string;
  temperature: number;
  maxTokens: number;
}

export const DEFAULT_PROFILES: readonly ModelProfile[] = [
  {
    id: "creative-balanced",
    litellmModel: "qwen-plus",
    temperature: 0.4,
    maxTokens: 4096,
  },
  {
    id: "creative-premium",
    litellmModel: "qwen-max",
    temperature: 0.5,
    maxTokens: 8192,
  },
  {
    id: "qwen-plus",
    litellmModel: "qwen-plus",
    temperature: 0.4,
    maxTokens: 4096,
  },
  {
    id: "qwen-max",
    litellmModel: "qwen-max",
    temperature: 0.5,
    maxTokens: 8192,
  },
  {
    id: "qwen-turbo",
    litellmModel: "qwen-turbo",
    temperature: 0.3,
    maxTokens: 4096,
  },
] as const;

export function resolveProfile(profileId: string): ModelProfile {
  const id = ModelProfileIdSchema.parse(profileId);
  const profile = DEFAULT_PROFILES.find((p) => p.id === id);
  if (!profile) {
    throw new Error(
      `Unknown model profile "${id}". Add it to DEFAULT_PROFILES or use qwen-plus / creative-balanced.`
    );
  }
  return profile;
}
