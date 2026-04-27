import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getWorkflowStatus } from "../../workflows/engine";
import { listDrafts } from "../../lib/drafts";

export const explainCurrentState = createTool({
  id: "explain_current_state",
  description:
    'Explain what a specific workflow run is doing right now: status, progress, current step, and whether it\'s waiting on user confirmation. Call when the user asks "how\'s it going?" / "where is it stuck?".',
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
