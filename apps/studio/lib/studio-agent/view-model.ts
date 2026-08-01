/**
 * UI-only projections for the Studio Agent surface.
 *
 * The wire contract lives in `transport-contract.ts`; these types model only
 * what the renderer needs once a part has been normalized. Keeping that
 * boundary explicit prevents the surface from becoming a second source of truth
 * for the protocol.
 *
 * Nothing here carries a sequence number any more. Ordering is the transport's:
 * a data part's position inside `UIMessage.parts` is where it belongs, and the
 * persisted prefix is ordered by its own timestamps. A number the browser had
 * to keep in step with the server is exactly the class of bug this refactor
 * removed.
 */

import type { AgentPlatformPermissionMode } from "@repo/shared/agent-platform";

import type { StudioAgentAttachment } from "./transport-contract";

export type StudioAgentRunStatus =
  | "queued"
  | "running"
  | "waiting_for_approval"
  | "waiting_for_input"
  | "cancelling"
  | "succeeded"
  | "failed"
  | "cancelled";

export type StudioAgentActivityStatus = "running" | "succeeded" | "failed" | "cancelled";

export type StudioAgentApprovalStatus = "pending" | "approved" | "denied" | "expired";

export type StudioAgentDeliveryMode = "send" | "steer" | "enqueue" | "stop_and_send";

export type StudioAgentPermissionMode = AgentPlatformPermissionMode;

export type StudioAgentActivityKind =
  | "read"
  | "search"
  | "analyze"
  | "plan"
  | "execute"
  | "generate"
  | "wait"
  | "other";

export interface StudioAgentError {
  code: string;
  /** Stable localization identity for product-boundary failures. */
  messageKey?: string;
  message: string;
  retryable: boolean;
  /** Support correlation id; never contains provider or infrastructure data. */
  diagnosticId?: string;
  details: Record<string, unknown> | null;
}

export interface StudioAgentRunView {
  id: string;
  parentRunId: string | null;
  title: string;
  /** One-line human outcome: the completion summary, cancel reason, or failure text. */
  summary: string | null;
  /**
   * The server's terminal error, kept whole.
   *
   * `summary` flattens a failure to its sentence, which is enough for a log row
   * and not enough for the creator: `code` is what tells "StoryOS sent input the
   * capability rejected" (`studio_agent.invalid_action_input`) apart from "the
   * capability ran and the server could not record it"
   * (`studio_agent.capability_result_invalid`), and `details.issues` carries the
   * paths the server actually rejected. The failure surface renders all three,
   * so this must not be reduced to a string on the way in.
   */
  error: StudioAgentError | null;
  status: StudioAgentRunStatus;
  progress: number | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export type StudioAgentTerminalRunView = StudioAgentRunView & {
  status: "failed" | "cancelled";
};

export type StudioAgentFailedRunView = StudioAgentRunView & { status: "failed" };

export interface StudioAgentMessageView {
  /** Stable render key: one bubble, which may be one run of text inside a message. */
  id: string;
  messageId: string;
  clientMessageId: string | null;
  runId: string | null;
  role: "user" | "assistant";
  /**
   * How this creator message entered the run.
   *
   * A missing wire value is the ordinary `send` path. Keeping the normalized
   * value on the view lets transient UI distinguish a new turn awaiting its
   * first Agent signal from a steer or a queued prompt.
   */
  delivery: StudioAgentDeliveryMode;
  format: "plain_text" | "markdown";
  text: string;
  attachments: StudioAgentAttachment[];
  status: "accepted" | "streaming" | "completed" | "failed" | "cancelled";
  /**
   * The text is still arriving, token by token.
   *
   * Read straight off the transport (`TextUIPart.state === "streaming"`), not
   * inferred. The surface marks it `aria-busy` and adds a quiet inline pulse
   * without dimming the content; both disappear when the part settles to
   * `done`.
   */
  streaming: boolean;
  createdAt: string;
}

export interface StudioAgentActivityView {
  id: string;
  runId: string | null;
  parentActivityId: string | null;
  kind: StudioAgentActivityKind;
  label: string;
  detail: string | null;
  progress: number | null;
  status: StudioAgentActivityStatus;
  startedAt: string;
  completedAt: string | null;
}

/**
 * A tool call the agent suspended on, waiting for the creator to say yes.
 *
 * This is the LIBRARY's approval, not the control plane's: the agent marks a
 * tool `needsApproval`, `streamText` emits a `tool-approval-request`, and the
 * part arrives here in `approval-requested` state carrying `approval.id`. The
 * creator's answer goes back through `useChat.addToolApprovalResponse`, which
 * flips the part to `approval-responded`; the transport turns that into the
 * `tool-approval-response` input the agent's `approvedPendingToolCalls` reads.
 *
 * IT IS THE ONLY APPROVAL SURFACE. There used to be a second one — a Postgres
 * `StudioAgentApproval` row rendered with its own approve/deny buttons and its
 * own `POST .../approvals/:id/resolve` — and it never worked: the workflow
 * resumed the run's status only AFTER executing the approved action, so the
 * executor answered 409 `STUDIO_AGENT_RUN_NOT_EXECUTABLE`. The approval rows
 * still exist as the durable audit trail; the DECISION now travels on the
 * channel, and this is the row that carries it.
 */
export interface StudioAgentToolApprovalView {
  /** `approval.id` — the handle `addToolApprovalResponse` takes. */
  id: string;
  toolCallId: string;
  toolName: string;
  runId: string | null;
  /** The model's arguments, rendered; null when the call takes none. */
  input: string | null;
  /**
   * Null while the creator has not answered.
   *
   * Once answered the row stays put and states the decision rather than
   * vanishing: the agent has not acted on it yet, and a control that erases
   * itself the instant it is clicked leaves the creator unsure it registered.
   */
  decision: "approved" | "denied" | null;
}

export interface StudioAgentChildRunSummary {
  total: number;
  queued: number;
  running: number;
  waitingApproval: number;
  waitingInput: number;
  cancelling: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  terminal: number;
  progress: number;
}

/**
 * One row of the panel.
 *
 * There is no `context_compaction` row any more. Compaction is not a delivery
 * concept — it is a model step the agent runs, and it arrives as exactly that:
 * an `analyze` activity, with its own label, in the position it happened. A
 * separate row type existed only because the retired event journal had a
 * separate event type for it.
 */
export type StudioAgentTimelineItemView =
  | { kind: "message"; id: string; message: StudioAgentMessageView }
  | { kind: "activity"; id: string; activity: StudioAgentActivityView }
  | { kind: "toolApproval"; id: string; toolApproval: StudioAgentToolApprovalView }
  | { kind: "run"; id: string; run: StudioAgentTerminalRunView };
