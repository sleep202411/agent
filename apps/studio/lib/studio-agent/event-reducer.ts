import type {
  StudioAgentAction,
  StudioAgentActivitySnapshot,
  StudioAgentApproval,
  StudioAgentEvent,
  StudioAgentInput,
  StudioAgentMessage,
  StudioAgentRun,
  StudioAgentSubmitMessageResult,
  StudioAgentThreadSnapshot,
} from "@repo/shared";

import type {
  StudioAgentActivityView,
  StudioAgentApprovalView,
  StudioAgentChildRunSummary,
  StudioAgentEventState,
  StudioAgentMessageView,
  StudioAgentRunStatus,
  StudioAgentTerminalRunView,
  StudioAgentRunView,
  StudioAgentTimelineItemView,
} from "./view-model";

type RunProjectionEvent = Extract<
  StudioAgentEvent,
  {
    type:
      | "run.created"
      | "run.started"
      | "run.phase_changed"
      | "run.waiting"
      | "run.resumed"
      | "run.cancellation_requested"
      | "run.completed"
      | "run.failed"
      | "run.cancelled"
      | "task.created"
      | "task.started"
      | "task.completed"
      | "task.failed"
      | "task.cancelled";
  }
>;

export function createStudioAgentEventState(
  threadId: string,
  baseSequence = 0
): StudioAgentEventState {
  return {
    threadId,
    baseSequence,
    cursor: null,
    journal: [],
    eventIds: {},
    sequenceEventIds: {},
    runs: {},
    messages: {},
    activities: {},
    actions: {},
    approvals: {},
    contextCompactions: {},
    inputs: {},
    issues: [],
  };
}

export function createStudioAgentEventStateFromSnapshot(
  snapshot: StudioAgentThreadSnapshot
): StudioAgentEventState {
  return hydrateStudioAgentEventState(
    createStudioAgentEventState(snapshot.thread.threadId, snapshot.latestEventSequence),
    {
      messages: snapshot.messages,
      runs: snapshot.runs,
      actions: snapshot.actions,
      approvals: snapshot.approvals,
      inputs: snapshot.inputs,
      activities: snapshot.activities,
    }
  );
}

/**
 * Merge an earlier turn window into live state.
 *
 * `baseSequence`, the cursor and the journal describe the *live* tail and must
 * not move: an earlier page only carries facts the reducer already treats as
 * settled history, so it widens the record maps and nothing else. The timeline
 * orders by occurrence timestamp, so a prepended turn sorts ahead of the live
 * tail without needing a sequence space of its own.
 */
export function hydrateStudioAgentEarlierTurns(
  state: StudioAgentEventState,
  page: StudioAgentThreadSnapshot
): StudioAgentEventState {
  if (page.thread.threadId !== state.threadId) {
    throw new Error("Studio Agent history page does not belong to this conversation.");
  }
  return hydrateStudioAgentEventState(state, {
    messages: page.messages,
    runs: page.runs,
    actions: page.actions,
    approvals: page.approvals,
    inputs: page.inputs,
    activities: page.activities,
  });
}

export function hydrateStudioAgentSubmitResult(
  state: StudioAgentEventState,
  result: StudioAgentSubmitMessageResult
): StudioAgentEventState {
  return hydrateStudioAgentEventState(state, {
    messages: [result.message],
    runs: result.run ? [result.run] : [],
    inputs: result.input ? [result.input] : [],
  });
}

export function hydrateStudioAgentEventState(
  state: StudioAgentEventState,
  records: {
    messages?: readonly StudioAgentMessage[];
    runs?: readonly StudioAgentRun[];
    actions?: readonly StudioAgentAction[];
    approvals?: readonly StudioAgentApproval[];
    inputs?: readonly StudioAgentInput[];
    activities?: readonly StudioAgentActivitySnapshot[];
  }
): StudioAgentEventState {
  const messages = { ...state.messages };
  const runs = { ...state.runs };
  const activities = { ...state.activities };
  const actions = { ...state.actions };
  const approvals = { ...state.approvals };
  const inputs = { ...state.inputs };
  const orderedRecords = [
    ...(records.messages ?? []).map((record) => ({
      kind: "message" as const,
      occurredAt: record.createdAt,
      id: record.messageId,
      record,
    })),
    ...(records.runs ?? []).map((record) => ({
      kind: "run" as const,
      occurredAt: record.createdAt,
      id: record.runId,
      record,
    })),
    ...(records.actions ?? []).map((record) => ({
      kind: "action" as const,
      occurredAt: record.createdAt,
      id: record.actionId,
      record,
    })),
    ...(records.approvals ?? []).map((record) => ({
      kind: "approval" as const,
      occurredAt: record.requestedAt,
      id: record.approvalId,
      record,
    })),
    ...(records.inputs ?? []).map((record) => ({
      kind: "input" as const,
      occurredAt: record.acceptedAt,
      id: record.inputId,
      record,
    })),
  ].sort(
    (left, right) =>
      left.occurredAt.localeCompare(right.occurredAt) ||
      left.kind.localeCompare(right.kind) ||
      left.id.localeCompare(right.id)
  );

  const firstProjectionSequence = -orderedRecords.length;
  orderedRecords.forEach((entry, index) => {
    const projectionSequence = firstProjectionSequence + index;
    if (entry.kind === "message") {
      messages[entry.record.messageId] = messageProjection(
        entry.record,
        messages[entry.record.messageId]?.sequence ?? projectionSequence
      );
    } else if (entry.kind === "run") {
      const existingRun = runs[entry.record.runId];
      const nextRun = runProjection(entry.record, existingRun?.sequence ?? projectionSequence);
      // A REST hydrate (e.g. the cancel POST result, which returns
      // `cancelling`) must never regress a run the live SSE stream already
      // drove to a terminal state: the journal has already deduped that
      // terminal event, so it will never re-apply, and `selectActiveRootRun`
      // would report the run as running forever — sticking the composer.
      runs[entry.record.runId] =
        existingRun && isTerminalRun(existingRun.status) && !isTerminalRun(nextRun.status)
          ? existingRun
          : nextRun;
    } else if (entry.kind === "action") {
      applyAction(actions, entry.record);
      applyPersistedActionActivity(activities, entry.record, projectionSequence);
    } else if (entry.kind === "approval") {
      applyApprovalEvent(approvals, actions, entry.record, projectionSequence);
    } else {
      inputs[entry.record.inputId] = entry.record;
    }
  });

  for (const activity of records.activities ?? []) {
    activities[activity.activityId] = {
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
      sequence: activity.firstEventSequence,
      lastSequence: activity.lastEventSequence,
    };
  }

  return { ...state, messages, runs, activities, actions, approvals, inputs };
}

export function appendStudioAgentEvents(
  state: StudioAgentEventState,
  incoming: readonly StudioAgentEvent[]
): StudioAgentEventState {
  if (incoming.length === 0) return state;

  const eventIds = { ...state.eventIds };
  const sequenceEventIds = { ...state.sequenceEventIds };
  const journal = [...state.journal];
  const issues = [...state.issues];
  let changed = false;

  for (const event of incoming) {
    if (event.threadId !== state.threadId) {
      issues.push({
        code: "THREAD_MISMATCH",
        eventId: event.eventId,
        sequence: event.sequence,
      });
      changed = true;
      continue;
    }

    if (!Number.isSafeInteger(event.sequence) || event.sequence <= 0) {
      issues.push({
        code: "INVALID_SEQUENCE",
        eventId: event.eventId,
        sequence: event.sequence,
      });
      changed = true;
      continue;
    }

    // A snapshot already contains these facts. Receiving them again during a
    // reconnect is expected and must be an idempotent no-op.
    if (event.sequence <= state.baseSequence || eventIds[event.eventId]) continue;

    const existingAtSequence = sequenceEventIds[event.sequence];
    if (existingAtSequence && existingAtSequence !== event.eventId) {
      issues.push({
        code: "SEQUENCE_COLLISION",
        eventId: event.eventId,
        sequence: event.sequence,
      });
      changed = true;
      continue;
    }

    eventIds[event.eventId] = true;
    sequenceEventIds[event.sequence] = event.eventId;
    journal.push(event);
    changed = true;
  }

  if (!changed) return state;

  journal.sort(compareEvents);
  const cursor = findContiguousCursor(state.baseSequence, journal, sequenceEventIds, state.cursor);
  // Delta and lifecycle events are order-sensitive. Never render beyond a
  // gap, even when a newer event reached this tab first.
  const previouslyProjectedThrough = state.cursor?.sequence ?? state.baseSequence;
  const newlyContiguousEvents = cursor
    ? journal.filter(
        (event) => event.sequence > previouslyProjectedThrough && event.sequence <= cursor.sequence
      )
    : [];
  const projection = projectJournal(newlyContiguousEvents, state);

  return {
    ...state,
    cursor,
    journal,
    eventIds,
    sequenceEventIds,
    issues,
    ...projection,
  };
}

function compareEvents(left: StudioAgentEvent, right: StudioAgentEvent): number {
  return left.sequence - right.sequence || left.eventId.localeCompare(right.eventId);
}

function findContiguousCursor(
  baseSequence: number,
  journal: readonly StudioAgentEvent[],
  sequenceEventIds: Readonly<Record<number, string>>,
  previous: StudioAgentEventState["cursor"]
): StudioAgentEventState["cursor"] {
  let sequence = Math.max(baseSequence, previous?.sequence ?? baseSequence);
  while (sequenceEventIds[sequence + 1]) sequence += 1;
  if (sequence === baseSequence) return previous?.sequence === sequence ? previous : null;

  const eventId = sequenceEventIds[sequence];
  const event = journal.find((candidate) => candidate.eventId === eventId);
  if (!event) return previous;
  return { eventId: event.eventId, sequence: event.sequence, value: String(event.sequence) };
}

function projectJournal(
  journal: readonly StudioAgentEvent[],
  seed?: Pick<
    StudioAgentEventState,
    "runs" | "messages" | "activities" | "actions" | "approvals" | "contextCompactions" | "inputs"
  >
): Pick<
  StudioAgentEventState,
  "runs" | "messages" | "activities" | "actions" | "approvals" | "contextCompactions" | "inputs"
> {
  const runs: StudioAgentEventState["runs"] = { ...seed?.runs };
  const messages: StudioAgentEventState["messages"] = { ...seed?.messages };
  const activities: StudioAgentEventState["activities"] = { ...seed?.activities };
  const actions: StudioAgentEventState["actions"] = { ...seed?.actions };
  const approvals: StudioAgentEventState["approvals"] = { ...seed?.approvals };
  const contextCompactions: StudioAgentEventState["contextCompactions"] = {
    ...seed?.contextCompactions,
  };
  const inputs: StudioAgentEventState["inputs"] = { ...seed?.inputs };

  for (const event of journal) {
    switch (event.type) {
      case "run.created":
      case "run.started":
      case "run.phase_changed":
      case "run.waiting":
      case "run.resumed":
      case "run.cancellation_requested":
      case "run.completed":
      case "run.failed":
      case "run.cancelled":
      case "task.created":
      case "task.started":
      case "task.completed":
      case "task.failed":
      case "task.cancelled":
        applyRunEvent(runs, event);
        break;
      case "assistant.segment.started":
      case "assistant.segment.delta":
      case "assistant.segment.completed":
        applyAssistantSegmentEvent(messages, event);
        break;
      case "activity.started":
      case "activity.progress":
      case "activity.completed":
      case "activity.failed":
      case "activity.cancelled":
        applyActivityEvent(activities, event);
        break;
      case "action.proposed":
        applyAction(actions, event.payload.action);
        break;
      case "action.started":
        applyActionStartedActivity(activities, actions, event);
        break;
      case "action.completed":
        applyActionCompletedActivity(activities, actions, event);
        break;
      case "approval.requested":
      case "approval.resolved":
        applyApprovalEvent(approvals, actions, event.payload.approval, event.sequence);
        break;
      case "input.accepted":
        inputs[event.payload.input.inputId] = event.payload.input;
        break;
      case "input.consumed": {
        const input = inputs[event.payload.inputId];
        if (input) {
          inputs[event.payload.inputId] = {
            ...input,
            status: "consumed",
            consumedAt: event.payload.consumedAt,
          };
        }
        break;
      }
      case "input.promoted": {
        const input = inputs[event.payload.inputId];
        if (input) {
          inputs[event.payload.inputId] = {
            ...input,
            status: "promoted",
            promotedToRunId: event.payload.promotedToRunId,
          };
        }
        break;
      }
      case "input.cancelled": {
        const input = inputs[event.payload.inputId];
        if (input) {
          inputs[event.payload.inputId] = {
            ...input,
            status: "cancelled",
          };
        }
        break;
      }
      case "context.compacted":
        contextCompactions[event.payload.checkpointId] = {
          id: event.payload.checkpointId,
          runId: event.runId,
          coveredMessageCount: event.payload.coveredMessageCount,
          retainedMessageCount: event.payload.retainedMessageCount,
          occurredAt: event.payload.compactedAt,
          sequence: event.sequence,
        };
        break;
      // These events are consumed by dedicated input/change-set surfaces. They
      // still remain in the ordered journal, but intentionally do not mutate
      // the core timeline projection maintained by this reducer.
      case "changeset.proposed":
      case "changeset.applied":
      case "changeset.rejected":
        break;
      default:
        assertNever(event);
    }
  }

  return {
    runs,
    messages,
    activities,
    actions,
    approvals,
    contextCompactions,
    inputs,
  };
}

function applyRunEvent(runs: Record<string, StudioAgentRunView>, event: RunProjectionEvent): void {
  const existing = runs[event.runId];

  switch (event.type) {
    case "run.created":
      runs[event.runId] = runProjection(event.payload.run, event.sequence);
      return;
    case "task.created":
      runs[event.runId] = runProjection(event.payload.taskRun, event.sequence);
      return;
    case "run.started":
      runs[event.runId] = updateRun(existing, event, {
        status: "running",
        startedAt: event.payload.startedAt,
      });
      return;
    case "run.waiting":
      runs[event.runId] = updateRun(existing, event, {
        status: event.payload.reason === "approval" ? "waiting_for_approval" : "waiting_for_input",
      });
      return;
    case "run.resumed":
      runs[event.runId] = updateRun(existing, event, {
        status: "running",
        startedAt: existing?.startedAt ?? event.payload.resumedAt,
      });
      return;
    case "run.cancellation_requested":
      runs[event.runId] = updateRun(existing, event, {
        status: "cancelling",
      });
      return;
    case "run.completed":
      runs[event.runId] = updateRun(existing, event, {
        status: "succeeded",
        summary: event.payload.summary,
        progress: 1,
        completedAt: event.payload.completedAt,
      });
      return;
    case "run.failed":
      runs[event.runId] = updateRun(existing, event, {
        status: "failed",
        summary: event.payload.error.message,
        completedAt: event.payload.failedAt,
      });
      return;
    case "run.cancelled":
      runs[event.runId] = updateRun(existing, event, {
        status: "cancelled",
        summary: event.payload.reason,
        completedAt: event.payload.cancelledAt,
      });
      return;
    case "task.started":
      runs[event.runId] = updateRun(existing, event, {
        title: event.payload.task.title,
        status: "running",
        startedAt: event.payload.startedAt,
      });
      return;
    case "task.completed":
      runs[event.runId] = updateRun(existing, event, {
        title: event.payload.task.title,
        status: "succeeded",
        summary: event.payload.summary,
        progress: 1,
        completedAt: event.payload.completedAt,
      });
      return;
    case "task.failed":
      runs[event.runId] = updateRun(existing, event, {
        title: event.payload.task.title,
        status: "failed",
        summary: event.payload.error.message,
        completedAt: event.payload.failedAt,
      });
      return;
    case "task.cancelled":
      runs[event.runId] = updateRun(existing, event, {
        title: event.payload.task.title,
        status: "cancelled",
        summary: event.payload.reason,
        completedAt: event.payload.cancelledAt,
      });
      return;
    case "run.phase_changed":
      if (existing) runs[event.runId] = { ...existing, sequence: event.sequence };
      return;
    default:
      assertNever(event);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Studio Agent event: ${JSON.stringify(value)}`);
}

function runProjection(run: StudioAgentRun, sequence: number): StudioAgentRunView {
  return {
    id: run.runId,
    parentRunId: run.parentRunId,
    title: run.task?.title ?? "",
    summary: run.error?.message ?? null,
    status: run.status,
    progress: isTerminalRun(run.status) ? 1 : null,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    sequence,
  };
}

function updateRun(
  existing: StudioAgentRunView | undefined,
  event: StudioAgentEvent,
  patch: Partial<StudioAgentRunView>
): StudioAgentRunView {
  return {
    id: event.runId,
    parentRunId: event.parentRunId ?? existing?.parentRunId ?? null,
    title: existing?.title ?? "",
    summary: existing?.summary ?? null,
    status: existing?.status ?? "queued",
    progress: existing?.progress ?? null,
    createdAt: existing?.createdAt ?? event.occurredAt,
    startedAt: existing?.startedAt ?? null,
    completedAt: existing?.completedAt ?? null,
    sequence: event.sequence,
    ...patch,
  };
}

function messageProjection(message: StudioAgentMessage, sequence: number): StudioAgentMessageView {
  const textParts = message.parts.filter(
    (part): part is Extract<StudioAgentMessage["parts"][number], { type: "text" }> =>
      part.type === "text"
  );
  const attachments = message.parts.filter(
    (part): part is Extract<StudioAgentMessage["parts"][number], { type: "attachment" }> =>
      part.type === "attachment"
  );
  return {
    id: message.messageId,
    messageId: message.messageId,
    clientMessageId: message.clientMessageId,
    runId: message.runId,
    role: message.role,
    format: textParts.some((part) => part.format === "markdown") ? "markdown" : "plain_text",
    text: textParts.map((part) => part.text).join("\n\n"),
    attachments,
    status: message.status,
    createdAt: message.createdAt,
    sequence,
  };
}

function applyAssistantSegmentEvent(
  messages: Record<string, StudioAgentMessageView>,
  event: StudioAgentEvent
): void {
  if (
    event.type !== "assistant.segment.started" &&
    event.type !== "assistant.segment.delta" &&
    event.type !== "assistant.segment.completed"
  ) {
    return;
  }

  // The canonical snapshot is keyed by messageId. Streaming must update that
  // same projection; keying live state by segmentId would render a persisted
  // assistant message twice after snapshot + replay.
  const id = event.payload.messageId;
  const existing = messages[id];
  if (event.type === "assistant.segment.started") {
    messages[id] = {
      id,
      messageId: event.payload.messageId,
      clientMessageId: null,
      runId: event.runId,
      role: "assistant",
      format: event.payload.format,
      text: existing?.text ?? "",
      attachments: existing?.attachments ?? [],
      status: "streaming",
      createdAt: existing?.createdAt ?? event.occurredAt,
      sequence: existing?.sequence ?? event.sequence,
    };
  } else if (event.type === "assistant.segment.delta") {
    messages[id] = {
      id,
      messageId: event.payload.messageId,
      clientMessageId: null,
      runId: event.runId,
      role: "assistant",
      format: existing?.format ?? "plain_text",
      text: `${existing?.text ?? ""}${event.payload.delta}`,
      attachments: existing?.attachments ?? [],
      status: "streaming",
      createdAt: existing?.createdAt ?? event.occurredAt,
      sequence: existing?.sequence ?? event.sequence,
    };
  } else {
    messages[id] = {
      id,
      messageId: event.payload.messageId,
      clientMessageId: null,
      runId: event.runId,
      role: "assistant",
      format: existing?.format ?? "plain_text",
      text: event.payload.content,
      attachments: existing?.attachments ?? [],
      status:
        // "length" truncation still produced valid content — it completes the
        // message (matching the server projection) rather than failing it.
        event.payload.finishReason === "stop" || event.payload.finishReason === "length"
          ? "completed"
          : event.payload.finishReason === "cancelled"
            ? "cancelled"
            : "failed",
      createdAt: existing?.createdAt ?? event.occurredAt,
      sequence: existing?.sequence ?? event.sequence,
    };
  }
}

function applyActivityEvent(
  activities: Record<string, StudioAgentActivityView>,
  event: StudioAgentEvent
): void {
  if (
    event.type !== "activity.started" &&
    event.type !== "activity.progress" &&
    event.type !== "activity.completed" &&
    event.type !== "activity.failed" &&
    event.type !== "activity.cancelled"
  ) {
    return;
  }

  const id = event.payload.activityId;
  const existing = activities[id];
  if (event.type === "activity.started") {
    activities[id] = {
      id,
      runId: event.runId,
      parentActivityId: event.payload.parentActivityId,
      kind: event.payload.kind,
      label: event.payload.label,
      detail: null,
      progress: null,
      status: "running",
      startedAt: event.payload.startedAt,
      completedAt: null,
      sequence: event.sequence,
      lastSequence: event.sequence,
    };
  } else if (event.type === "activity.progress") {
    if (!existing) return;
    activities[id] = {
      ...existing,
      detail: event.payload.detail ?? existing.detail,
      progress: event.payload.progress,
      lastSequence: event.sequence,
    };
  } else if (event.type === "activity.completed") {
    if (!existing) return;
    activities[id] = {
      ...existing,
      detail: event.payload.summary ?? existing.detail,
      status: "succeeded",
      completedAt: event.payload.completedAt,
      lastSequence: event.sequence,
    };
  } else if (event.type === "activity.failed") {
    if (!existing) return;
    activities[id] = {
      ...existing,
      detail: event.payload.error.message,
      status: "failed",
      completedAt: event.payload.failedAt,
      lastSequence: event.sequence,
    };
  } else {
    if (!existing) return;
    activities[id] = {
      ...existing,
      status: "cancelled",
      completedAt: event.payload.cancelledAt,
      lastSequence: event.sequence,
    };
  }
}

function applyPersistedActionActivity(
  activities: Record<string, StudioAgentActivityView>,
  action: StudioAgentAction,
  sequence: number
): void {
  if (action.startedAt === null) return;

  const id = actionActivityId(action.actionId);
  const status =
    action.status === "succeeded"
      ? "succeeded"
      : action.status === "failed"
        ? "failed"
        : action.status === "cancelled"
          ? "cancelled"
          : "running";

  activities[id] = {
    id,
    runId: action.runId,
    parentActivityId: null,
    kind: "execute",
    label: action.title,
    detail: action.status === "failed" ? (action.error?.message ?? action.summary) : action.summary,
    progress: action.status === "succeeded" ? 1 : null,
    status,
    startedAt: action.startedAt,
    completedAt: action.completedAt,
    sequence: activities[id]?.sequence ?? sequence,
    lastSequence: sequence,
  };
}

function applyActionStartedActivity(
  activities: Record<string, StudioAgentActivityView>,
  actions: StudioAgentEventState["actions"],
  event: Extract<StudioAgentEvent, { type: "action.started" }>
): void {
  const action = actions[event.payload.actionId];
  if (!action) return;
  const id = actionActivityId(action.id);
  activities[id] = {
    id,
    runId: event.runId,
    parentActivityId: null,
    kind: "execute",
    label: action.title,
    detail: action.summary,
    progress: null,
    status: "running",
    startedAt: event.payload.startedAt,
    completedAt: null,
    sequence: activities[id]?.sequence ?? event.sequence,
    lastSequence: event.sequence,
  };
}

function applyActionCompletedActivity(
  activities: Record<string, StudioAgentActivityView>,
  actions: StudioAgentEventState["actions"],
  event: Extract<StudioAgentEvent, { type: "action.completed" }>
): void {
  const action = actions[event.payload.execution.actionId];
  const id = actionActivityId(event.payload.execution.actionId);
  const existing = activities[id];
  if (!action || !existing) return;

  activities[id] = {
    ...existing,
    detail:
      event.payload.execution.status === "failed"
        ? (event.payload.execution.error?.message ?? action.summary)
        : action.summary,
    status:
      event.payload.execution.status === "succeeded" ? "succeeded" : event.payload.execution.status,
    progress: event.payload.execution.status === "succeeded" ? 1 : existing.progress,
    completedAt: event.payload.execution.completedAt,
    lastSequence: event.sequence,
  };
}

function actionActivityId(actionId: string): string {
  return `action:${actionId}`;
}

function applyAction(actions: StudioAgentEventState["actions"], action: StudioAgentAction): void {
  actions[action.actionId] = {
    id: action.actionId,
    capability: action.capability.id,
    capabilityVersion: action.capability.version,
    title: action.title,
    summary: action.summary,
    risk: action.risk,
  };
}

function applyApprovalEvent(
  approvals: Record<string, StudioAgentApprovalView>,
  actions: StudioAgentEventState["actions"],
  approval: StudioAgentApproval,
  sequence: number
): void {
  const action = actions[approval.actionId];
  approvals[approval.approvalId] = {
    id: approval.approvalId,
    runId: approval.runId,
    actionInputHash: approval.actionInputHash,
    capability: action?.capability ?? approval.actionId,
    capabilityVersion: action?.capabilityVersion ?? null,
    title: action?.title ?? approval.reason,
    description: approval.reason || action?.summary || null,
    risk: action?.risk ?? "low",
    status: approval.status,
    resolution: approval.decision?.note ?? null,
    createdAt: approval.requestedAt,
    resolvedAt: approval.decision?.decidedAt ?? null,
    sequence: approvals[approval.approvalId]?.sequence ?? sequence,
  };
}

function isTerminalRun(status: StudioAgentRunStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

export function selectStudioAgentTimeline(
  state: StudioAgentEventState
): StudioAgentTimelineItemView[] {
  const visibleActivities = Object.values(state.activities);
  // Only a failed/cancelled *model step* (generate / analyze — the assistant's
  // own work) renders the run's terminal state clearly enough to make a
  // run-outcome row redundant. A failed *action* activity ("execute" — a tool
  // call or a delegation whose child run died) shows up only as a collapsed
  // detail, so the root turn must still surface its own outcome; otherwise a
  // failed request reads as a silent success.
  const terminalActivityRunIds = new Set(
    visibleActivities
      .filter(
        (activity) =>
          activity.kind !== "execute" &&
          (activity.status === "failed" || activity.status === "cancelled") &&
          activity.runId
      )
      .map((activity) => activity.runId)
  );
  const fallbackTerminalRuns = Object.values(state.runs).filter(
    (run): run is StudioAgentTerminalRunView =>
      run.parentRunId === null &&
      (run.status === "failed" || run.status === "cancelled") &&
      !terminalActivityRunIds.has(run.id)
  );

  // Anchor each assistant reply to the "generate" step that produced it. A
  // generate activity's startedAt is identical on the live stream and a
  // snapshot replay, whereas the message's own createdAt is not (live stamps it
  // from segment.started; replay reads the immutable row inserted a few ms
  // earlier during allocation) — and the row is inserted *before* its generate
  // starts, so a timestamp rule can't pair them. A run can also run several
  // model steps (reply → tool execution → reply → …); the Nth generate produces
  // the Nth reply, so pair by step index. This keeps a multi-step run ordered
  // generate→reply→execute→generate→reply, identically live and after a refresh.
  const messageAnchor = new Map<string, string>();
  {
    const generateStartsByRun = new Map<string, string[]>();
    for (const activity of visibleActivities) {
      if (activity.kind === "generate" && activity.runId) {
        const starts = generateStartsByRun.get(activity.runId);
        if (starts) starts.push(activity.startedAt);
        else generateStartsByRun.set(activity.runId, [activity.startedAt]);
      }
    }
    for (const starts of generateStartsByRun.values()) starts.sort();
    const repliesByRun = new Map<string, StudioAgentMessageView[]>();
    for (const message of Object.values(state.messages)) {
      if (message.role !== "assistant" || !message.runId) continue;
      const replies = repliesByRun.get(message.runId);
      if (replies) replies.push(message);
      else repliesByRun.set(message.runId, [message]);
    }
    for (const [runId, replies] of repliesByRun) {
      const starts = generateStartsByRun.get(runId);
      if (!starts) continue;
      replies.sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.sequence - right.sequence
      );
      replies.forEach((reply, index) => {
        const anchor = starts[index];
        if (anchor) messageAnchor.set(reply.id, anchor);
      });
    }
  }

  return [
    ...Object.values(state.messages).map(
      (message): StudioAgentTimelineItemView => ({
        kind: "message",
        id: message.id,
        sequence: message.sequence,
        message,
      })
    ),
    ...visibleActivities.map(
      (activity): StudioAgentTimelineItemView => ({
        kind: "activity",
        id: activity.id,
        sequence: activity.sequence,
        activity,
      })
    ),
    ...Object.values(state.approvals).map(
      (approval): StudioAgentTimelineItemView => ({
        kind: "approval",
        id: approval.id,
        sequence: approval.sequence,
        approval,
      })
    ),
    ...fallbackTerminalRuns.map(
      (run): StudioAgentTimelineItemView => ({
        kind: "run",
        id: run.id,
        sequence: run.sequence,
        run,
      })
    ),
    ...Object.values(state.contextCompactions).map(
      (compaction): StudioAgentTimelineItemView => ({
        kind: "context_compaction",
        id: compaction.id,
        sequence: compaction.sequence,
        compaction,
      })
    ),
  ].sort((left, right) => {
    const byTime = timelineOccurredAt(left, messageAnchor).localeCompare(
      timelineOccurredAt(right, messageAnchor)
    );
    if (byTime !== 0) return byTime;
    // At an exact timestamp tie — most importantly a generating activity and
    // the assistant message it anchors — order by structural role. This is
    // deterministic regardless of the (live vs replay) sequence space, so the
    // activity always renders ahead of its reply on both.
    const byKind = timelineKindRank(left.kind) - timelineKindRank(right.kind);
    if (byKind !== 0) return byKind;
    return left.sequence - right.sequence || left.id.localeCompare(right.id);
  });
}

function timelineKindRank(kind: StudioAgentTimelineItemView["kind"]): number {
  switch (kind) {
    case "activity":
      return 0;
    case "approval":
      return 1;
    case "message":
      return 2;
    case "run":
      return 3;
    default:
      return 4;
  }
}

export function selectStudioAgentChildRuns(
  state: StudioAgentEventState,
  parentRunId: string
): StudioAgentRunView[] {
  return Object.values(state.runs)
    .filter((run) => run.parentRunId === parentRunId)
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.sequence - right.sequence ||
        left.id.localeCompare(right.id)
    );
}

function timelineOccurredAt(
  item: StudioAgentTimelineItemView,
  messageAnchor: Map<string, string>
): string {
  if (item.kind === "message") {
    return messageAnchor.get(item.message.id) ?? item.message.createdAt;
  }
  if (item.kind === "activity") return item.activity.startedAt;
  if (item.kind === "approval") return item.approval.createdAt;
  if (item.kind === "run") return item.run.completedAt ?? item.run.startedAt ?? item.run.createdAt;
  return item.compaction.occurredAt;
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

    if (isTerminalRun(run.status)) summary.terminal += 1;
    progressTotal += run.progress ?? (isTerminalRun(run.status) ? 1 : 0);
  }

  summary.progress = runs.length === 0 ? 0 : progressTotal / runs.length;
  return summary;
}
