/**
 * script_to_storyboard_flow — 最小路径 flow 用于"用户已有剧本，只要分镜"。
 *
 *   parse_script (HITL)  →  storyboard_phase (HITL)
 *
 * Skips role/scene/prop phases entirely. storyboard_phase reads episodes
 * + scripts from Java and works fine without worldroles / worldscenes:
 *   - scene names → empty whitelist, storyboarder falls back to free-form
 *   - mention injection → empty map, plain-text names survive
 * Trade-off (surfaced to the user by the supervisor narration):
 *   no role reference images, no scene style anchors — downstream video
 *   gen will have weaker cross-shot visual consistency.
 *
 * If the user later asks for roles/scenes/props, they go via
 * `invoke_workflow('role_phase')` etc. as a follow-up.
 */
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { parseScriptWorkflow, ParseScriptOutputSchema } from "./parse-script";
import { storyboardPhaseWorkflow, StoryboardPhaseOutputSchema } from "./phases/storyboard-phase";

// ─── Schemas ──────────────────────────────────────────────────────────

export const ScriptToStoryboardInputSchema = z.object({
  projectId: z.string().min(1),
  /** Raw script text — invoke_workflow resolves textRef into this. */
  text: z.string().min(1),
  /** How many episodes to split into (from project.chapterLength). */
  targetEpisodeCount: z.number().int().min(1).max(60).default(10),
});

export const ScriptToStoryboardOutputSchema = z.object({
  outcome: z.enum(["committed", "partial_failure", "rejected", "cancelled"]),
  episodesCommitted: z.number(),
  storyboardsCommitted: z.number(),
  message: z.string(),
});

// ─── Adapters ────────────────────────────────────────────────────────

/**
 * Mark the composed flow so parse_script / storyboard_phase can render
 * "compact" completion cards (no standalone nextStep button since the
 * flow auto-continues).
 */
const toParseScriptInput = createStep({
  id: "to_parse_script_input",
  inputSchema: ScriptToStoryboardInputSchema,
  outputSchema: z.object({
    projectId: z.string(),
    text: z.string(),
    targetEpisodeCount: z.number(),
  }),
  execute: async ({ inputData, requestContext }) => {
    requestContext?.set("inMainFlow", true);
    return {
      projectId: inputData.projectId,
      text: inputData.text,
      targetEpisodeCount: inputData.targetEpisodeCount,
    };
  },
});

const toStoryboardPhaseInput = createStep({
  id: "to_storyboard_phase_input",
  inputSchema: ParseScriptOutputSchema,
  // Scope storyboard to the episodes JUST committed by parse_script — a
  // project with stale episodes from earlier runs would otherwise have
  // storyboard_phase process N_new + N_stale episodes.
  outputSchema: z.object({
    projectId: z.string(),
    onlyEpisodeIds: z.array(z.string()).optional(),
  }),
  execute: async ({ inputData, getInitData }) => {
    const init = getInitData<z.infer<typeof ScriptToStoryboardInputSchema>>();
    const ids = inputData.committed.map((c) => c.serverId).filter((id) => id.length > 0);
    return {
      projectId: init.projectId,
      onlyEpisodeIds: ids.length > 0 ? ids : undefined,
    };
  },
});

const aggregateStep = createStep({
  id: "aggregate",
  inputSchema: StoryboardPhaseOutputSchema,
  outputSchema: ScriptToStoryboardOutputSchema,
  execute: async ({ inputData, getStepResult }) => {
    const parseResult = getStepResult(parseScriptWorkflow) as
      | z.infer<typeof ParseScriptOutputSchema>
      | undefined;
    const episodesCommitted = parseResult?.committed.length ?? 0;
    const storyboardsCommitted = inputData.committed.length;
    const anyFailure = (parseResult?.failed.length ?? 0) > 0 || inputData.failed.length > 0;
    const outcome: z.infer<typeof ScriptToStoryboardOutputSchema>["outcome"] = anyFailure
      ? "partial_failure"
      : "committed";
    return {
      outcome,
      episodesCommitted,
      storyboardsCommitted,
      message:
        outcome === "committed"
          ? `已从剧本切出 ${episodesCommitted} 集并生成 ${storyboardsCommitted} 集分镜。`
          : `完成但有失败：分集 ${episodesCommitted} / 分镜 ${storyboardsCommitted}。请查看各阶段 drafts。`,
    };
  },
});

// ─── Compose ─────────────────────────────────────────────────────────

export const scriptToStoryboardFlow = createWorkflow({
  id: "script_to_storyboard_flow",
  description:
    "最小路径 flow：用户已上传完整剧本 + 只要分镜。流程 = parse_script（切分入库） → storyboard_phase（出分镜）。跳过 role/scene/prop。",
  inputSchema: ScriptToStoryboardInputSchema,
  outputSchema: ScriptToStoryboardOutputSchema,
})
  .then(toParseScriptInput)
  .then(parseScriptWorkflow)
  .then(toStoryboardPhaseInput)
  .then(storyboardPhaseWorkflow)
  .then(aggregateStep)
  .commit();
