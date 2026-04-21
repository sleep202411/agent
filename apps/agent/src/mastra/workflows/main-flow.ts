/**
 * main_flow — the big pipeline workflow.
 *
 * Chains every phase with a HITL gate between each:
 *
 *   [1] story_outline       (storyEditor)   — compress source → skeleton (Redis)
 *        ↓   no HITL here (pure analysis; skeleton is the contract)
 *   [2] role_phase          (HITL)          — elaborate cast → draft → commit
 *        ↓
 *   [3] role_image_phase                    — dispatch role image gen
 *        ↓
 *   [4] scene_phase         (HITL)          — scene roster → draft → commit
 *        ↓
 *   [5] scene_image_phase                   — dispatch scene image gen
 *        ↓
 *   [6] prop_phase          (HITL)          — prop roster → draft → commit
 *        ↓
 *   [7] prop_image_phase                    — dispatch prop image gen
 *        ↓
 *   [8] episode_phase       (HITL)          — plan episodes → draft → commit
 *        ↓
 *   [9] script_phase        (HITL)          — write per-episode scripts → commit
 *        ↓
 *  [10] storyboard_phase    (HITL)          — per-episode storyboard → commit
 *
 * Every phase reads from the project skeleton (Redis key outline:{projectId})
 * and/or the Java DB — no data threaded through step I/O schemas, so the
 * composition stays flat and adapter-free.
 */
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { scriptBreakdownWorkflow } from "./phases/script-breakdown";
import { rolePhaseWorkflow, RolePhaseOutputSchema } from "./phases/role-phase";
import { roleImagePhaseWorkflow } from "./phases/role-image-phase";
import { scenePhaseWorkflow, ScenePhaseOutputSchema } from "./phases/scene-phase";
import { sceneImagePhaseWorkflow } from "./phases/scene-image-phase";
import { propPhaseWorkflow, PropPhaseOutputSchema } from "./phases/prop-phase";
import { propImagePhaseWorkflow } from "./phases/prop-image-phase";
import { episodePhaseWorkflow, EpisodePhaseOutputSchema } from "./phases/episode-phase";
import { scriptPhaseWorkflow, ScriptPhaseOutputSchema } from "./phases/script-phase";
import { storyboardPhaseWorkflow, StoryboardPhaseOutputSchema } from "./phases/storyboard-phase";

// ─── Schemas ──────────────────────────────────────────────────────────

export const MainFlowInputSchema = z.object({
  projectId: z.string().min(1),
  worldId: z.string().min(1),
  /** Raw material for the story editor. Required. */
  text: z.string().min(1),
  /** Optional user hint — genre, tone, audience etc. */
  styleHint: z.string().optional(),
  /** How many episodes to plan. */
  targetEpisodeCount: z.number().int().min(1).max(60).default(10),
});

export const MainFlowOutputSchema = z.object({
  outcome: z.enum(["committed", "partial_failure", "rejected", "cancelled"]),
  rolesCommitted: z.number(),
  scenesCommitted: z.number(),
  propsCommitted: z.number(),
  episodesCommitted: z.number(),
  scriptsCommitted: z.number(),
  storyboardsCommitted: z.number(),
  message: z.string(),
});

// ─── Adapters (only where phase-to-phase shapes actually differ) ─────

/**
 * Flag sub-workflows can read (role_phase / scene_phase / prop_phase) to
 * skip their auto-chain into the corresponding *_image_phase. main_flow's
 * composition already runs the image phase as the next .then(), so
 * auto-chaining from inside the text phase would kick off a SECOND
 * standalone image run in parallel — two image runs, two progress cards,
 * double Java dispatch. When the text phase is invoked standalone
 * (user typed "设计角色" or clicked 继续·设计角色), this flag isn't set
 * and the auto-chain fires as before.
 */
const toBreakdownInput = createStep({
  id: "to_breakdown_input",
  inputSchema: MainFlowInputSchema,
  outputSchema: z.object({ text: z.string(), styleHint: z.string().optional() }),
  execute: async ({ inputData, requestContext }) => {
    requestContext?.set("inMainFlow", true);
    return {
      text: inputData.text,
      styleHint: inputData.styleHint,
    };
  },
});

const toRolePhaseInput = createStep({
  id: "to_role_phase_input",
  inputSchema: z.unknown(),
  outputSchema: z.object({ worldId: z.string() }),
  execute: async ({ getInitData }) => {
    const init = getInitData<z.infer<typeof MainFlowInputSchema>>();
    return { worldId: init.worldId };
  },
});

const toRoleImagePhaseInput = createStep({
  id: "to_role_image_phase_input",
  inputSchema: RolePhaseOutputSchema,
  outputSchema: z.object({}),
  execute: async () => ({}),
});

const toScenePhaseInput = createStep({
  id: "to_scene_phase_input",
  inputSchema: z.unknown(),
  outputSchema: z.object({ worldId: z.string() }),
  execute: async ({ getInitData }) => {
    const init = getInitData<z.infer<typeof MainFlowInputSchema>>();
    return { worldId: init.worldId };
  },
});

const toSceneImagePhaseInput = createStep({
  id: "to_scene_image_phase_input",
  inputSchema: ScenePhaseOutputSchema,
  outputSchema: z.object({}),
  execute: async () => ({}),
});

const toPropPhaseInput = createStep({
  id: "to_prop_phase_input",
  inputSchema: z.unknown(),
  outputSchema: z.object({ worldId: z.string() }),
  execute: async ({ getInitData }) => {
    const init = getInitData<z.infer<typeof MainFlowInputSchema>>();
    return { worldId: init.worldId };
  },
});

const toPropImagePhaseInput = createStep({
  id: "to_prop_image_phase_input",
  inputSchema: PropPhaseOutputSchema,
  outputSchema: z.object({}),
  execute: async () => ({}),
});

const toEpisodePhaseInput = createStep({
  id: "to_episode_phase_input",
  // Input is role_image_phase's output now that image gen is a dedicated
  // step — kept loose since we only need init data anyway.
  inputSchema: z.unknown(),
  outputSchema: z.object({
    projectId: z.string(),
    targetEpisodeCount: z.number(),
  }),
  execute: async ({ getInitData }) => {
    const init = getInitData<z.infer<typeof MainFlowInputSchema>>();
    return {
      projectId: init.projectId,
      targetEpisodeCount: init.targetEpisodeCount,
    };
  },
});

const toScriptPhaseInput = createStep({
  id: "to_script_phase_input",
  inputSchema: EpisodePhaseOutputSchema,
  outputSchema: z.object({ projectId: z.string() }),
  execute: async ({ getInitData }) => {
    const init = getInitData<z.infer<typeof MainFlowInputSchema>>();
    return { projectId: init.projectId };
  },
});

const toStoryboardPhaseInput = createStep({
  id: "to_storyboard_phase_input",
  inputSchema: ScriptPhaseOutputSchema,
  // Scope storyboard to the episodes JUST committed by episode_phase so
  // any stale episodes lingering in the project from earlier runs are
  // ignored.
  outputSchema: z.object({
    projectId: z.string(),
    onlyEpisodeIds: z.array(z.string()).optional(),
  }),
  execute: async ({ getInitData, getStepResult }) => {
    const init = getInitData<z.infer<typeof MainFlowInputSchema>>();
    const episodeResult = getStepResult(episodePhaseWorkflow) as
      | z.infer<typeof EpisodePhaseOutputSchema>
      | undefined;
    const ids = episodeResult?.committed.map((c) => c.serverId).filter((id) => id.length > 0) ?? [];
    return {
      projectId: init.projectId,
      onlyEpisodeIds: ids.length > 0 ? ids : undefined,
    };
  },
});

const aggregateStep = createStep({
  id: "aggregate",
  inputSchema: StoryboardPhaseOutputSchema,
  outputSchema: MainFlowOutputSchema,
  execute: async ({ inputData, getStepResult }) => {
    const rolesResult = getStepResult(rolePhaseWorkflow) as
      | z.infer<typeof RolePhaseOutputSchema>
      | undefined;
    const scenesResult = getStepResult(scenePhaseWorkflow) as
      | z.infer<typeof ScenePhaseOutputSchema>
      | undefined;
    const propsResult = getStepResult(propPhaseWorkflow) as
      | z.infer<typeof PropPhaseOutputSchema>
      | undefined;
    const episodesResult = getStepResult(episodePhaseWorkflow) as
      | z.infer<typeof EpisodePhaseOutputSchema>
      | undefined;
    const scriptsResult = getStepResult(scriptPhaseWorkflow) as
      | z.infer<typeof ScriptPhaseOutputSchema>
      | undefined;

    const rolesCommitted = rolesResult?.committed.length ?? 0;
    const scenesCommitted = scenesResult?.committed.length ?? 0;
    const propsCommitted = propsResult?.committed.length ?? 0;
    const episodesCommitted = episodesResult?.committed.length ?? 0;
    const scriptsCommitted = scriptsResult?.committed.length ?? 0;
    const storyboardsCommitted = inputData.committed.length;

    const anyFailure =
      (rolesResult?.failed.length ?? 0) > 0 ||
      (scenesResult?.failed.length ?? 0) > 0 ||
      (propsResult?.failed.length ?? 0) > 0 ||
      (episodesResult?.failed.length ?? 0) > 0 ||
      (scriptsResult?.failed.length ?? 0) > 0 ||
      inputData.failed.length > 0;

    const outcome: z.infer<typeof MainFlowOutputSchema>["outcome"] = anyFailure
      ? "partial_failure"
      : "committed";

    return {
      outcome,
      rolesCommitted,
      scenesCommitted,
      propsCommitted,
      episodesCommitted,
      scriptsCommitted,
      storyboardsCommitted,
      message:
        outcome === "committed"
          ? `主流程完成！已入库 ${rolesCommitted} 角色 / ${scenesCommitted} 场景 / ${propsCommitted} 道具 / ${episodesCommitted} 集大纲 / ${scriptsCommitted} 集剧本 / ${storyboardsCommitted} 集分镜。`
          : `主流程完成但有失败：角色 ${rolesCommitted} / 场景 ${scenesCommitted} / 道具 ${propsCommitted} / 分集 ${episodesCommitted} / 剧本 ${scriptsCommitted} / 分镜 ${storyboardsCommitted}。检查各阶段的 drafts 和 errors。`,
    };
  },
});

// ─── Compose ──────────────────────────────────────────────────────────

export const mainFlowWorkflow = createWorkflow({
  id: "main_flow",
  description:
    '从素材到成片的完整主流程：骨架 → 角色（+图）→ 场景（+图）→ 道具（+图）→ 分集 → 剧本 → 分镜。每阶段自动进入下一阶段，用户只需点"满意"。',
  inputSchema: MainFlowInputSchema,
  outputSchema: MainFlowOutputSchema,
})
  .then(toBreakdownInput)
  .then(scriptBreakdownWorkflow)
  .then(toRolePhaseInput)
  .then(rolePhaseWorkflow)
  .then(toRoleImagePhaseInput)
  .then(roleImagePhaseWorkflow)
  .then(toScenePhaseInput)
  .then(scenePhaseWorkflow)
  .then(toSceneImagePhaseInput)
  .then(sceneImagePhaseWorkflow)
  .then(toPropPhaseInput)
  .then(propPhaseWorkflow)
  .then(toPropImagePhaseInput)
  .then(propImagePhaseWorkflow)
  .then(toEpisodePhaseInput)
  .then(episodePhaseWorkflow)
  .then(toScriptPhaseInput)
  .then(scriptPhaseWorkflow)
  .then(toStoryboardPhaseInput)
  .then(storyboardPhaseWorkflow)
  .then(aggregateStep)
  .commit();
