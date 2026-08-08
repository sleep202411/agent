import { z } from "zod";

/**
 * Agent Skill — one mountable specialization.
 *
 * Same shape for system / surface base skills and future catalog/project skills.
 * Installation UI is out of scope; Runtime must already accept any registered skill.
 *
 * Aligned with Agent Skills / LangChain progressive-disclosure pattern:
 * metadata is always known; full instructions are composed only when mounted.
 */
export const AgentSkillSourceSchema = z.enum([
  /** Product-built-in; not user-removable. */
  "system",
  /** Future: installed from catalog / marketplace. */
  "catalog",
  /** Future: project-authored or project-pinned. */
  "project",
]);
export type AgentSkillSource = z.infer<typeof AgentSkillSourceSchema>;

export const AgentSkillDefinitionSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[a-z][a-z0-9._-]*$/),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(2_000),
    /** Full operating instructions when this skill is mounted. */
    instructions: z.string().trim().min(1).max(50_000),
    /**
     * Tool ids this skill may use. Mount composition unions tool ids.
     * Empty = instructions only (no extra tools).
     */
    toolIds: z.array(z.string().min(1).max(128)).max(64).default([]),
    /**
     * Surfaces this skill is valid on. Empty = any surface.
     * System surface-base skills list exactly one surface.
     */
    surfaces: z.array(z.string().min(1).max(64)).max(32).default([]),
    source: AgentSkillSourceSchema,
    /** Always composed when surface matches (system base). */
    alwaysOn: z.boolean().default(false),
    /**
     * Shown in composer / project default pickers.
     * System always-on base skills are usually false; optional system skills true.
     */
    userInvocable: z.boolean().default(false),
    /** Catalog/project skills may be removed; system skills never. */
    removable: z.boolean().default(false),
    /** Higher runs later in the composed prompt (overrides earlier guidance). */
    priority: z.number().int().min(0).max(1_000).default(100),
  })
  .strict();

export type AgentSkillDefinition = z.infer<typeof AgentSkillDefinitionSchema>;

export interface SkillMountContext {
  /** Trusted product surface (Studio mode). */
  surface: string;
  /** Optional product line (e.g. interactive-film). Future system packs. */
  product?: string;
  /**
   * Project default skill ids (admin). Applied when registered.
   * Target product path — not a temporary stub.
   */
  projectDefaultSkillIds?: readonly string[];
  /**
   * Per-turn skill ids from the composer. Applied when registered.
   * Target product path — not a temporary stub.
   */
  turnSkillIds?: readonly string[];
}

export interface SkillMountResult {
  /** Ordered skills actually mounted (deduped). */
  skills: readonly AgentSkillDefinition[];
  /** Union of tool ids allowed by mounted skills. */
  toolIds: readonly string[];
  /** Composed system prompt for the model. */
  instructions: string;
  /** Skill ids that were requested but not registered / not allowed. */
  skippedSkillIds: readonly string[];
}
