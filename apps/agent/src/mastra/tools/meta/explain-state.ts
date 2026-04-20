import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getWorkflowStatus } from "../../workflows/engine";
import { listDrafts } from "../../lib/drafts";

export const explainCurrentState = createTool({
  id: "explain_current_state",
  description:
    '解释一个具体的 workflow run 当前在干啥：状态、进度、当前 step、是否在等用户确认。用户追问"进度怎么样?"/"卡在哪了?"时调用。',
  inputSchema: z.object({ runId: z.string() }),
  outputSchema: z.object({
    runId: z.string(),
    status: z.string(),
    currentStep: z.string().optional(),
    progress: z
      .object({ current: z.number(), total: z.number(), label: z.string().optional() })
      .optional(),
    awaitingConfirmation: z.boolean(),
    pendingDraftCount: z.number(),
    error: z.string().optional(),
  }),
  execute: async ({ runId }) => {
    const meta = await getWorkflowStatus(runId);
    if (!meta) {
      throw new Error(`Workflow run ${runId} not found`);
    }
    const awaitingConfirmation = meta.status === "suspended";
    const pendingDrafts = awaitingConfirmation
      ? await listDrafts(runId, { statuses: ["pending"] })
      : [];
    return {
      runId: meta.runId,
      status: meta.status,
      currentStep: meta.currentStep,
      progress: meta.progress,
      awaitingConfirmation,
      pendingDraftCount: pendingDrafts.length,
      error: meta.error,
    };
  },
});
