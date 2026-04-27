/**
 * Direct-call wrappers — each persona agent gets one ask_* tool that the
 * supervisor can invoke for single-turn, non-persisting consultations
 * (review, tweak, discuss). These tools stay out of the draft / commit
 * pipeline — their output is **just a string reply** that flows back to
 * the user in chat.
 *
 * Design invariants:
 *  - Never write to the Java backend.
 *  - Always ground the persona with real project data (context-loader).
 *  - Hard timeout via AbortSignal (DEFAULT_ASK_TIMEOUT_MS).
 *  - Structured logging for production traces.
 *
 * For heavier tasks (batch generation, HITL confirmation, DB commit) the
 * supervisor should prefer invoke_workflow instead.
 */
import { createTool, type ToolExecutionContext } from "@mastra/core/tools";
import { z } from "zod";
import {
  loadEpisodeScript,
  loadEpisodes,
  loadProjectSummary,
  loadProps,
  loadRoles,
  loadScenes,
  loadStoryboard,
} from "./context-loader";
import { askPersona, PersonaReplyFieldsSchema, type AskPersonaResult } from "./ask-persona";
import { getContext, type StoryosContext } from "../../lib/workspace-client";

// ─── Shared output schema ──────────────────────────────────────────────
//
// Contract: persona always returns `{ summary, fields }` (see ask-persona.ts).
// `fields` is nullable on the wire because the LLM call can fail — in that
// case supervisor sees the `error` field set and skips the tool-call step.

const ReplySchema = z.object({
  persona: z.string(),
  summary: z.string(),
  fields: PersonaReplyFieldsSchema.nullable(),
  tookMs: z.number(),
  contextBytes: z.number(),
  error: z.string().optional(),
});

// ─── Shared scope schemas ──────────────────────────────────────────────

const ScopeSchema = z.object({
  /** Focus on a specific episode's script when relevant. Also required for
   *  includeStoryboard (storyboard is per-episode). */
  episodeId: z.string().optional(),
  /** Whether to include the character list. Default true when character-related. */
  includeRoles: z.boolean().optional(),
  /** Whether to include the scene list. Default true when scene-related. */
  includeScenes: z.boolean().optional(),
  /** Whether to include the prop list. */
  includeProps: z.boolean().optional(),
  /** Whether to include project-level summary. Default true. */
  includeProject: z.boolean().optional(),
  /** Whether to include the episode list (no scripts). */
  includeEpisodes: z.boolean().optional(),
  /** Whether to include the episode's storyboard shot list (id + scene +
   *  description preview). Requires episodeId; storyboarder's default. */
  includeStoryboard: z.boolean().optional(),
});

type Scope = z.infer<typeof ScopeSchema>;

// ─── Context assembly ──────────────────────────────────────────────────

async function collectContext(
  ctx: StoryosContext,
  scope: Scope | undefined,
  defaults: Scope
): Promise<Array<{ heading: string; body: string }>> {
  const eff: Scope = { ...defaults, ...scope };
  const blocks: Array<{ heading: string; body: string }> = [];

  if (eff.includeProject !== false) {
    const body = await loadProjectSummary(ctx);
    if (body) blocks.push({ heading: "Project summary", body });
  }
  if (eff.includeEpisodes) {
    const body = await loadEpisodes(ctx);
    if (body) blocks.push({ heading: "Episodes", body });
  }
  if (eff.includeRoles) {
    const body = await loadRoles(ctx);
    if (body) blocks.push({ heading: "Existing characters", body });
  }
  if (eff.includeScenes) {
    const body = await loadScenes(ctx);
    if (body) blocks.push({ heading: "Existing scenes", body });
  }
  if (eff.includeProps) {
    const body = await loadProps(ctx);
    if (body) blocks.push({ heading: "Existing props", body });
  }
  if (eff.episodeId) {
    const body = await loadEpisodeScript(ctx, eff.episodeId);
    if (body) blocks.push({ heading: `Existing script for episode ${eff.episodeId}`, body });
  }
  if (eff.includeStoryboard && eff.episodeId) {
    const body = await loadStoryboard(ctx, eff.episodeId);
    if (body) blocks.push({ heading: `Existing storyboard for episode ${eff.episodeId}`, body });
  }

  return blocks;
}

// ─── Factory ───────────────────────────────────────────────────────────

interface AskToolConfig {
  toolId: string;
  agentId: string;
  description: string;
  defaultScope: Scope;
}

function makeAskTool(cfg: AskToolConfig) {
  return createTool({
    id: cfg.toolId,
    description: cfg.description,
    inputSchema: z.object({
      task: z
        .string()
        .min(1)
        .describe("Natural-language task or question to send to this persona."),
      scope: ScopeSchema.optional().describe(
        "Manually pick which project context blocks to load; usually leave unset and accept the default."
      ),
    }),
    outputSchema: ReplySchema,
    execute: async (
      { task, scope }: { task: string; scope?: Scope },
      execCtx: ToolExecutionContext | undefined
    ): Promise<AskPersonaResult> => {
      let ctx: StoryosContext;
      try {
        ctx = getContext(execCtx?.requestContext);
      } catch (err) {
        return {
          persona: cfg.agentId,
          summary: "",
          fields: null,
          tookMs: 0,
          contextBytes: 0,
          error: err instanceof Error ? err.message : String(err),
        };
      }
      const contextBlocks = await collectContext(ctx, scope, cfg.defaultScope);
      return askPersona({
        mastra: execCtx?.mastra,
        requestContext: execCtx?.requestContext,
        agentId: cfg.agentId,
        task,
        contextBlocks,
      });
    },
  });
}

// ─── The six tools ─────────────────────────────────────────────────────

export const askScriptwriter = makeAskTool({
  toolId: "ask_scriptwriter",
  agentId: "scriptwriter",
  description:
    "Have the scriptwriter persona answer one question or rewrite a passage (single episode / single scene scope). Returns text only, no DB writes. Good for: discussing specific dialogue, critiquing pacing, lightly revising a section. For full-episode rewrites, use invoke_workflow('script_edit'). task is required; optionally pass scope.episodeId to focus on a specific episode.",
  defaultScope: { includeProject: true, includeRoles: true },
});

export const askCharacterDesigner = makeAskTool({
  toolId: "ask_character_designer",
  agentId: "roleDesigner",
  description:
    "Have the character-designer persona discuss or tweak a single character (appearance, personality, role). Returns text only, no DB writes. Good for: deepening a character, adding visual details, comparing characters for differentiation. For batch redesign, use invoke_workflow('role_design').",
  defaultScope: { includeProject: true, includeRoles: true },
});

export const askSceneDesigner = makeAskTool({
  toolId: "ask_scene_designer",
  agentId: "sceneDesigner",
  description:
    "Have the scene-designer persona design / discuss / tweak a single scene (environment, lighting, atmosphere, props). Returns text only, no DB writes. Good for: a quick sketch of one scene, adjusting details on an existing scene, filling in environment for a script beat.",
  defaultScope: { includeProject: true, includeScenes: true, includeRoles: true },
});

export const askPropDesigner = makeAskTool({
  toolId: "ask_prop_designer",
  agentId: "propDesigner",
  description:
    "Have the prop-designer persona design / discuss a single prop (story prop, character keepsake, period object). Returns text or structured output, no DB writes. Good for: designing one new prop with look + material + era, discussing how a prop carries a plot function, filling in visual details on an existing prop. For batch prop design, use invoke_workflow('prop_design'). **Do NOT** route prop tasks to ask_scene_designer — scenes are environments, props are discrete story objects.",
  defaultScope: { includeProject: true, includeRoles: true, includeProps: true },
});

export const askArtDirector = makeAskTool({
  toolId: "ask_art_director",
  agentId: "artDirector",
  description:
    'Have the art-director persona either (1) set the visual tone at project kickoff, or (2) audit the visual consistency of existing characters / scenes / storyboards. Returns text or a structured report into chat, no DB writes. Prefer this when the user asks things like "is the style consistent?", "does the tone fit?", "do the three episodes look like the same project?".',
  defaultScope: {
    includeProject: true,
    includeRoles: true,
    includeScenes: true,
  },
});

export const askStoryboardDesigner = makeAskTool({
  toolId: "ask_storyboard_designer",
  agentId: "storyboarder",
  description:
    "Have the storyboarder persona design / discuss / tweak a single shot or a small set of shots, or critique existing storyboards. Returns structured output, no DB writes. **scope.episodeId is required** — without it the persona can't load the existing storyboard and tends to wrongly claim \"0 shots\"; supervisor must call query_context first to get activeEpisode.id and pass it through. For generating a full-episode storyboard, use invoke_workflow('storyboard_phase').",
  defaultScope: { includeProject: true, includeScenes: true, includeStoryboard: true },
});

export const askEpisodePlanner = makeAskTool({
  toolId: "ask_episode_planner",
  agentId: "episodePlanner",
  description:
    'Have the episode-planner persona discuss episode structure (suggested episode count, between-episode hooks, mainline distribution). Returns text only, no DB writes. Good for: "how many episodes does this story need?", "what hook should episode 4 end on?", "is it OK to swap episodes 3 and 5?". For batch episode-outline generation, use invoke_workflow(\'episode_phase\').',
  defaultScope: { includeProject: true, includeEpisodes: true, includeRoles: true },
});
