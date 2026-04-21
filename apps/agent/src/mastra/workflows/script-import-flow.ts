/**
 * script_import_flow — 用户已有完整剧本 + 想要"完整资产管线"（角色 /
 * 场景 / 道具立绘 + 分镜），但**不要重写剧本**。
 *
 * 关键差别 vs 其他两条：
 *
 *   main_flow              novel → story_outline → role → role_img → scene →
 *                           scene_img → prop → prop_img → episode → script →
 *                           storyboard
 *                           (AI 写全套，包括剧本；适合小说 / 梗概输入)
 *
 *   script_to_storyboard   script → parse_script → storyboard
 *                           (最短路径；跳过资产设计)
 *
 *   script_import_flow      script → story_outline → parse_script → role →
 *                           role_img → scene → scene_img → prop → prop_img →
 *                           storyboard
 *                           (AI 设计资产，但剧本保持原文)
 *
 * 比 main_flow 少了两步：
 *   - 没有 `episode_phase`（parse_script 已经把集切好并入库）
 *   - 没有 `script_phase`（剧本用用户原文，不 re-write）
 *
 * 比 script_to_storyboard_flow 多了：
 *   - story_outline（读原文抽 cast / settings / props 名册）
 *   - role/scene/prop_phase + 对应 image_phase（设计 + 出图）
 *
 * 所有内部 HITL 沿用各 phase 的既有行为（continue button 显示 next
 * phase 名称 + 积分）。
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
import { storyboardPhaseWorkflow, StoryboardPhaseOutputSchema } from "./phases/storyboard-phase";
import { parseScriptWorkflow, ParseScriptOutputSchema } from "./parse-script";

// ─── Schemas ──────────────────────────────────────────────────────────

export const ScriptImportFlowInputSchema = z.object({
  projectId: z.string().min(1),
  worldId: z.string().min(1),
  /** Raw script text — invoke_workflow resolves textRef into this. */
  text: z.string().min(1),
  /** Episode count — drives both story_outline scope hints and parse_script split. */
  targetEpisodeCount: z.number().int().min(1).max(60).default(10),
  /** Optional user hint — genre, tone, audience etc. */
  styleHint: z.string().optional(),
});

export const ScriptImportFlowOutputSchema = z.object({
  outcome: z.enum(["committed", "partial_failure", "rejected", "cancelled"]),
  episodesCommitted: z.number(),
  rolesCommitted: z.number(),
  scenesCommitted: z.number(),
  propsCommitted: z.number(),
  storyboardsCommitted: z.number(),
  message: z.string(),
});

// ─── Adapters ────────────────────────────────────────────────────────

/**
 * First step — sets `inMainFlow=true` so each sub-phase knows it's part
 * of a composed flow (suppresses per-phase nextStep card, renders
 * "compact" completion chips instead — composition auto-advances).
 */
const toBreakdownInput = createStep({
  id: "to_breakdown_input",
  inputSchema: ScriptImportFlowInputSchema,
  outputSchema: z.object({ text: z.string(), styleHint: z.string().optional() }),
  execute: async ({ inputData, requestContext }) => {
    requestContext?.set("inMainFlow", true);
    return { text: inputData.text, styleHint: inputData.styleHint };
  },
});

const toParseScriptInput = createStep({
  id: "to_parse_script_input",
  // story_outline output → parse_script needs original text back.
  inputSchema: z.unknown(),
  outputSchema: z.object({
    projectId: z.string(),
    text: z.string(),
    targetEpisodeCount: z.number(),
  }),
  execute: async ({ getInitData }) => {
    const init = getInitData<z.infer<typeof ScriptImportFlowInputSchema>>();
    return {
      projectId: init.projectId,
      text: init.text,
      targetEpisodeCount: init.targetEpisodeCount,
    };
  },
});

const toRolePhaseInput = createStep({
  id: "to_role_phase_input",
  inputSchema: z.unknown(),
  outputSchema: z.object({ worldId: z.string() }),
  execute: async ({ getInitData }) => {
    const init = getInitData<z.infer<typeof ScriptImportFlowInputSchema>>();
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
    const init = getInitData<z.infer<typeof ScriptImportFlowInputSchema>>();
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
    const init = getInitData<z.infer<typeof ScriptImportFlowInputSchema>>();
    return { worldId: init.worldId };
  },
});

const toPropImagePhaseInput = createStep({
  id: "to_prop_image_phase_input",
  inputSchema: PropPhaseOutputSchema,
  outputSchema: z.object({}),
  execute: async () => ({}),
});

const toStoryboardPhaseInput = createStep({
  id: "to_storyboard_phase_input",
  // Previous step = prop_image_phase. We pull the JUST-committed episode ids
  // from parse_script's result and hand them to storyboard_phase as
  // `onlyEpisodeIds`, so any stale episodes lingering in the project from
  // prior runs are ignored — storyboards only for what we produced this run.
  inputSchema: z.unknown(),
  outputSchema: z.object({
    projectId: z.string(),
    onlyEpisodeIds: z.array(z.string()).optional(),
  }),
  execute: async ({ getInitData, getStepResult }) => {
    const init = getInitData<z.infer<typeof ScriptImportFlowInputSchema>>();
    const parseResult = getStepResult(parseScriptWorkflow) as
      | z.infer<typeof ParseScriptOutputSchema>
      | undefined;
    const onlyEpisodeIds =
      parseResult?.committed.map((c) => c.serverId).filter((id) => id.length > 0) ?? [];
    return {
      projectId: init.projectId,
      onlyEpisodeIds: onlyEpisodeIds.length > 0 ? onlyEpisodeIds : undefined,
    };
  },
});

const aggregateStep = createStep({
  id: "aggregate",
  inputSchema: StoryboardPhaseOutputSchema,
  outputSchema: ScriptImportFlowOutputSchema,
  execute: async ({ inputData, getStepResult }) => {
    const parseResult = getStepResult(parseScriptWorkflow) as
      | z.infer<typeof ParseScriptOutputSchema>
      | undefined;
    const rolesResult = getStepResult(rolePhaseWorkflow) as
      | z.infer<typeof RolePhaseOutputSchema>
      | undefined;
    const scenesResult = getStepResult(scenePhaseWorkflow) as
      | z.infer<typeof ScenePhaseOutputSchema>
      | undefined;
    const propsResult = getStepResult(propPhaseWorkflow) as
      | z.infer<typeof PropPhaseOutputSchema>
      | undefined;

    const episodesCommitted = parseResult?.committed.length ?? 0;
    const rolesCommitted = rolesResult?.committed.length ?? 0;
    const scenesCommitted = scenesResult?.committed.length ?? 0;
    const propsCommitted = propsResult?.committed.length ?? 0;
    const storyboardsCommitted = inputData.committed.length;

    const anyFailure =
      (parseResult?.failed.length ?? 0) > 0 ||
      (rolesResult?.failed.length ?? 0) > 0 ||
      (scenesResult?.failed.length ?? 0) > 0 ||
      (propsResult?.failed.length ?? 0) > 0 ||
      inputData.failed.length > 0;

    const outcome: z.infer<typeof ScriptImportFlowOutputSchema>["outcome"] = anyFailure
      ? "partial_failure"
      : "committed";

    return {
      outcome,
      episodesCommitted,
      rolesCommitted,
      scenesCommitted,
      propsCommitted,
      storyboardsCommitted,
      message:
        outcome === "committed"
          ? `剧本导入完成！${episodesCommitted} 集 / ${rolesCommitted} 角色 / ${scenesCommitted} 场景 / ${propsCommitted} 道具 / ${storyboardsCommitted} 集分镜。`
          : `剧本导入完成但有失败：分集 ${episodesCommitted} / 角色 ${rolesCommitted} / 场景 ${scenesCommitted} / 道具 ${propsCommitted} / 分镜 ${storyboardsCommitted}。`,
    };
  },
});

// ─── Compose ─────────────────────────────────────────────────────────

export const scriptImportFlowWorkflow = createWorkflow({
  id: "script_import_flow",
  description:
    "剧本完整管线：用户已有剧本 + 想做全套资产（角色/场景/道具图 + 分镜），但剧本不 rewrite。story_outline → parse_script → role(+img) → scene(+img) → prop(+img) → storyboard。跳过 episode_phase 和 script_phase。",
  inputSchema: ScriptImportFlowInputSchema,
  outputSchema: ScriptImportFlowOutputSchema,
})
  .then(toBreakdownInput)
  .then(scriptBreakdownWorkflow)
  .then(toParseScriptInput)
  .then(parseScriptWorkflow)
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
  .then(toStoryboardPhaseInput)
  .then(storyboardPhaseWorkflow)
  .then(aggregateStep)
  .commit();
