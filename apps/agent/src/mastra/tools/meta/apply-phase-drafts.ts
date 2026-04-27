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
    'Commit or discard the drafts of a HITL phase. Use when the user has reacted to a suspended phase\'s contents: "looks good / continue" → approved=true commits to Java and prompts "what\'s next" via the completion card; "redo / change it to X" → approved=false + feedback, drafts are discarded, then you **must immediately** invoke_workflow on the same phase carrying the feedback to re-run. Get runId from the most recent workflow_suspended event or list_active_workflows. **Note: this tool\'s output is itself rendered as a completion card (with next-step buttons) — do not also write a recap as text. End the turn.',
  inputSchema: z.object({
    runId: z.string().min(1),
    phase: PhaseNameEnum,
    approved: z
      .boolean()
      .describe(
        "true = commit drafts to Java; false = discard drafts (paired with feedback in revise flows)"
      ),
    feedback: z
      .string()
      .optional()
      .describe("When approved=false, the user's concrete revision notes (for logging)"),
    acceptedClientRefIds: z
      .array(z.string())
      .optional()
      .describe("Fine-grained selection: only commit these drafts. Omit to commit all."),
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
