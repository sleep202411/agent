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
} from "./context-loader";
import { askPersona, type AskPersonaResult } from "./ask-persona";
import { getContext, type StoryosContext } from "../../lib/workspace-client";

// ─── Shared output schema ──────────────────────────────────────────────

const ReplySchema = z.object({
  persona: z.string(),
  reply: z.string(),
  tookMs: z.number(),
  contextBytes: z.number(),
  error: z.string().optional(),
});

// ─── Shared scope schemas ──────────────────────────────────────────────

const ScopeSchema = z.object({
  /** Focus on a specific episode's script when relevant. */
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
    if (body) blocks.push({ heading: "项目概况", body });
  }
  if (eff.includeEpisodes) {
    const body = await loadEpisodes(ctx);
    if (body) blocks.push({ heading: "剧集列表", body });
  }
  if (eff.includeRoles) {
    const body = await loadRoles(ctx);
    if (body) blocks.push({ heading: "现有角色", body });
  }
  if (eff.includeScenes) {
    const body = await loadScenes(ctx);
    if (body) blocks.push({ heading: "现有场景", body });
  }
  if (eff.includeProps) {
    const body = await loadProps(ctx);
    if (body) blocks.push({ heading: "现有道具", body });
  }
  if (eff.episodeId) {
    const body = await loadEpisodeScript(ctx, eff.episodeId);
    if (body) blocks.push({ heading: `第 ${eff.episodeId} 集现有剧本`, body });
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
      task: z.string().min(1).describe("要交给这个 persona 的任务或问题，用自然语言。"),
      scope: ScopeSchema.optional().describe("手动指定要拉的项目上下文；一般不用填，用默认即可。"),
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
          reply: "",
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
    "让编剧单轮回答一个问题或改写一段（单集、单场戏范围）。只返回文字回复，不落库。适用：讨论具体台词、点评节奏、微改一段。批量重写整集请用 invoke_workflow('script_edit')。必传 task；可选 scope.episodeId 聚焦某一集。",
  defaultScope: { includeProject: true, includeRoles: true },
});

export const askCharacterDesigner = makeAskTool({
  toolId: "ask_character_designer",
  agentId: "roleDesigner",
  description:
    "让角色设计师单轮讨论/微调某个角色的设定（外观、性格、定位）。只返回文字回复，不落库。适用：讨论人物深化、补视觉细节、跨角色做差异度比较。批量重新设计请用 invoke_workflow('role_design')。",
  defaultScope: { includeProject: true, includeRoles: true },
});

export const askSceneDesigner = makeAskTool({
  toolId: "ask_scene_designer",
  agentId: "sceneDesigner",
  description:
    "让场景设计师设计/讨论/微调某个场景（环境、光线、氛围、道具）。只返回文字回复，不落库。适用：单场景快速草图、现有场景改细节、配合剧本场次做环境补充。",
  defaultScope: { includeProject: true, includeScenes: true, includeRoles: true },
});

export const askArtDirector = makeAskTool({
  toolId: "ask_art_director",
  agentId: "artDirector",
  description:
    '让艺术总监(1) 在项目开始时确立视觉基调，或(2) 评审已有角色/场景/分镜的美术一致性。只返回文字/结构化报告到聊天，不落库。用户问"风格统一吗"、"基调对不对"、"三集之间视觉有差距吗"优先调这个。',
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
    "让分镜设计师讨论某场戏的镜头语言、提建议、点评现有分镜。只返回文字回复，不落库。适用：单场戏出 3-5 个镜头建议、评估现有分镜可拍性、讨论运镜。批量生成某集分镜请用 invoke_workflow('storyboard_phase')。",
  defaultScope: { includeProject: true, includeScenes: true },
});

export const askEpisodePlanner = makeAskTool({
  toolId: "ask_episode_planner",
  agentId: "episodePlanner",
  description:
    '让剧集结构师讨论分集结构（建议集数、集间钩子、主线分配）。只返回文字回复，不落库。适用：用户问"这个故事适合几集"、"第 4 集结尾怎么留钩子"、"我想把第 3 和第 5 集位置换一下行吗"。批量生成分集大纲请用 invoke_workflow(\'episode_phase\')。',
  defaultScope: { includeProject: true, includeEpisodes: true, includeRoles: true },
});
