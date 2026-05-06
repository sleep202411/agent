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
  "produce_script_pipeline",
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
  /**
   * When true (default), the agent publishes a side-channel
   * `workflow_completed` / `workflow_failed` chat message — legacy
   * behavior for callers without a host message to attach to. Set false
   * from Nest's `confirmWorkflow` short-circuit: Nest owns the assistant
   * message and embeds the returned `completion` / `failure` payload as
   * a `tool-apply_phase_drafts` part, so card + follow-up text live in
   * one bubble instead of fragmenting into a sibling message.
   */
  emitLifecycleMessage: z.boolean().optional(),
  /**
   * parse_script-only opt-in: when true, the apply step deletes the
   * project's existing episodes before writing this batch's drafts. When
   * false / omitted, episodes are appended (legacy behaviour). The HITL
   * card surfaces this toggle only when the suspended payload reports a
   * non-zero `existingEpisodeCount`. Other phases ignore the field.
   */
  replaceExisting: z.boolean().optional(),
});
export type ConfirmRequest = z.infer<typeof ConfirmRequestSchema>;
