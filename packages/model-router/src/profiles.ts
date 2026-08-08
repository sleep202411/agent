import { z } from "zod";

/**
 * The models a user can pick, and what they are called.
 *
 * Traffic goes to ONE OpenAI-compatible endpoint with ONE key (Bailian's
 * compatible-mode serves Qwen, DeepSeek, GLM and Kimi behind the same
 * credential), so adding a model is a matter of naming it — not of wiring a
 * provider. That makes a hardcoded table the only thing standing between the
 * product and a new model, which is why this reads from the environment.
 *
 * `label` lives here rather than in the locale files: a model's name is a
 * proper noun. "DeepSeek V4 Pro" is the same string in every language, and
 * putting it behind a translation key means three files change every time
 * someone wants to try a model.
 */
export const ModelProfileIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_.-]*$/);

export type ModelProfileId = z.infer<typeof ModelProfileIdSchema>;

export const ModelProfileSchema = z
  .object({
    /** Stable id the client sends and the journal records. */
    id: ModelProfileIdSchema,
    /** Model id sent to the provider. */
    model: z.string().trim().min(1).max(128),
    /** Shown in the picker. A proper noun, not a translated phrase. */
    label: z.string().trim().min(1).max(64),
    /** One line on when to reach for it. Optional; shown under the label. */
    hint: z.string().trim().max(120).optional(),
    temperature: z.number().min(0).max(2).default(0.4),
    maxTokens: z.number().int().positive().max(200_000).default(4096),
  })
  .strict();

export type ModelProfile = z.infer<typeof ModelProfileSchema>;

/**
 * Shipped defaults. Every one of these has been through `probe:models` — it
 * completes the golden path (propose a write, pause, approve, land it) against
 * the configured endpoint. A model that has not is a guess, not a default.
 */
const BUILT_IN_PROFILES: readonly ModelProfile[] = [
  {
    id: "qwen3.7-plus",
    model: "qwen3.7-plus",
    label: "通义 Plus",
    hint: "Everyday driver",
    temperature: 0.4,
    maxTokens: 8192,
  },
  {
    id: "qwen3.8-max",
    model: "qwen3.8-max",
    label: "通义 Max",
    hint: "Strongest, slower",
    temperature: 0.5,
    maxTokens: 8192,
  },
  {
    id: "deepseek-v4-pro",
    model: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    hint: "Dense reasoning",
    temperature: 0.3,
    maxTokens: 8192,
  },
  {
    id: "glm-5.2",
    model: "glm-5.2",
    label: "GLM 5.2",
    temperature: 0.4,
    maxTokens: 8192,
  },
  {
    id: "kimi-k2.7-code",
    model: "kimi-k2.7-code",
    label: "Kimi K2.7",
    hint: "Long context",
    temperature: 0.4,
    maxTokens: 8192,
  },
];

const EnvProfilesSchema = z.array(ModelProfileSchema).min(1).max(24);

/**
 * Replace the shipped list wholesale via AGENT_OS_MODEL_PROFILES (a JSON
 * array). Wholesale rather than merge: a half-overridden list is impossible to
 * reason about from the deployment alone.
 *
 * Malformed JSON throws at boot. A picker that silently falls back to defaults
 * would hide the one thing an operator needs to know — that their change did
 * not take.
 */
export function loadModelProfiles(
  environment: NodeJS.ProcessEnv = process.env
): readonly ModelProfile[] {
  const raw = environment.AGENT_OS_MODEL_PROFILES?.trim();
  if (!raw) return BUILT_IN_PROFILES;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `AGENT_OS_MODEL_PROFILES is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  const profiles = EnvProfilesSchema.parse(parsed);
  const ids = new Set<string>();
  for (const profile of profiles) {
    if (ids.has(profile.id)) {
      throw new Error(`AGENT_OS_MODEL_PROFILES has duplicate id "${profile.id}"`);
    }
    ids.add(profile.id);
  }
  return profiles;
}

export function resolveProfile(
  profileId: string,
  environment: NodeJS.ProcessEnv = process.env
): ModelProfile {
  const id = ModelProfileIdSchema.parse(profileId);
  const profiles = loadModelProfiles(environment);
  const profile = profiles.find((p) => p.id === id);
  if (!profile) {
    throw new Error(
      `Unknown model profile "${id}". Available: ${profiles.map((p) => p.id).join(", ")}`
    );
  }
  return profile;
}
