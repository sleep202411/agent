/**
 * The database seam, and the control plane's read model.
 *
 * Ably is the conversation transcript, but its retention is finite and our
 * threads are not. `GET /threads/:id/snapshot` is the persisted prefix; this
 * module turns it into the `seed` that `useChat({ messages })` and
 * `useMessageSync({ messages })` reconcile against the live channel. The seam
 * key is the domain `message.id` — the only id shared between our store and the
 * channel — so `StudioAgentMessage.messageId` IS the `UIMessage.id` the agent
 * publishes. That equality is a contract, not a coincidence: the agent seeds
 * `toUIMessageStream({ generateMessageId })` with the id the control plane
 * allocated, and the browser sends its prompt under the same id it registers as
 * `clientMessageId`.
 *
 * The snapshot carries more than messages, and deliberately so. Approvals,
 * delegated task runs and applied change sets have NO wire shape — they are
 * written by transactions no `AgentRun` owns, so nothing on the channel can
 * honestly announce them (see `StudioAgentUIDataParts` in `@repo/shared`). The
 * channel says when to look; this is the looking.
 */

import { StoryPatchActionInputSchema, storyPatchWrittenNodeIds } from "@repo/shared";
import type {
  StudioAgentAction,
  StudioAgentActivitySnapshot,
  StudioAgentMessage,
  StudioAgentRun,
  StudioAgentThreadSnapshot,
} from "@repo/shared";

import {
  studioAgentAttachmentPart,
  type StudioAgentAttachment,
  type StudioAgentUIMessage,
} from "./transport-contract";
import type { StudioAgentActivityView, StudioAgentRunView } from "./view-model";

export interface StudioAgentHistorySeed {
  /** Oldest-first, exactly as `useChat({ messages })` wants it. */
  messages: StudioAgentUIMessage[];
  /** Every id in {@link messages}, so the projection can tell seed from live. */
  messageIds: ReadonlySet<string>;
  runs: StudioAgentRunView[];
  activities: StudioAgentActivityView[];
  /**
   * A digest of every capability write this thread has recorded.
   *
   * The canvas reads its story projections through react-query with no channel
   * of its own. An action reaching a terminal status is the moment its write is
   * either in the database or provably not, and that is the only honest trigger
   * to re-read — a token rather than a list, because the canvas needs to know
   * that the value changed, not what it changed to.
   */
  writeToken: string;
  /**
   * Nodes the agent's newest applied write touched, newest write only.
   *
   * The canvas uses this to show the creator WHERE something changed instead of
   * silently re-rendering a graph that moved under them. It is derived from the
   * same actions as {@link StudioAgentHistorySeed.writeToken} — a completed
   * action is a write that is in the database or provably is not — so the two
   * always agree about which write they are describing.
   *
   * Deliberately only the newest: a viewport can point at one place, and a
   * conversation's whole history of edits is not a destination.
   */
  writtenNodeIds: readonly string[];
}

export const EMPTY_STUDIO_AGENT_HISTORY_SEED: StudioAgentHistorySeed = {
  messages: [],
  messageIds: new Set(),
  runs: [],
  activities: [],
  writeToken: "",
  writtenNodeIds: [],
};

export function createStudioAgentHistorySeed(
  snapshot: StudioAgentThreadSnapshot
): StudioAgentHistorySeed {
  const messages = restoreParkedApprovals(
    [...snapshot.messages]
      .sort((left, right) => left.ordinal - right.ordinal)
      .map(toStudioAgentUIMessage),
    snapshot
  );
  return {
    messages,
    messageIds: new Set(messages.map((message) => message.id)),
    runs: snapshot.runs.map(toStudioAgentRunView),
    activities: snapshot.activities.map(toStudioAgentActivityView),
    writeToken: studioAgentWriteToken(snapshot.actions),
    writtenNodeIds: studioAgentWrittenNodeIds(snapshot.actions),
  };
}

/**
 * Put an unanswered approval back on the message that asked for it.
 *
 * A parked approval is the one thing on this panel that a reload could destroy.
 * It renders as a tool part, and a tool part is not persisted — `parts` is
 * `text | attachment | resource`, so the message that comes back from the
 * snapshot has no memory of the question. The live channel still has it, but
 * `useMessagesWithSeed` seams on the newest SEEDED message id and walks backward
 * only for what follows, so the channel's richer copy of a message the seed
 * already contains is never consulted. Without this the creator returns to a
 * turn that is waiting on them and no way to answer it — the agent stays
 * suspended until it expires.
 *
 * Rebuilt from Postgres rather than taught to the channel, because that is
 * already this module's contract: the approval is written by a transaction no
 * `AgentRun` owns, so the control plane is the only honest source. `approval.id`
 * is the DURABLE approval id, which makes the reconstructed part answerable by
 * the same `addToolApprovalResponse` call as the live one — and stable across
 * as many reloads as the creator likes. The answer is addressed by `toolCallId`
 * regardless, so the two paths converge on one write.
 */
function restoreParkedApprovals(
  messages: StudioAgentUIMessage[],
  snapshot: StudioAgentThreadSnapshot
): StudioAgentUIMessage[] {
  const parked = snapshot.approvals.filter((approval) => approval.status === "pending");
  if (parked.length === 0) return messages;

  const actionsById = new Map(snapshot.actions.map((action) => [action.actionId, action]));
  const pending = new Map<string, ReturnType<typeof toolApprovalPart>[]>();
  for (const approval of parked) {
    const action = actionsById.get(approval.actionId);
    // An approval whose action did not come back in this window has no tool call
    // to name, and a part without one cannot be answered. Skipping it is honest;
    // inventing an id would produce a button that fails on click.
    if (!action) continue;
    const parts = pending.get(approval.runId) ?? [];
    parts.push(toolApprovalPart(approval.approvalId, action));
    pending.set(approval.runId, parts);
  }
  if (pending.size === 0) return messages;

  return messages.map((message, index) => {
    const runId = message.metadata?.runId;
    if (message.role !== "assistant" || !runId) return message;
    const parts = pending.get(runId);
    if (!parts) return message;
    // The run's LAST assistant message is the one that made the call, so only it
    // carries the question. Consuming the entry also keeps an earlier message in
    // the same run from picking it up on the next iteration.
    const isLast = !messages.some(
      (other, otherIndex) =>
        otherIndex > index && other.role === "assistant" && other.metadata?.runId === runId
    );
    if (!isLast) return message;
    pending.delete(runId);
    return { ...message, parts: [...message.parts, ...parts] };
  });
}

function toolApprovalPart(approvalId: string, action: StudioAgentAction) {
  return {
    type: `tool-${action.toolName}`,
    toolCallId: action.toolCallId,
    state: "approval-requested",
    input: action.input,
    approval: { id: approvalId },
  } as unknown as StudioAgentUIMessage["parts"][number];
}

/**
 * Prepend an older page.
 *
 * Earlier turns are paged over HTTP, deliberately never through the channel
 * view: `useMessageSync`'s backward walk owns that view's pagination, and a
 * second paginator crossing the seam would reintroduce the duplicate that walk
 * exists to avoid.
 *
 * The write token is the CURRENT page's, untouched. Older turns cannot produce
 * a newer write, and folding them in would change the token for a reason that
 * is not a write and send the canvas to the server for nothing.
 */
export function prependStudioAgentHistorySeed(
  current: StudioAgentHistorySeed,
  older: StudioAgentHistorySeed
): StudioAgentHistorySeed {
  const messageIds = new Set(current.messageIds);
  const messages = [...current.messages];
  for (let index = older.messages.length - 1; index >= 0; index -= 1) {
    const message = older.messages[index]!;
    if (messageIds.has(message.id)) continue;
    messageIds.add(message.id);
    messages.unshift(message);
  }
  return {
    messages,
    messageIds,
    runs: mergeById(older.runs, current.runs, (run) => run.id),
    activities: mergeById(older.activities, current.activities, (a) => a.id),
    writeToken: current.writeToken,
    // Same reasoning as the write token: an older page cannot contain a newer
    // write, and pointing the viewport at one would be a jump backwards.
    writtenNodeIds: current.writtenNodeIds,
  };
}

/**
 * Re-read the newest window without losing the earlier pages already loaded.
 *
 * This is the control plane's half of a turn arriving: the channel moved, so
 * approvals, delegated tasks and applied writes are re-read from Postgres. The
 * refreshed window is authoritative for everything it mentions; anything older
 * than it is carried forward untouched, because a newer read of the tail says
 * nothing about a turn that happened before it.
 */
export function refreshStudioAgentHistorySeed(
  previous: StudioAgentHistorySeed,
  window: StudioAgentHistorySeed
): StudioAgentHistorySeed {
  const olderMessages = previous.messages.filter((message) => !window.messageIds.has(message.id));
  return prependStudioAgentHistorySeed(window, {
    ...previous,
    messages: olderMessages,
    messageIds: new Set(olderMessages.map((message) => message.id)),
  });
}

/**
 * One persisted row as the AI SDK sees it.
 *
 * Attachments ride as `data-studio-agent-attachment` parts rather than the
 * SDK's `file` part: ours carry a registered `attachmentId`, a moderation
 * `status`, and a byte size, none of which `FileUIPart` can hold, and the
 * composer reads the identical shape back when it re-sends a failed prompt.
 */
export function toStudioAgentUIMessage(message: StudioAgentMessage): StudioAgentUIMessage {
  const text = message.parts
    .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n\n");
  const attachments = message.parts.filter(
    (part): part is StudioAgentAttachment => part.type === "attachment"
  );
  const format = message.parts.some((part) => part.type === "text" && part.format === "markdown")
    ? ("markdown" as const)
    : ("plain_text" as const);

  return {
    id: message.messageId,
    role: message.role,
    metadata: {
      threadId: message.threadId,
      ...(message.runId === null ? {} : { runId: message.runId }),
      createdAt: message.createdAt,
      format,
      ...(message.clientMessageId === null ? {} : { clientMessageId: message.clientMessageId }),
    },
    parts: [
      ...(text ? [{ type: "text" as const, text, state: "done" as const }] : []),
      ...attachments.map(studioAgentAttachmentPart),
    ],
  };
}

function toStudioAgentRunView(run: StudioAgentRun): StudioAgentRunView {
  return {
    id: run.runId,
    parentRunId: run.parentRunId,
    title: run.task?.title ?? "",
    summary: run.error?.message ?? null,
    error: run.error,
    status: run.status,
    progress:
      run.status === "succeeded" || run.status === "failed" || run.status === "cancelled"
        ? 1
        : null,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  };
}

function toStudioAgentActivityView(activity: StudioAgentActivitySnapshot): StudioAgentActivityView {
  return {
    id: activity.activityId,
    runId: activity.runId,
    parentActivityId: activity.parentActivityId,
    kind: activity.kind,
    label: activity.label,
    detail: activity.detail,
    progress: activity.progress,
    status: activity.status,
    startedAt: activity.startedAt,
    completedAt: activity.completedAt,
  };
}

/**
 * Every action that has stopped moving, in a stable order.
 *
 * `denied` and `cancelled` are in it on purpose: they change nothing in the
 * story, but they DO end a step the canvas was told to expect, and leaving them
 * out would make the token stall on a turn whose only outcome was a refusal.
 * `failed` is in it because a capability can commit its write and then die
 * before it can report — the case that used to leave the canvas rendering a
 * pre-edit draft until a manual reload.
 */
/**
 * Where the newest applied write landed.
 *
 * Newest by completion, and only a SUCCEEDED one: a failed action may have
 * committed its write and died reporting it, but it cannot be pointed at with
 * any honesty, and a denied one changed nothing at all. Reading the operations
 * out of the action's own recorded input keeps this in step with what the
 * server actually executed rather than with what the model proposed.
 */
function studioAgentWrittenNodeIds(actions: readonly StudioAgentAction[]): readonly string[] {
  const newest = actions
    .filter((action) => action.status === "succeeded" && action.completedAt !== null)
    .sort((left, right) => (left.completedAt! < right.completedAt! ? 1 : -1))[0];
  if (!newest) return [];
  const parsed = StoryPatchActionInputSchema.safeParse(newest.input);
  // A capability whose input is not a story patch simply wrote nowhere the
  // canvas can point at — a media generation, a task delegation.
  if (!parsed.success) return [];
  return storyPatchWrittenNodeIds(parsed.data.operations);
}

function studioAgentWriteToken(actions: readonly StudioAgentAction[]): string {
  return actions
    .filter((action) => action.completedAt !== null)
    .map((action) => `${action.actionId}:${action.status}`)
    .sort()
    .join("|");
}

function mergeById<T>(older: readonly T[], newer: readonly T[], key: (value: T) => string): T[] {
  const merged = new Map<string, T>();
  for (const value of older) merged.set(key(value), value);
  for (const value of newer) merged.set(key(value), value);
  return [...merged.values()];
}
