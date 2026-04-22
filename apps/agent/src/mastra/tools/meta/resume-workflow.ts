/**
 * resume_workflow — supervisor-facing wrapper over the engine's resume
 * machinery. Two callers:
 *
 * 1. **Frontend button short-circuit** (Nest /workflow/:runId/confirm) —
 *    user clicked "满意" or typed feedback after "我要修改".
 * 2. **LLM natural-language path** — user types "继续 / 满意 / 就这样" or
 *    "这版不行，X 再改改" etc. while a workflow is suspended. Supervisor
 *    calls `list_active_workflows` to get runId, then calls this tool.
 *
 * For revise (approved=false), the phase workflow discards drafts and
 * ends with "rejected" — no automatic re-run. The supervisor follows up
 * with a fresh `invoke_workflow(<phase>)` carrying the feedback. See the
 * prompt's "Suspended workflow 期间的处理" section.
 *
 * The engine's resumeWorkflow is idempotent on non-suspended runs so
 * duplicate calls are harmless.
 */
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { resumeWorkflow } from "../../workflows/engine";
import { getContext } from "../../lib/workspace-client";

export const resumeWorkflowTool = createTool({
  id: "resume_workflow",
  description:
    '恢复一个 suspended 状态的 workflow。用在：用户在 HITL 卡片上点"满意"，或在输入框里说"继续/满意/就这样 / 取消这一版 / 重做，改得严肃点"这类针对当前 suspended phase 的意图。runId 从 list_active_workflows 拿。approved=true 提交 drafts；approved=false + feedback 丢弃当前 drafts，然后你必须立即 invoke_workflow 同一 phase 带上 feedback 重跑（见 prompt 里的硬规则 5）。',
  inputSchema: z.object({
    runId: z.string().min(1).describe("目标 workflow run 的 id（从 list_active_workflows 拿）"),
    approved: z
      .boolean()
      .describe(
        "true = 提交 drafts 进入下一阶段；false = 丢弃 drafts，配合 feedback 等待你重 invoke 这个 phase"
      ),
    feedback: z
      .string()
      .optional()
      .describe("当 approved=false 时，用户的具体修改意见（会写进消息 log）"),
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
