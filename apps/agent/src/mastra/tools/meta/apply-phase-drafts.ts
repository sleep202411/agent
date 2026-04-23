/**
 * apply_phase_drafts — commit or discard staged drafts for a HITL phase.
 *
 * Post-Stage-C, each phase workflow generates drafts → ends. Commit is a
 * separate action: either the frontend 继续/修改 button (Nest dispatches
 * to the phase's apply function via `/workflow/:runId/confirm`) OR the
 * supervisor calling this tool in response to natural-language confirm /
 * revise intent ("就这么定 / 继续 / 改得严肃点").
 *
 * Tool dispatches to the phase-specific `apply*Drafts` helper exported
 * from each phase's workflow file. Keeps commit logic co-located with
 * the phase that emits the drafts.
 */
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getContext } from "../../lib/workspace-client";
import { applySceneDrafts } from "../../workflows/phases/scene-phase";
import { applyRoleDrafts } from "../../workflows/phases/role-phase";
import { applyPropDrafts } from "../../workflows/phases/prop-phase";
import { applyEpisodeDrafts } from "../../workflows/phases/episode-phase";
import { applyScriptDrafts } from "../../workflows/phases/script-phase";
import { applyStoryboardDrafts } from "../../workflows/phases/storyboard-phase";

const PhaseNameEnum = z.enum([
  "scene_phase",
  "role_phase",
  "prop_phase",
  "episode_phase",
  "script_phase",
  "storyboard_phase",
]);

export const applyPhaseDrafts = createTool({
  id: "apply_phase_drafts",
  description:
    '提交或丢弃某个 HITL phase 的 drafts。用在用户对 suspended phase 的内容表态时：明确"满意/继续" → approved=true 入库并通过 completion card 问"下一步"；"重做/改成 X" → approved=false + feedback，丢弃草稿，然后你**必须立即** invoke_workflow 同一 phase 带上 feedback 重跑。runId 从最近的 workflow_suspended 事件或 list_active_workflows 拿。**注意：这个工具的 output 本身就渲染为 completion 卡片（包含下一步按钮），不要再用 text 重复总结 —— 直接结束 turn。',
  inputSchema: z.object({
    runId: z.string().min(1),
    phase: PhaseNameEnum,
    approved: z
      .boolean()
      .describe("true = 提交 drafts 到 Java；false = 丢弃 drafts（配合 feedback 的 revise 场景）"),
    feedback: z.string().optional().describe("当 approved=false 时用户的具体修改意见（log 用）"),
    acceptedClientRefIds: z
      .array(z.string())
      .optional()
      .describe("精细化选择：只提交指定的 drafts。不传则提交全部"),
  }),
  outputSchema: z.object({
    outcome: z.enum(["committed", "partial_failure", "rejected"]),
    committedCount: z.number(),
    failedCount: z.number(),
    message: z.string(),
    /**
     * Completion card payload when approved=true (shape is the shared
     * WorkflowCompletedOutput — kept loose here because @repo/shared uses a
     * different zod version than this tool's createTool() call). Frontend
     * renders it inline inside the supervisor's message, so the card and
     * any follow-up text live in one bubble rather than fragmenting into
     * two messages.
     */
    completion: z.record(z.string(), z.unknown()).nullable(),
    /** Failure card payload when approved=false (WorkflowFailedOutput shape). */
    failure: z.record(z.string(), z.unknown()).nullable(),
  }),
  execute: async (input, execCtx) => {
    const ctx = getContext(execCtx?.requestContext);
    const common = {
      ctx,
      runId: input.runId,
      approved: input.approved,
      feedback: input.feedback,
      acceptedClientRefIds: input.acceptedClientRefIds,
      // NL path owns the card via tool output — tell the phase helper not
      // to also fire a side-channel workflow_completed/failed message.
      emitLifecycleMessage: false,
    };
    switch (input.phase) {
      case "scene_phase":
        return applySceneDrafts(common);
      case "role_phase":
        return applyRoleDrafts(common);
      case "prop_phase":
        return applyPropDrafts(common);
      case "episode_phase":
        return applyEpisodeDrafts(common);
      case "script_phase":
        return applyScriptDrafts(common);
      case "storyboard_phase":
        return applyStoryboardDrafts(common);
      default: {
        const _exhaustive: never = input.phase;
        void _exhaustive;
        throw new Error(`apply_phase_drafts: unsupported phase ${input.phase}`);
      }
    }
  },
});
