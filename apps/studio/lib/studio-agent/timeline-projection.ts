/**
 * The panel's read model.
 *
 * The 1 100-line event reducer this replaces existed because the delivery layer
 * handed the browser a numbered journal of thirty-four event types and the
 * browser had to fold it into a conversation. It no longer does: the
 * conversation arrives as `UIMessage[]`, already ordered, already merged,
 * already streaming. What is left is the part no transport can know — turning
 * our domain into the rows the surface renders.
 *
 * ## The panel is message-centric now
 *
 * There is no single sequence-ordered timeline mixing messages, activities and
 * approvals any more, and no sequence number to build one from. Every row
 * belongs to a message, or to the run that message came from:
 *
 *   before:  10:01 you / 10:01 · read bible / 10:02 · generate shots / 10:02 assistant …
 *   after:   you → assistant[ ▸read bible ▸generate shots  "text…"  [Approve] ]
 *
 * A data part's position IS its position — the agent writes an activity part
 * into the assistant message between the two text runs it sits between — so
 * walking `message.parts` in order reproduces what the reducer needed a
 * per-run "pair the Nth generate with the Nth reply" rule to reconstruct.
 *
 * ## Three sources, one rule each
 *
 * - **`messages`** (the channel, via `useChat`) — prose, tokens, tool calls,
 *   activity parts, the rich failure. Ordered by the transport.
 * - **`history`** (Postgres, via `GET .../snapshot`) — approvals, delegated
 *   task runs, and every run's canonical eight-state status. These have no wire
 *   shape by design; see `StudioAgentUIDataParts` in `@repo/shared`.
 * - **`wireRuns`** (`session.view.runs()`) — consulted for exactly one thing
 *   the other two cannot know: whether the WIRE ended a run. An agent that dies
 *   before the control plane records a terminal still publishes `ai-run-end`,
 *   and without that reconciliation the composer stays locked on a turn that is
 *   never coming back. A domain terminal always wins over a wire terminal,
 *   because it is the specific one.
 */

import type { RunInfo } from "@ably/ai-transport/react";
import { getToolName, isToolUIPart } from "ai";

import type { StudioAgentHistorySeed } from "./history-seed";
import {
  isStudioAgentDataPart,
  type StudioAgentAttachment,
  type StudioAgentUIMessage,
  type StudioAgentUIPart,
} from "./transport-contract";
import type {
  StudioAgentActivityView,
  StudioAgentChildRunSummary,
  StudioAgentFailedRunView,
  StudioAgentMessageView,
  StudioAgentRunStatus,
  StudioAgentRunView,
  StudioAgentTerminalRunView,
  StudioAgentTimelineItemView,
  StudioAgentToolApprovalView,
} from "./view-model";

export interface StudioAgentPanelState {
  timeline: StudioAgentTimelineItemView[];
  runs: StudioAgentRunView[];
  /** The newest root run that has not reached a terminal status. */
  activeRun: StudioAgentRunView | null;
  /** The newest root run, and only when it ended `failed`. */
  turnFailure: StudioAgentFailedRunView | null;
  /**
   * Changes whenever the channel says the control plane may have moved.
   *
   * Approvals, delegated tasks and applied writes are Postgres facts with no
   * wire shape, so the browser has to be told when to re-read. This token is
   * that signal, derived only from things the channel actually states: a run's
   * lifecycle, an agent step reaching a terminal status, a tool call resolving.
   * It is a token and not a list because the only question it answers is
   * "changed?".
   */
  revalidationToken: string;
  /** Newest root-run terminal, for the canvas's reconcile backstop. */
  turnTerminalToken: string | null;
}

export interface StudioAgentProjectionInput {
  history: StudioAgentHistorySeed;
  /** `useChat`'s messages: the seed reconciled with the live channel. */
  messages: readonly StudioAgentUIMessage[];
  /** `session.view.runs()`. */
  wireRuns: readonly RunInfo[];
  /**
   * Prompts published into a live turn that the channel has not echoed back yet.
   *
   * `useMessageSync` gates `setMessages` for the duration of an own-run stream,
   * so a steer sent mid-turn would otherwise be invisible until the turn ended.
   * These are the same optimistic echo `useChat` performs for a fresh send, for
   * the one write path `useChat` cannot model.
   */
  pending?: readonly StudioAgentUIMessage[];
}

/** A run row before its run's content is known. */
type DraftTimelineItem =
  | Exclude<StudioAgentTimelineItemView, { kind: "run" }>
  | { kind: "run"; id: string };

export function projectStudioAgentPanel({
  history,
  messages,
  wireRuns,
  pending = [],
}: StudioAgentProjectionInput): StudioAgentPanelState {
  const seen = new Set(messages.map((message) => message.id));
  const composed = [...messages, ...pending.filter((message) => !seen.has(message.id))];

  const runs = new Map<string, StudioAgentRunView>();
  for (const run of history.runs) runs.set(run.id, run);

  const activitiesByRun = groupBy(history.activities, (activity) => activity.runId);

  // Activity ids the CHANNEL already carries as parts on a message. Their
  // position inside `parts` is their real position, so the snapshot must not
  // also emit them ahead of the reply — before this pre-pass existed, moving the
  // snapshot flush ahead of the message rendered each one twice, because the
  // dedupe set was still empty at that point.
  const activityIdsOnMessages = new Set<string>();
  for (const message of composed) {
    for (const part of message.parts) {
      if (isStudioAgentDataPart(part, "studio-agent-activity")) {
        activityIdsOnMessages.add(part.data.activityId);
      }
    }
  }

  const items: DraftTimelineItem[] = [];
  const emittedActivityIds = new Set<string>();
  const flushedRunIds = new Set<string>();
  const activitiesFlushedRunIds = new Set<string>();
  const failureByRun = new Map<string, StudioAgentFailurePartData>();
  const revalidationParts: string[] = [];

  /**
   * A run's work steps, emitted just BEFORE the reply they produced.
   *
   * They used to trail the run's messages, which predates the owner's decision
   * that work steps fold INTO the reply rather than sitting beside it as their
   * own turn. Trailing put "Generating response" under the answer it generated,
   * which reads backwards: the step is what led to the text.
   *
   * Before the first ASSISTANT message specifically, never before the creator's
   * own prompt — the agent had not started working yet when that was written.
   */
  const flushRunActivities = (runId: string | null) => {
    if (runId === null || activitiesFlushedRunIds.has(runId)) return;
    activitiesFlushedRunIds.add(runId);
    for (const activity of activitiesByRun.get(runId) ?? []) {
      if (emittedActivityIds.has(activity.id) || activityIdsOnMessages.has(activity.id)) continue;
      emittedActivityIds.add(activity.id);
      items.push({ kind: "activity", id: activity.id, activity });
    }
  };

  /** The run's own outcome row, which genuinely does belong after its messages. */
  const flushRun = (runId: string | null) => {
    if (runId === null || flushedRunIds.has(runId)) return;
    flushedRunIds.add(runId);
    // A run that produced no assistant message still owes the creator its steps.
    flushRunActivities(runId);
    items.push({ kind: "run", id: runId });
  };

  let openRunId: string | null = null;
  for (const message of composed) {
    const messageRunId = message.metadata?.runId ?? null;
    if (messageRunId !== openRunId) {
      flushRun(openRunId);
      openRunId = messageRunId;
    }
    if (message.role === "assistant") {
      flushRunActivities(messageRunId);
    }
    items.push(
      ...projectMessage(message, {
        emittedActivityIds,
        failureByRun,
        revalidationParts,
      })
    );
  }
  flushRun(openRunId);
  // Runs the conversation never mentioned — a delegated task, or a turn that
  // died before it produced a single message — still owe the creator their
  // outcome.
  for (const run of [...history.runs].sort(byCreatedAt)) flushRun(run.id);

  // A run the WIRE ended that the domain never terminalized. Without this the
  // composer stays locked on a turn whose agent process is gone.
  for (const info of wireRuns) {
    const wireStatus = wireRunStatus(info);
    const known = runs.get(info.runId);
    if (known && isTerminalStatus(known.status)) continue;
    if (!wireStatus) {
      if (!known) {
        runs.set(info.runId, syntheticRun(info.runId, "running"));
      }
      continue;
    }
    runs.set(info.runId, {
      ...(known ?? syntheticRun(info.runId, wireStatus)),
      summary: known?.summary ?? info.error?.message ?? null,
      error:
        known?.error ??
        (info.status === "error"
          ? {
              code: `ably.${info.error.code}`,
              message: info.error.message,
              retryable: false,
              details: null,
            }
          : null),
      status: wireStatus,
      // A parked run has not finished, so it does not get a finished run's
      // progress — that is what would let the composer unlock on a turn the
      // creator still owes an answer to.
      progress: isTerminalStatus(wireStatus) ? 1 : null,
    });
  }

  // The rich failure the agent published beats the coarse one, always: it is
  // the only carrier of `StudioAgentError.code` and `details.issues`, which is
  // what the failure surface renders and what tells a retryable rejection apart
  // from a write that must never be retried.
  for (const [runId, failure] of failureByRun) {
    const run = runs.get(runId) ?? syntheticRun(runId, "failed");
    runs.set(runId, {
      ...run,
      status: run.status === "cancelled" ? run.status : "failed",
      error: failure.error,
      summary: failure.error.message,
      progress: 1,
      completedAt: run.completedAt ?? failure.failedAt,
    });
  }

  const runViews = [...runs.values()];
  const runViewsById = new Map(runViews.map((run) => [run.id, run]));

  // Suppression: a failed model step already renders the turn's outcome
  // legibly, so a second row would be noise. A failed ACTION (`execute`) shows
  // only as a collapsed detail, so its turn still needs one.
  const loudlyFailedRunIds = new Set(
    items.flatMap((item) =>
      item.kind === "activity" &&
      item.activity.kind !== "execute" &&
      (item.activity.status === "failed" || item.activity.status === "cancelled") &&
      item.activity.runId !== null
        ? [item.activity.runId]
        : []
    )
  );

  /**
   * Runs whose reply has actually arrived.
   *
   * The `generate` step is the REPLY'S OWN PLACEHOLDER — the agent publishes it
   * around the model call, so while it is running it is the honest "something is
   * happening" signal. Once the text is on screen the placeholder has been
   * answered by the thing it stood for, and leaving it behind as
   * "Generating response ✓" is a tombstone for work the reader can already see.
   * Content arrives, the placeholder goes.
   *
   * Only `generate`, and only when it SUCCEEDED. A failed generate is the only
   * explanation the creator gets for a turn with no text, and every other kind
   * (read, execute, plan…) still says something after the fact.
   */
  const runsWithReply = new Set<string>();
  for (const message of composed) {
    if (message.role !== "assistant") continue;
    const runId = message.metadata?.runId;
    if (!runId) continue;
    const hasText = message.parts.some(
      (part) => part.type === "text" && part.text.trim().length > 0
    );
    if (hasText) runsWithReply.add(runId);
  }

  const timeline = items.flatMap((item): StudioAgentTimelineItemView[] => {
    if (
      item.kind === "activity" &&
      item.activity.kind === "generate" &&
      item.activity.status === "succeeded" &&
      item.activity.runId !== null &&
      runsWithReply.has(item.activity.runId)
    ) {
      return [];
    }
    if (item.kind !== "run") return [item];
    const run = runViewsById.get(item.id);
    if (!run || run.parentRunId !== null || loudlyFailedRunIds.has(run.id)) return [];
    if (run.status !== "failed" && run.status !== "cancelled") return [];
    return [{ kind: "run", id: item.id, run: run as StudioAgentTerminalRunView }];
  });

  const rootRuns = runViews.filter((run) => run.parentRunId === null).sort(byCreatedAtDescending);
  const activeRun = rootRuns.find((run) => !isTerminalStatus(run.status)) ?? null;
  const latestRoot = rootRuns[0] ?? null;
  const terminalRoot = rootRuns.find((run) => isTerminalStatus(run.status)) ?? null;

  return {
    timeline,
    runs: runViews,
    activeRun,
    turnFailure: latestRoot?.status === "failed" ? (latestRoot as StudioAgentFailedRunView) : null,
    revalidationToken: [
      wireRuns
        .map((info) => `${info.runId}:${info.status}`)
        .sort()
        .join("|"),
      revalidationParts.sort().join("|"),
    ].join("#"),
    turnTerminalToken: terminalRoot ? `${terminalRoot.id}:${terminalRoot.status}` : null,
  };
}

export function selectStudioAgentChildRuns(
  state: StudioAgentPanelState,
  parentRunId: string
): StudioAgentRunView[] {
  return state.runs.filter((run) => run.parentRunId === parentRunId).sort(byCreatedAt);
}

export function summarizeStudioAgentChildRuns(
  runs: readonly StudioAgentRunView[]
): StudioAgentChildRunSummary {
  const summary: StudioAgentChildRunSummary = {
    total: runs.length,
    queued: 0,
    running: 0,
    waitingApproval: 0,
    waitingInput: 0,
    cancelling: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
    terminal: 0,
    progress: 0,
  };

  let progressTotal = 0;
  for (const run of runs) {
    if (run.status === "queued") summary.queued += 1;
    else if (run.status === "running") summary.running += 1;
    else if (run.status === "waiting_for_approval") summary.waitingApproval += 1;
    else if (run.status === "waiting_for_input") summary.waitingInput += 1;
    else if (run.status === "cancelling") summary.cancelling += 1;
    else if (run.status === "succeeded") summary.succeeded += 1;
    else if (run.status === "failed") summary.failed += 1;
    else summary.cancelled += 1;

    if (isTerminalStatus(run.status)) summary.terminal += 1;
    progressTotal += run.progress ?? (isTerminalStatus(run.status) ? 1 : 0);
  }

  summary.progress = runs.length === 0 ? 0 : progressTotal / runs.length;
  return summary;
}

interface StudioAgentFailurePartData {
  error: NonNullable<StudioAgentRunView["error"]>;
  failedAt: string;
}

interface MessageProjectionSink {
  emittedActivityIds: Set<string>;
  failureByRun: Map<string, StudioAgentFailurePartData>;
  revalidationParts: string[];
}

/**
 * One message's rows, in part order.
 *
 * Consecutive `text` parts merge into one bubble; anything else closes the
 * bubble and takes its own row, which is what puts an activity between the two
 * halves of a reply instead of after both.
 */
function projectMessage(
  message: StudioAgentUIMessage,
  sink: MessageProjectionSink
): DraftTimelineItem[] {
  const rows: DraftTimelineItem[] = [];
  const attachments: StudioAgentAttachment[] = [];
  let bubble: { text: string; index: number; streaming: boolean } | null = null;

  const flushBubble = () => {
    if (!bubble) return;
    const current = bubble;
    bubble = null;
    rows.push(messageItem(message, current.index, current.text, current.streaming, []));
  };

  message.parts.forEach((part, index) => {
    if (part.type === "text") {
      bubble = {
        text: bubble ? `${bubble.text}${part.text}` : part.text,
        index: bubble?.index ?? index,
        streaming: part.state === "streaming",
      };
      return;
    }
    if (isStudioAgentDataPart(part, "studio-agent-attachment")) {
      attachments.push(part.data);
      return;
    }
    flushBubble();
    if (isStudioAgentDataPart(part, "studio-agent-activity")) {
      const activity = part.data;
      sink.emittedActivityIds.add(activity.activityId);
      sink.revalidationParts.push(`${activity.activityId}:${activity.status}`);
      rows.push({
        kind: "activity",
        id: activity.activityId,
        activity: {
          id: activity.activityId,
          runId: message.metadata?.runId ?? null,
          parentActivityId: null,
          kind: activity.kind,
          label: activity.label,
          detail: activity.detail,
          progress: activity.progress,
          status: activity.status,
          startedAt: activity.startedAt,
          completedAt: activity.completedAt,
        },
      });
      return;
    }
    if (isStudioAgentDataPart(part, "studio-agent-failure")) {
      sink.failureByRun.set(part.data.runId, {
        error: part.data.error,
        failedAt: part.data.failedAt,
      });
      return;
    }
    if (isToolUIPart(part)) {
      // A call the agent suspended on. It is not a step that is running — it is
      // a question, and it renders as one until the creator answers it.
      if (part.state === "approval-requested" || part.state === "approval-responded") {
        const row = toolApprovalItem(message, part);
        sink.revalidationParts.push(`${row.id}:${row.toolApproval.decision ?? "pending"}`);
        rows.push(row);
        return;
      }
      const row = toolItem(message, index, part);
      sink.revalidationParts.push(`${row.activity.id}:${row.activity.status}`);
      rows.push(row);
    }
  });
  flushBubble();

  // Attachments hang off the message's first bubble — the creator's prompt is
  // one bubble, and an assistant turn never carries them.
  const firstBubbleIndex = rows.findIndex((row) => row.kind === "message");
  if (attachments.length === 0) return rows;
  if (firstBubbleIndex >= 0) {
    const row = rows[firstBubbleIndex] as Extract<DraftTimelineItem, { kind: "message" }>;
    rows[firstBubbleIndex] = { ...row, message: { ...row.message, attachments } };
    return rows;
  }
  return [messageItem(message, 0, "", false, attachments), ...rows];
}

function messageItem(
  message: StudioAgentUIMessage,
  index: number,
  text: string,
  streaming: boolean,
  attachments: StudioAgentAttachment[]
): Extract<DraftTimelineItem, { kind: "message" }> {
  const id = `${message.id}:${index}`;
  const view: StudioAgentMessageView = {
    id,
    messageId: message.id,
    clientMessageId: message.metadata?.clientMessageId ?? null,
    runId: message.metadata?.runId ?? null,
    role: message.role === "user" ? "user" : "assistant",
    format: message.metadata?.format ?? (message.role === "user" ? "plain_text" : "markdown"),
    text,
    attachments,
    status: streaming ? "streaming" : "completed",
    streaming,
    createdAt: message.metadata?.createdAt ?? "",
  };
  return { kind: "message", id, message: view };
}

/**
 * A tool call rendered as a step.
 *
 * This is the library's own primitive doing the job our `action.proposed` /
 * `action.started` / `action.completed` trio used to: `streamText` emits the
 * tool part, the agent publishes the result back onto the same part, and the
 * states map onto the row's four statuses.
 */
/**
 * A suspended tool call, as a row the creator can answer.
 *
 * Keyed on `approval.id` rather than the part index: the part is rewritten in
 * place when the decision lands (`approval-requested` → `approval-responded`),
 * and a key that moved would remount the row and lose its scroll anchor.
 */
function toolApprovalItem(
  message: StudioAgentUIMessage,
  part: Extract<StudioAgentUIPart, { state: "approval-requested" | "approval-responded" }>
): Extract<DraftTimelineItem, { kind: "toolApproval" }> {
  const toolApproval: StudioAgentToolApprovalView = {
    id: part.approval.id,
    toolCallId: part.toolCallId,
    toolName: getToolName(part),
    runId: message.metadata?.runId ?? null,
    input: stringifyToolDetail(part.input),
    decision:
      part.state === "approval-responded" ? (part.approval.approved ? "approved" : "denied") : null,
  };
  return { kind: "toolApproval", id: part.approval.id, toolApproval };
}

function toolItem(
  message: StudioAgentUIMessage,
  index: number,
  part: Extract<StudioAgentUIPart, { toolCallId: string }>
): Extract<DraftTimelineItem, { kind: "activity" }> {
  const status: StudioAgentActivityView["status"] =
    part.state === "output-available"
      ? "succeeded"
      : part.state === "output-error"
        ? "failed"
        : // A call the creator refused. It never ran, so it did not fail — it
          // was stopped, which is the same shape as a cancelled step.
          part.state === "output-denied"
          ? "cancelled"
          : "running";
  const activity: StudioAgentActivityView = {
    id: `${message.id}:tool:${index}`,
    runId: message.metadata?.runId ?? null,
    parentActivityId: null,
    kind: "execute",
    label: getToolName(part),
    detail:
      part.state === "output-error"
        ? part.errorText
        : stringifyToolDetail(part.state === "output-available" ? part.output : part.input),
    progress: null,
    status,
    startedAt: message.metadata?.createdAt ?? "",
    completedAt: null,
  };
  return { kind: "activity", id: activity.id, activity };
}

function stringifyToolDetail(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value.trim() || null;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return null;
  }
}

function syntheticRun(runId: string, status: StudioAgentRunStatus): StudioAgentRunView {
  return {
    id: runId,
    parentRunId: null,
    title: "",
    summary: null,
    error: null,
    status,
    progress: null,
    createdAt: "",
    startedAt: null,
    completedAt: null,
  };
}

/**
 * What the channel says a run's status is, in our vocabulary.
 *
 * `suspended` is here and is deliberately NOT terminal: the agent has parked and
 * the next move is the creator's. Leaving it out is what made a waiting run read
 * as `running` — the caller's fallback for an unrecognised wire status is a
 * synthetic `running` run — so every subscriber showed 'working' through a
 * silence that was actually a question. `null` means the wire is telling us
 * nothing our domain does not already know better.
 */
function wireRunStatus(info: RunInfo): StudioAgentRunStatus | null {
  switch (info.status) {
    case "complete":
      return "succeeded";
    case "cancelled":
      return "cancelled";
    case "error":
      return "failed";
    case "suspended":
      return "waiting_for_approval";
    default:
      return null;
  }
}

function isTerminalStatus(status: StudioAgentRunStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function byCreatedAt(
  left: { createdAt: string; id: string },
  right: { createdAt: string; id: string }
): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function byCreatedAtDescending(
  left: { createdAt: string; id: string },
  right: { createdAt: string; id: string }
): number {
  return right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id);
}

function groupBy<T>(values: readonly T[], key: (value: T) => string | null): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const value of values) {
    const group = key(value);
    if (group === null) continue;
    const bucket = grouped.get(group);
    if (bucket) bucket.push(value);
    else grouped.set(group, [value]);
  }
  return grouped;
}
