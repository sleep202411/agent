import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { listUserWorkflows, listWorkspaceWorkflows } from "../../workflows/engine";
import { getContext } from "../../lib/workspace-client";

export const listActiveWorkflows = createTool({
  id: "list_active_workflows",
  description:
    'List active (unfinished) workflows for the current user in the current workspace. Call when the user asks "what\'s running?" / "what tasks are active?".',
  inputSchema: z.object({
    scope: z.enum(["user", "workspace"]).default("user"),
    limit: z.number().int().min(1).max(50).default(10),
  }),
  outputSchema: z.object({
    runs: z.array(
      z.object({
        runId: z.string(),
        workflowName: z.string(),
        status: z.string(),
        currentStep: z.string().optional(),
        progress: z
          .object({ current: z.number(), total: z.number(), label: z.string().optional() })
          .optional(),
        startedAt: z.number(),
      })
    ),
  }),
  execute: async ({ scope, limit }, execCtx) => {
    const ctx = getContext(execCtx?.requestContext);
    const runs =
      scope === "user"
        ? await listUserWorkflows(ctx.userId, limit)
        : await listWorkspaceWorkflows(ctx.projectId, limit);
    return {
      runs: runs.map((r) => ({
        runId: r.runId,
        workflowName: r.workflowName,
        status: r.status,
        currentStep: r.currentStep,
        progress: r.progress,
        startedAt: r.startedAt,
      })),
    };
  },
});
