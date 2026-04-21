/**
 * Workflow HTTP contract — shared between server and web.
 *
 * Most of the runtime "state" surface (status/events/progress) moved to
 * per-event chat messages (see workflow-messages.ts); what's left here is
 * just the enums + the confirm-request body validated by Mastra's
 * /workflow/:runId/confirm handler.
 */
import { z } from "zod";

export const WORKFLOW_NAMES = [
  "main_flow",
  "script_to_storyboard_flow",
  "role_design",
  "scene_design",
  "prop_design",
  "batch_create_asset",
  "script_edit",
  "story_outline",
  "parse_script",
  "role_phase",
  "role_image_phase",
  "scene_phase",
  "scene_image_phase",
  "prop_phase",
  "prop_image_phase",
  "episode_phase",
  "script_phase",
  "storyboard_phase",
] as const;

export type WorkflowName = (typeof WORKFLOW_NAMES)[number];

export const ConfirmRequestSchema = z.object({
  /** True = approve drafts and commit; false = reject, loop back for revision. */
  approved: z.boolean(),
  /** Optional free-text feedback sent back to the workflow for revision passes. */
  feedback: z.string().optional(),
  /**
   * Optional subset of clientRefIds the user approved. When omitted we commit
   * all pending drafts for the run. Useful when user hand-picks some roles.
   */
  acceptedClientRefIds: z.array(z.string()).optional(),
});
export type ConfirmRequest = z.infer<typeof ConfirmRequestSchema>;
