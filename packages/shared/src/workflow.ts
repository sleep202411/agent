/**
 * Workflow API contract — shared between server and web.
 *
 * Mirrors the fields on WorkflowMeta in apps/agent without dragging in any
 * Mastra or ioredis types. Web uses these to render the task card; server
 * validates inbound confirm/cancel payloads against the schemas.
 */
import { z } from "zod";
import { ERROR_CLASSIFICATIONS } from "./error-classification.js";

export const WORKFLOW_NAMES = [
  "main_flow",
  "role_design",
  "batch_create_asset",
  "script_edit",
  "story_outline",
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

export const WorkflowStatus = z.enum([
  "queued",
  "running",
  "suspended",
  "completed",
  "failed",
  "cancelled",
]);
export type WorkflowStatus = z.infer<typeof WorkflowStatus>;

export const ProgressSchema = z.object({
  current: z.number().int().min(0),
  total: z.number().int().min(0),
  label: z.string().optional(),
});

export const WorkflowMetaPublicSchema = z.object({
  runId: z.string(),
  workflowName: z.enum(WORKFLOW_NAMES),
  workspaceId: z.string(),
  userId: z.string(),
  status: WorkflowStatus,
  currentStep: z.string().optional(),
  progress: ProgressSchema.optional(),
  startedAt: z.number(),
  updatedAt: z.number(),
  completedAt: z.number().optional(),
  error: z.string().optional(),
  /** Categorized error for UI — see shared/error-classification.ts. */
  errorClassification: z.enum(ERROR_CLASSIFICATIONS).optional(),
  suspendPayload: z.unknown().optional(),
  result: z.unknown().optional(),
});
export type WorkflowMetaPublic = z.infer<typeof WorkflowMetaPublicSchema>;

// ─── Request/response schemas for HTTP routes ─────────────────────────

export const ResumeRequestSchema = z.object({
  resumeData: z.unknown(),
  stepId: z.string().optional(),
});
export type ResumeRequest = z.infer<typeof ResumeRequestSchema>;

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

export const WorkflowEventTypeSchema = z.enum([
  "enqueued",
  "started",
  "step.started",
  "step.completed",
  "step.failed",
  "progress",
  // Persona-voiced narration emitted BY the workflow itself (e.g. "剧本统筹
  // 正在拆解素材…"). Consumed by the frontend workflow card, accumulated as
  // a streaming bullet list. data: {persona?: string, text: string}.
  "narrate",
  "suspended",
  "resumed",
  "completed",
  "failed",
  "cancelled",
]);
export type WorkflowEventType = z.infer<typeof WorkflowEventTypeSchema>;

export const WorkflowEventPublicSchema = z.object({
  id: z.string().optional(),
  runId: z.string(),
  timestamp: z.number(),
  type: WorkflowEventTypeSchema,
  data: z.unknown().optional(),
});
export type WorkflowEventPublic = z.infer<typeof WorkflowEventPublicSchema>;

export const StatusResponseSchema = WorkflowMetaPublicSchema.extend({
  recentEvents: z.array(WorkflowEventPublicSchema).optional(),
});
export type StatusResponse = z.infer<typeof StatusResponseSchema>;
