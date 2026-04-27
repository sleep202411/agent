import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { cancelWorkflow } from "../../workflows/engine";

export const cancelWorkflowTool = createTool({
  id: "cancel_workflow",
  description:
    'Cancel a running or suspended workflow. Call when the user explicitly says "stop", "cancel", or "abort it".',
  inputSchema: z.object({
    runId: z.string(),
  }),
  outputSchema: z.object({
    runId: z.string(),
    message: z.string(),
  }),
  execute: async ({ runId }) => {
    await cancelWorkflow(runId);
    return { runId, message: `Requested cancellation of workflow ${runId}.` };
  },
});
