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
 *                  draft summary + invites user action (Accept / Revise)
 *   - completed  — fires once on terminal success; carries the commit
 *                  result and an optional nextStep hint so the client can
 *                  surface a "Continue · xxx" button
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

// ─── queued ───────────────────────────────────────────────────────────
//
// Emitted while a run is waiting in BullMQ for a worker slot. `position`
// is 0-indexed against the queue *for this workflow*: 0 means "next",
// >0 means "you have N runs ahead of you". Re-emitted under the same
// deterministic message id (`wf_{runId}_queued`) every time the queue
// advances so the card animates from "前面 3 个" → "前面 2 个" without
// chat list churn. Once the worker actually picks up the job we stop
// publishing queued events; the workflow_progress stream takes over.

export const WorkflowQueuedOutputSchema = BaseWorkflowOutput.extend({
  /** 0-indexed position. 0 = next to run; >0 = N runs ahead. */
  position: z.number().int().nonnegative(),
  /**
   * Optional rough wait estimate in ms. Computed from a recent rolling
   * average of completed runs of this workflowName × position. Frontend
   * is free to ignore — the headline UX is `position`, not the time.
   */
  estimatedWaitMs: z.number().int().nonnegative().optional(),
});
export type WorkflowQueuedOutput = z.infer<typeof WorkflowQueuedOutputSchema>;

// ─── progress ─────────────────────────────────────────────────────────

export const WorkflowProgressOutputSchema = BaseWorkflowOutput.extend({
  phase: WorkflowMacroPhase,
  current: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  /** Step-level label, e.g. `Character Designer is elaborating "Mike"…`. */
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
 * Hint to the HITL card about what clicking Accept will *next* trigger +
 * how much it will cost. Optional — terminal phases (like storyboard)
 * omit it and the UI falls back to a generic "Done" label.
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
   * (whether Accept or Reject — generation cost is already incurred).
   * Omitted (or 0) means the phase is free (image phases,
   * batch_create_asset) — UI skips the "(X credits)" suffix.
   */
  estimatedCost: z.number().int().nonnegative().optional(),
  /** What happens if user clicks Accept. Absent on terminal phases. */
  nextAction: WorkflowNextActionSchema.optional(),
  /**
   * parse_script-only hint: how many episodes already exist in the
   * project at the moment of suspension. When >0, the HITL card surfaces
   * an "append vs. replace" toggle so users can clear stale episodes
   * from earlier test runs instead of accumulating them. Other phases
   * leave this absent.
   */
  existingEpisodeCount: z.number().int().nonnegative().optional(),
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
   * action, e.g. "Generate scene images"); everything else renders as
   * secondary (e.g. "Skip — go to props"). First entry is `primary` by
   * default if unspecified.
   */
  variant: z.enum(["primary", "secondary"]).optional(),
  /**
   * Credits this next step will cost. Omit or 0 = free. Rendered inline
   * with the label, e.g. "Generate scene images (15 credits)".
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
  /**
   * Optional "this failed" items for partial_failure cases.
   * `title` (when present) is rendered on the partial-failure completion
   * card so the user can tell which entities need a re-run — e.g.
   * "第 5 集 / 第 12 集" instead of just "2 项失败".
   */
  failed: z
    .array(
      z.object({
        clientRefId: z.string(),
        reason: z.string(),
        title: z.string().optional(),
      })
    )
    .optional(),
  /** Short human-readable summary (matches old workflow output `message`). */
  summary: z.string().optional(),
  /**
   * Preferred over `summary` when set: an i18n key that the frontend resolves
   * against the active locale. Pair with `summaryParams` for `{count}` /
   * `{failed}` placeholder interpolation. Lets the agent emit locale-agnostic
   * payloads instead of pre-translated Chinese strings.
   */
  summaryKey: z.string().optional(),
  summaryParams: z.record(z.string(), z.unknown()).optional(),
  /**
   * Workflow-specific structured result — shape varies by workflowName.
   * Used to render inline summary panels (e.g. story_outline's chapter /
   * cast / settings list). Loose typing because each workflow's shape is
   * different; the client dispatches on workflowName to interpret.
   */
  result: z.record(z.string(), z.unknown()).optional(),
  /**
   * User's next-step options. One → single "Continue · xxx" button. Two+ →
   * options laid out as primary/secondary actions (e.g. after scenes
   * commit: "Generate scene images" vs "Skip — go to props").
   * Empty/omitted → terminal, no continuation UI.
   */
  nextSteps: z.array(WorkflowNextStepSchema).optional(),
  /**
   * Hint the UI to render this completion as a compact one-line chip
   * (like a tool indicator) instead of the full card. Set true for
   * low-signal terminal states — e.g. role/scene/prop_phase commit
   * that auto-chains to the image phase, so the user sees a small
   * "✓ Committed 10 characters" line instead of a duplicate big card next to
   * the image-phase progress card.
   */
  compact: z.boolean().optional(),
  /**
   * When false, suppress the "I want to revise" button. Used for
   * auto-skip terminal states where there's nothing to revise (e.g.
   * prop_phase with zero props in the outline). Defaults to true when
   * omitted to preserve the revise affordance on normal completions.
   */
  revisable: z.boolean().optional(),
});
export type WorkflowCompletedOutput = z.infer<typeof WorkflowCompletedOutputSchema>;

// ─── failed / cancelled ───────────────────────────────────────────────

export const WorkflowFailedOutputSchema = BaseWorkflowOutput.extend({
  terminalStatus: z.enum(["failed", "cancelled"]),
  error: z.string(),
  /** Loose string matching the existing ErrorClassification; UI maps to label. */
  classification: z.string().optional(),
  retryable: z.boolean(),
  /**
   * The inputData this run was originally started with. Used by the
   * Failed card's "重试" button to preserve scoped retries — e.g. a
   * storyboard run started with `onlyEpisodeIds: [ep5]` (because a
   * prior run's "重试失败的剧集" button) should re-fire with the same
   * scope when it itself fails, not silently widen back to all 18
   * episodes via chat-history replay. Optional so older clients that
   * don't carry it through still work.
   */
  inputData: z.record(z.string(), z.unknown()).optional(),
  /**
   * Stable machine-readable error code. Currently only set for
   * structured errors the UI needs to act on differently — e.g.
   * `"MISSING_ARTIFACT"` triggers a "先生成 outline" remediation
   * button instead of a plain Retry. Free-form free-text errors
   * leave this undefined and the UI falls back to Retry / classify.
   */
  errorCode: z.string().optional(),
  /**
   * Populated when `errorCode === "MISSING_ARTIFACT"`. `kind` is the
   * artifact name the failing workflow needed (e.g. `"outline"`);
   * `producedBy` lists the workflow names that, if dispatched, would
   * land that artifact (e.g. `["story_outline", "parse_script"]`).
   * The UI uses producedBy[0] as the default remediation target.
   */
  missingArtifact: z
    .object({
      kind: z.string(),
      producedBy: z.array(z.string()),
    })
    .optional(),
});
export type WorkflowFailedOutput = z.infer<typeof WorkflowFailedOutputSchema>;

// ─── tool-name union (client-side router) ─────────────────────────────

export const WORKFLOW_MESSAGE_TOOL_NAMES = [
  "workflow_queued",
  "workflow_progress",
  "workflow_suspended",
  "workflow_completed",
  "workflow_failed",
] as const;
export type WorkflowMessageToolName = (typeof WORKFLOW_MESSAGE_TOOL_NAMES)[number];

export function isWorkflowMessageToolName(name: string): name is WorkflowMessageToolName {
  return (WORKFLOW_MESSAGE_TOOL_NAMES as readonly string[]).includes(name);
}
