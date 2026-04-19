/**
 * resume_workflow — supervisor-facing wrapper over the engine's resume
 * machinery. Used when the user clicks "满意 / 我要修改" on a HITL-suspended
 * workflow card. The LLM sees a `<CONFIRM_WORKFLOW>` marker in the user
 * message, extracts runId + approved + feedback, and calls this tool.
 *
 * The engine's resumeWorkflow is idempotent on non-suspended runs (see
 * runner.ts) so duplicate tool calls are harmless.
 */
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { resumeWorkflow } from "../../workflows/engine";
import { getContext } from "../../lib/workspace-client";

export const resumeWorkflowTool = createTool({
  id: "resume_workflow",
  description:
    "恢复一个 suspended 状态的 workflow 运行。用户在 HITL 卡片上点了'满意'或'我要修改'时调用。参数从 user 消息里的 <CONFIRM_WORKFLOW> 标签解析。",
  inputSchema: z.object({
    runId: z.string().min(1).describe("目标 workflow run 的 id（来自 CONFIRM_WORKFLOW 标签）"),
    approved: z
      .boolean()
      .describe("用户是否满意——true 进入 commit/next step；false 带 feedback 重走当前 step"),
    feedback: z.string().optional().describe("当 approved=false 时，用户的具体修改意见"),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    runId: z.string(),
  }),
  execute: async (inputData, execCtx) => {
    const ctx = getContext(execCtx?.requestContext);
    await resumeWorkflow({
      runId: inputData.runId,
      resumeData: {
        approved: inputData.approved,
        feedback: inputData.feedback,
      },
      ctx,
    });
    return { ok: true, runId: inputData.runId };
  },
});
