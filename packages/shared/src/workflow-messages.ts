/**
 * Schemas for the four assistant-message payloads the server emits during a
 * workflow run. Each becomes a synthetic `tool-<name>` part on an
 * AssistantMessage written to the chat message store; the client renders
 * them as generative-UI cards.
 *
 * Stream model (matches oii.ai):
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

/**
 * Hint to the HITL card about what clicking 满意 will *next* trigger +
 * how much it will cost. Optional — terminal phases (like storyboard)
 * omit it and the UI falls back to a generic "完成" label.
 */
export const WorkflowNextActionSchema = z.object({
  workflowName: WorkflowNameEnum,
  /** Conservative upper-bound estimate in credits, same semantics as preflight. */
  estimatedCost: z.number().int().nonnegative(),
});
export type WorkflowNextAction = z.infer<typeof WorkflowNextActionSchema>;

export const WorkflowSuspendedOutputSchema = BaseWorkflowOutput.extend({
  /** Usually a single group per suspension, but typed as array for future. */
  draftGroups: z.array(WorkflowDraftGroupSchema),
  totalDraftCount: z.number().int().nonnegative(),
  /**
   * Credits this phase will deduct when the user resolves the HITL
   * (whether 满意 or 不满意 — generation cost is already incurred).
   * Omitted (or 0) means the phase is free (image phases,
   * batch_create_asset) — UI skips the "(X 分)" suffix.
   */
  estimatedCost: z.number().int().nonnegative().optional(),
  /** What happens if user clicks 满意. Absent on terminal phases. */
  nextAction: WorkflowNextActionSchema.optional(),
});
export type WorkflowSuspendedOutput = z.infer<typeof WorkflowSuspendedOutputSchema>;

// ─── completed ───────────────────────────────────────────────────────

export const WorkflowNextStepSchema = z.object({
  workflowName: WorkflowNameEnum,
  /** i18n key for the button label. */
  labelKey: z.string(),
  /** Optional synthetic user prompt to post alongside the button click. */
  prompt: z.string().optional(),
  /**
   * UI styling hint. `primary` renders as the filled accent button (default
   * action, e.g. "生成场景图"); everything else renders as secondary
   * (e.g. "跳过，去道具"). First entry is `primary` by default if unspecified.
   */
  variant: z.enum(["primary", "secondary"]).optional(),
  /**
   * Credits this next step will cost. Omit or 0 = free. Rendered inline
   * with the label, e.g. "生成场景图 (15 积分)".
   */
  estimatedCost: z.number().int().nonnegative().optional(),
  /**
   * Extra inputData to merge into the next workflow invocation. Callers
   * use this to scope the next step to just-committed records (e.g.
   * episode_phase completion passes `episodeIds: [...]` so script_phase
   * only writes scripts for THIS batch, not every historical episode in
   * the project). Frontend merges this over its generic `buildInputData`
   * result; fields conflict → this wins.
   */
  inputData: z.record(z.string(), z.unknown()).optional(),
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
  /**
   * User's next-step options. One → single "继续·xxx" button. Two+ → options
   * laid out as primary/secondary actions (e.g. 场景提交后：生成场景图 vs
   * 跳过去道具). Empty/omitted → terminal, no continuation UI.
   */
  nextSteps: z.array(WorkflowNextStepSchema).optional(),
  /**
   * Hint the UI to render this completion as a compact one-line chip
   * (like a tool indicator) instead of the full card. Set true for
   * low-signal terminal states — e.g. role/scene/prop_phase commit
   * that auto-chains to the image phase, so the user sees a small
   * "✓ 已入库 10 个角色" line instead of a duplicate big card next to
   * the image-phase progress card.
   */
  compact: z.boolean().optional(),
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
  "workflow_progress",
  "workflow_suspended",
  "workflow_completed",
  "workflow_failed",
] as const;
export type WorkflowMessageToolName = (typeof WORKFLOW_MESSAGE_TOOL_NAMES)[number];

export function isWorkflowMessageToolName(name: string): name is WorkflowMessageToolName {
  return (WORKFLOW_MESSAGE_TOOL_NAMES as readonly string[]).includes(name);
}
