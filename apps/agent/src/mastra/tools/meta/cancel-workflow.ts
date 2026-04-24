import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { cancelWorkflow } from "../../workflows/engine";

export const cancelWorkflowTool = createTool({
  id: "cancel_workflow",
  description: '取消一个正在运行或暂停中的 workflow。用户明确说"停下"/"取消"/"别跑了"时调用。',
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
