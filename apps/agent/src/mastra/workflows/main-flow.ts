/**
 * main_flow — the big pipeline workflow that oiioii has as 故事短片创作主流程.
 *
 * Chains five phases with a HITL gate between each:
 *
 *   [1] script_breakdown   (analyst)       — extract characters/scenes/story
 *        ↓   no HITL here (pure analysis)
 *   [2] role_phase          (HITL)          — confirm roles → Java
 *        ↓
 *   [3] episode_phase      (planner + HITL) — plan episodes → Java
 *        ↓
 *   [4] script_phase       (writer + HITL)  — write per-episode scripts → Java
 *        ↓
 *   [5] storyboard_phase   (boarder + HITL) — boards per episode → Java
 *
 * Each sub-workflow suspend()s at its HITL; the outer main_flow suspends
 * transparently. When the user confirms a gate, main_flow resumes and flows
 * into the next phase automatically — no user intervention to start the
 * next phase, just continuous progress.
 *
 * Schemas between phases don't align 1:1, so we use thin transform steps
 * (pure data reshaping, no side effects) that pull from initData + the
 * previous phase's output via getStepResult.
 */
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { scriptBreakdownWorkflow, ScriptBreakdownOutputSchema } from "./phases/script-breakdown";
import { rolePhaseWorkflow, RolePhaseOutputSchema } from "./phases/role-phase";
import { episodePhaseWorkflow, EpisodePhaseOutputSchema } from "./phases/episode-phase";
import { scriptPhaseWorkflow, ScriptPhaseOutputSchema } from "./phases/script-phase";
import { storyboardPhaseWorkflow, StoryboardPhaseOutputSchema } from "./phases/storyboard-phase";
import { getContext, javaRequest } from "../lib/workspace-client";

// ─── Main flow schemas ────────────────────────────────────────────────

export const MainFlowInputSchema = z.object({
  projectId: z.string().min(1),
  worldId: z.string().min(1),
  /** Raw material for script_breakdown. Required. */
  text: z.string().min(1),
  /** Optional user hint — genre, tone, audience etc. */
  styleHint: z.string().optional(),
  /** How many episodes to plan. */
  targetEpisodeCount: z.number().int().min(1).max(60).default(10),
});

export const MainFlowOutputSchema = z.object({
  outcome: z.enum(["committed", "partial_failure", "rejected", "cancelled"]),
  rolesCommitted: z.number(),
  episodesCommitted: z.number(),
  scriptsCommitted: z.number(),
  storyboardsCommitted: z.number(),
  message: z.string(),
});

// ─── Transform steps (no side effects, just reshape) ──────────────────

/**
 * Take the analyst's output + the main-flow initData and produce role_phase
 * input. Only purpose: thread worldId from initData onto characters.
 */
const toRolePhaseInput = createStep({
  id: "to_role_phase_input",
  inputSchema: ScriptBreakdownOutputSchema,
  outputSchema: z.object({
    worldId: z.string(),
    characters: z.array(
      z.object({
        name: z.string(),
        role: z.string(),
        appearance: z.string(),
        personality: z.string(),
      })
    ),
  }),
  execute: async ({ inputData, getInitData }) => {
    const init = getInitData<z.infer<typeof MainFlowInputSchema>>();
    return {
      worldId: init.worldId,
      characters: inputData.characters,
    };
  },
});

/**
 * After roles commit, build episode_phase input. We still need storySummary
 * from the earlier script_breakdown — pull it via getStepResult.
 */
const toEpisodePhaseInput = createStep({
  id: "to_episode_phase_input",
  inputSchema: RolePhaseOutputSchema,
  outputSchema: z.object({
    projectId: z.string(),
    storySummary: z.string(),
    characters: z.array(z.object({ name: z.string(), role: z.string() })),
    targetEpisodeCount: z.number(),
    genre: z.string().optional(),
    tone: z.string().optional(),
  }),
  execute: async ({ getInitData, getStepResult }) => {
    const init = getInitData<z.infer<typeof MainFlowInputSchema>>();
    const breakdown = getStepResult(scriptBreakdownWorkflow) as
      | z.infer<typeof ScriptBreakdownOutputSchema>
      | undefined;
    if (!breakdown) throw new Error("script_breakdown result missing in state");
    return {
      projectId: init.projectId,
      storySummary: breakdown.storySummary,
      characters: breakdown.characters.map((c) => ({ name: c.name, role: c.role })),
      targetEpisodeCount: init.targetEpisodeCount,
      genre: breakdown.genre,
      tone: breakdown.tone,
    };
  },
});

/**
 * After episodes commit, assemble script_phase input. episode_phase returns
 * committed episode ids + titles; we need the introductions too, which are
 * in the breakdown + the original plan. We pull episode introductions by
 * re-reading the Java episodes list (cheap and authoritative).
 */
const toScriptPhaseInput = createStep({
  id: "to_script_phase_input",
  inputSchema: EpisodePhaseOutputSchema,
  outputSchema: z.object({
    projectId: z.string(),
    episodes: z.array(
      z.object({
        episodeId: z.string(),
        title: z.string(),
        introduction: z.string(),
      })
    ),
    storySummary: z.string(),
    characters: z.array(
      z.object({
        name: z.string(),
        role: z.string(),
        personality: z.string().optional(),
      })
    ),
    genre: z.string().optional(),
    tone: z.string().optional(),
  }),
  execute: async ({ inputData, getInitData, getStepResult, requestContext }) => {
    const init = getInitData<z.infer<typeof MainFlowInputSchema>>();
    const breakdown = getStepResult(scriptBreakdownWorkflow) as
      | z.infer<typeof ScriptBreakdownOutputSchema>
      | undefined;
    if (!breakdown) throw new Error("script_breakdown result missing");

    // Re-read episode list to pull the latest introductions (authoritative).
    const ctx = getContext(requestContext);
    const listed = await javaRequest<{
      list?: Array<{ id: string | number; title?: string; introduction?: string }>;
    }>(ctx, "/api/user/world/list/episode", {
      data: { productId: init.projectId, page: 1, pageSize: 999 },
    });
    const byId = new Map(
      (listed.list ?? []).map((ep) => [
        String(ep.id),
        { title: String(ep.title ?? ""), introduction: String(ep.introduction ?? "") },
      ])
    );

    const episodes = inputData.committed.map((ep) => {
      const meta = byId.get(ep.serverId) ?? { title: ep.title, introduction: "" };
      return {
        episodeId: ep.serverId,
        title: meta.title || ep.title,
        introduction: meta.introduction,
      };
    });

    return {
      projectId: init.projectId,
      episodes,
      storySummary: breakdown.storySummary,
      characters: breakdown.characters.map((c) => ({
        name: c.name,
        role: c.role,
        personality: c.personality,
      })),
      genre: breakdown.genre,
      tone: breakdown.tone,
    };
  },
});

/**
 * After scripts commit, build storyboard_phase input. We need the actual
 * script content for each episode — re-read from Java.
 */
const toStoryboardPhaseInput = createStep({
  id: "to_storyboard_phase_input",
  inputSchema: ScriptPhaseOutputSchema,
  outputSchema: z.object({
    projectId: z.string(),
    episodes: z.array(
      z.object({
        episodeId: z.string(),
        title: z.string(),
        scriptContent: z.string(),
      })
    ),
  }),
  execute: async ({ inputData, getInitData, requestContext }) => {
    const init = getInitData<z.infer<typeof MainFlowInputSchema>>();
    const ctx = getContext(requestContext);

    const episodes: Array<{ episodeId: string; title: string; scriptContent: string }> = [];
    for (const ep of inputData.committed) {
      const resp = await javaRequest<{ content?: string } | null>(
        ctx,
        `/api/user/project/scripts/episode/detail/${ep.episodeId}`
      ).catch(() => null);
      const scriptContent = (resp as { content?: string } | null)?.content ?? "";
      // Skip episodes with empty content — storyboarder has nothing to work from.
      if (scriptContent.length < 50) continue;
      episodes.push({ episodeId: ep.episodeId, title: ep.title, scriptContent });
    }

    if (episodes.length === 0) {
      throw new Error("no episodes have readable script content for storyboarding");
    }

    return { projectId: init.projectId, episodes };
  },
});

/** Final step — aggregate outputs from all phases into a single summary. */
const aggregateStep = createStep({
  id: "aggregate",
  inputSchema: StoryboardPhaseOutputSchema,
  outputSchema: MainFlowOutputSchema,
  execute: async ({ inputData, getStepResult }) => {
    const rolesResult = getStepResult(rolePhaseWorkflow) as
      | z.infer<typeof RolePhaseOutputSchema>
      | undefined;
    const episodesResult = getStepResult(episodePhaseWorkflow) as
      | z.infer<typeof EpisodePhaseOutputSchema>
      | undefined;
    const scriptsResult = getStepResult(scriptPhaseWorkflow) as
      | z.infer<typeof ScriptPhaseOutputSchema>
      | undefined;

    const rolesCommitted = rolesResult?.committed.length ?? 0;
    const episodesCommitted = episodesResult?.committed.length ?? 0;
    const scriptsCommitted = scriptsResult?.committed.length ?? 0;
    const storyboardsCommitted = inputData.committed.length;

    const anyFailure =
      (rolesResult?.failed.length ?? 0) > 0 ||
      (episodesResult?.failed.length ?? 0) > 0 ||
      (scriptsResult?.failed.length ?? 0) > 0 ||
      inputData.failed.length > 0;

    const outcome: z.infer<typeof MainFlowOutputSchema>["outcome"] = anyFailure
      ? "partial_failure"
      : "committed";

    return {
      outcome,
      rolesCommitted,
      episodesCommitted,
      scriptsCommitted,
      storyboardsCommitted,
      message:
        outcome === "committed"
          ? `主流程完成！已入库 ${rolesCommitted} 角色 / ${episodesCommitted} 集大纲 / ${scriptsCommitted} 集剧本 / ${storyboardsCommitted} 集分镜。`
          : `主流程完成但有失败项目：角色 ${rolesCommitted} / 分集 ${episodesCommitted} / 剧本 ${scriptsCommitted} / 分镜 ${storyboardsCommitted}。检查各阶段 drafts 和 errors。`,
    };
  },
});

// ─── Adapter: reshape main_flow input for script_breakdown ────────────

const toBreakdownInput = createStep({
  id: "to_breakdown_input",
  inputSchema: MainFlowInputSchema,
  outputSchema: z.object({
    text: z.string(),
    styleHint: z.string().optional(),
  }),
  execute: async ({ inputData }) => ({
    text: inputData.text,
    styleHint: inputData.styleHint,
  }),
});

// ─── Compose ──────────────────────────────────────────────────────────

export const mainFlowWorkflow = createWorkflow({
  id: "main_flow",
  description:
    '从素材到成片的完整主流程：解析 → 角色确认 → 分集确认 → 剧本确认 → 分镜确认。每阶段自动进入下一阶段，用户只需点"满意"。',
  inputSchema: MainFlowInputSchema,
  outputSchema: MainFlowOutputSchema,
})
  .then(toBreakdownInput)
  .then(scriptBreakdownWorkflow)
  .then(toRolePhaseInput)
  .then(rolePhaseWorkflow)
  .then(toEpisodePhaseInput)
  .then(episodePhaseWorkflow)
  .then(toScriptPhaseInput)
  .then(scriptPhaseWorkflow)
  .then(toStoryboardPhaseInput)
  .then(storyboardPhaseWorkflow)
  .then(aggregateStep)
  .commit();
