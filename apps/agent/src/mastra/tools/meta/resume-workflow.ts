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
    'Resume a workflow that is in suspended state. Use when the user clicks "approve" on a HITL card, or types "continue / looks good / drop this take, redo it more serious" while a workflow is suspended. Get the runId from list_active_workflows. approved=true commits the drafts; approved=false + feedback discards the drafts — you MUST then immediately invoke_workflow for the same phase carrying the feedback (see hard rule 5 in the prompt).',
  inputSchema: z.object({
    runId: z.string().min(1).describe("Target workflow run id (from list_active_workflows)"),
    approved: z
      .boolean()
      .describe(
        "true = commit drafts and advance to the next phase; false = discard drafts, then re-invoke this phase with feedback"
      ),
    feedback: z
      .string()
      .optional()
      .describe("When approved=false, the user's concrete revision notes (logged on the message)"),
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
