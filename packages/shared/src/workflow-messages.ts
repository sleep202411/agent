/**
 * Schemas for the five assistant-message payloads the server emits during a
 * workflow run. Each becomes a synthetic `tool-<name>` part on an
 * AssistantMessage written to the chat message store; the client renders
 * them as generative-UI cards.
 *
 * Stream model (matches oii.ai):
 *   - started    — fires once when the workflow is enqueued
 *   - progress   — one per macro-phase ("planning" before HITL, "committing"
 *                  after); the message id is reused and `updateMessage` is
 *                  called as the phase advances, so the card streams like
 *                  ordinary AI text until the phase ends
 *   - suspended  — fires when the workflow hits a HITL gate; contains the
 *                  draft summary + invites user action (滿意 / 修改)
 *   - completed  — fires once on terminal success; carries the commit
 *                  result and an optional nextStep hint so the client can
 *                  surface a "继续·xxx" button
 *   - failed     — fires on terminal failure or cancellation; retryable flag
 *                  + classification drive the UI
 *
 * IDs are deterministic (`wf_{runId}_{kind}[_{phase}]`) so the publisher can
 * either add a fresh message or patch an existing one idempotently.
 */
import { z } from "zod";
import { WORKFLOW_NAMES } from "./workflow.js";

const WorkflowNameEnum = z.enum(WORKFLOW_NAMES);

export const WORKFLOW_MACRO_PHASES = ["planning", "committing"] as const;
export const WorkflowMacroPhase = z.enum(WORKFLOW_MACRO_PHASES);
export type WorkflowMacroPhase = z.infer<typeof WorkflowMacroPhase>;

/** Base fields every workflow-message output carries so the UI can route. */
const BaseWorkflowOutput = z.object({
  runId: z.string().min(1),
  workflowName: WorkflowNameEnum,
});

// ─── started ──────────────────────────────────────────────────────────

export const WorkflowStartedOutputSchema = BaseWorkflowOutput.extend({
  /** Expected number of items the workflow will produce (roles, scenes, etc.). */
  plannedCount: z.number().int().nonnegative().optional(),
  /** One-line caption shown under the persona header. */
  summary: z.string().optional(),
});
export type WorkflowStartedOutput = z.infer<typeof WorkflowStartedOutputSchema>;

// ─── progress ─────────────────────────────────────────────────────────

export const WorkflowProgressOutputSchema = BaseWorkflowOutput.extend({
  phase: WorkflowMacroPhase,
  current: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  /** Step-level label, e.g. "角色设计师正在扩展「迈克」…". */
  label: z.string().optional(),
  /** Accumulated persona narration bullets shown as a list under the bar. */
  narrateLines: z.array(z.string()).optional(),
});
export type WorkflowProgressOutput = z.infer<typeof WorkflowProgressOutputSchema>;

// ─── suspended (HITL gate) ───────────────────────────────────────────

export const WorkflowDraftPreviewSchema = z.object({
  clientRefId: z.string().min(1),
  /**
   * Full draft data payload — same as `Draft.data` on the drafts REST
   * endpoint. Embedded here so the suspended card can render both the
   * preview grid and the detail dialog (with Seedance edit / save) without
   * a round-trip. Schema is intentionally loose (`record`) since each
   * workflow has its own draft shape.
   */
  data: z.record(z.string(), z.unknown()),
});
export type WorkflowDraftPreview = z.infer<typeof WorkflowDraftPreviewSchema>;

export const WorkflowDraftGroupSchema = z.object({
  /** "role" / "scene" / "prop" / … */
  entityType: z.string().min(1),
  count: z.number().int().nonnegative(),
  items: z.array(WorkflowDraftPreviewSchema),
});
export type WorkflowDraftGroup = z.infer<typeof WorkflowDraftGroupSchema>;

export const WorkflowSuspendedOutputSchema = BaseWorkflowOutput.extend({
  /** Usually a single group per suspension, but typed as array for future. */
  draftGroups: z.array(WorkflowDraftGroupSchema),
  totalDraftCount: z.number().int().nonnegative(),
});
export type WorkflowSuspendedOutput = z.infer<typeof WorkflowSuspendedOutputSchema>;

// ─── completed ───────────────────────────────────────────────────────

export const WorkflowNextStepSchema = z.object({
  workflowName: WorkflowNameEnum,
  /** i18n key for the button label. */
  labelKey: z.string(),
  /** Optional synthetic user prompt to post alongside the button click. */
  prompt: z.string().optional(),
});
export type WorkflowNextStep = z.infer<typeof WorkflowNextStepSchema>;

export const WorkflowCommittedItemSchema = z.object({
  serverId: z.string().min(1),
  title: z.string().optional(),
});
export type WorkflowCommittedItem = z.infer<typeof WorkflowCommittedItemSchema>;

export const WorkflowCompletedOutputSchema = BaseWorkflowOutput.extend({
  /** What actually made it into Java. */
  committed: z.array(WorkflowCommittedItemSchema),
  /** Optional "this failed" items for partial_failure cases. */
  failed: z.array(z.object({ clientRefId: z.string(), reason: z.string() })).optional(),
  /** Short human-readable summary (matches old workflow output `message`). */
  summary: z.string().optional(),
  /**
   * Workflow-specific structured result — shape varies by workflowName.
   * Used to render inline summary panels (e.g. story_outline's chapter /
   * cast / settings list). Loose typing because each workflow's shape is
   * different; the client dispatches on workflowName to interpret.
   */
  result: z.record(z.string(), z.unknown()).optional(),
  /** Deterministic follow-up — when set, the UI shows a big "继续·xxx" button. */
  nextStep: WorkflowNextStepSchema.optional(),
});
export type WorkflowCompletedOutput = z.infer<typeof WorkflowCompletedOutputSchema>;

// ─── failed / cancelled ───────────────────────────────────────────────

export const WorkflowFailedOutputSchema = BaseWorkflowOutput.extend({
  terminalStatus: z.enum(["failed", "cancelled"]),
  error: z.string(),
  /** Loose string matching the existing ErrorClassification; UI maps to label. */
  classification: z.string().optional(),
  retryable: z.boolean(),
});
export type WorkflowFailedOutput = z.infer<typeof WorkflowFailedOutputSchema>;

// ─── tool-name union (client-side router) ─────────────────────────────

export const WORKFLOW_MESSAGE_TOOL_NAMES = [
  "workflow_started",
  "workflow_progress",
  "workflow_suspended",
  "workflow_completed",
  "workflow_failed",
] as const;
export type WorkflowMessageToolName = (typeof WORKFLOW_MESSAGE_TOOL_NAMES)[number];

export function isWorkflowMessageToolName(name: string): name is WorkflowMessageToolName {
  return (WORKFLOW_MESSAGE_TOOL_NAMES as readonly string[]).includes(name);
}
