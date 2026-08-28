"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentOsAblyResyncPointer, AgentOsAblyRunSnapshot } from "@repo/shared";
import { AgentOsAblyLive } from "@/lib/agent-os/ably-live";
import {
  AgentOsRealtimeConversationReconciler,
  AgentOsRealtimeResyncPuller,
  advanceAgentOsContiguousSequence,
  agentOsCatchUpTargetFromEventGap,
  agentOsCatchUpTargetFromPointer,
  agentOsCatchUpTargetFromSnapshot,
} from "@/lib/agent-os/realtime-resync";
import {
  agentOsApi,
  type AgentOsEvent,
  type AgentOsPendingApproval,
  type AgentOsPendingExternal,
  type AgentOsPendingUserInput,
  type AgentOsRunStatus,
  type AgentOsWorkbenchContext,
} from "@/lib/agent-os/api-client";
import {
  deriveActiveTurnId,
  deriveAgentActivity,
  derivePendingExternalFromEvents,
  derivePendingApprovalFromEvents,
  derivePendingUserInputFromEvents,
  deriveStatusFromEvents,
  rebuildRunTimelineFromEvents,
  workbenchContextFromEvents,
  type AgentOsChatMessage,
  type AgentOsSessionStatus,
} from "./agent-os-timeline";

export {
  deriveAgentActivity,
  derivePendingExternalFromEvents,
  derivePendingApprovalFromEvents,
  derivePendingUserInputFromEvents,
  deriveStatusFromEvents,
  rebuildRunTimelineFromEvents,
};
export type {
  AgentOsActivity,
  AgentOsActivityPhase,
  AgentOsArtifactReference,
  AgentOsArtifactStatus,
  AgentOsAssistantSegment,
  AgentOsChatMessage,
  AgentOsSessionStatus,
  AgentOsTranscriptArtifact,
} from "./agent-os-timeline";

export interface AgentOsSessionState {
  status: AgentOsSessionStatus;
  runId: string | null;
  conversationId: string | null;
  /** Full chat transcript (Codex-style continuous thread). */
  messages: AgentOsChatMessage[];
  events: AgentOsEvent[];
  pendingApproval: AgentOsPendingApproval | null;
  pendingUserInput: AgentOsPendingUserInput | null;
  pendingExternal: AgentOsPendingExternal | null;
  error: string | null;
  /** Machine code for the failure, so the UI can translate it. */
  errorCode: string | null;
}

const initial: AgentOsSessionState = {
  status: "idle",
  runId: null,
  conversationId: null,
  messages: [],
  events: [],
  pendingApproval: null,
  pendingUserInput: null,
  pendingExternal: null,
  error: null,
  errorCode: null,
};

const POLL_STOP_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "waiting_for_approval",
  "waiting_for_input",
]);

/**
 * A successful journal snapshot is authoritative regardless of which server
 * projection returned it. PostgreSQL is the normal durable source for healthy
 * long-running and recovering runs; only its status may stop polling.
 */
export function agentOsPollSnapshotDisposition(input: {
  status: string;
  source?: string;
}): "continue" | "stop" {
  return POLL_STOP_STATUSES.has(input.status) ? "stop" : "continue";
}

function newId(): string {
  return crypto.randomUUID();
}

/**
 * Prefer terminal status over a later "running" inferred from MessageDelta
 * (Ably statusFromEventType defaults many types to running).
 *
 * `allowResumeFromWaiting`: true for poll/snapshot/ApprovalResolved so HITL
 * can leave waiting_for_approval; false for noisy Ably stream events.
 */
function mergeRunStatus(
  previous: string | undefined,
  incoming: string,
  opts?: { allowResumeFromWaiting?: boolean }
): string {
  const prev = previous ?? "running";
  const terminal = new Set(["completed", "failed", "cancelled"]);
  if (terminal.has(prev) && !terminal.has(incoming)) return prev;
  if (incoming === "waiting_for_approval") return incoming;
  if (incoming === "waiting_for_input") return incoming;
  if (incoming === "waiting_for_external") return incoming;
  if (terminal.has(incoming)) return incoming;
  if (prev === "waiting_for_approval" && incoming === "running" && !opts?.allowResumeFromWaiting) {
    return prev;
  }
  if (prev === "waiting_for_input" && incoming === "running" && !opts?.allowResumeFromWaiting) {
    return prev;
  }
  if (prev === "waiting_for_external" && incoming === "running" && !opts?.allowResumeFromWaiting) {
    return prev;
  }
  return incoming || prev;
}

export function isAgentOsActionableRunStatus(status: string): boolean {
  return (
    status === "waiting_for_approval" ||
    status === "waiting_for_input" ||
    status === "waiting_for_external" ||
    status === "running" ||
    status === "queued" ||
    status === "paused"
  );
}

// ─── Per-run event buffer (conversation-scoped) ───────────────────────────

export function agentOsPollFailureCode(input: {
  status: string | undefined;
  consecutiveFailures: number;
  maxConsecutiveFailures: number;
  now: number;
  ordinaryDeadlineAt: number;
}): "AGENT_OS_POLL_TIMEOUT" | "AGENT_OS_POLL_LOST" | null {
  // A durable host job has its own lifecycle and may legitimately outlive a
  // browser session. Only terminal journal events may close it.
  if (input.status === "waiting_for_external") return null;
  if (input.now >= input.ordinaryDeadlineAt) return "AGENT_OS_POLL_TIMEOUT";
  if (input.consecutiveFailures >= input.maxConsecutiveFailures) return "AGENT_OS_POLL_LOST";
  return null;
}

type OptimisticUser = {
  id: string;
  turnId: string;
  content: string;
  createdAt: string;
  attachmentNames?: string[];
};

export type StartSubmissionIdentity = {
  fingerprint: string;
  conversationId: string;
  clientSubmissionId: string;
  turnId: string;
  messageId: string;
  createdAt: string;
};

type StartSubmissionFingerprintInput = {
  conversationId: string;
  message: string;
  modelProfileId: string;
  attachmentIds: readonly string[];
  permissionMode?: "ask" | "smart" | "full";
  workbenchMode: "storyboard" | "canvas" | "brief" | "story";
  workbenchContext?: AgentOsWorkbenchContext;
  skillIds?: readonly string[];
  projectSkillInstallationIds?: readonly string[];
  disabledDefaultSkillInstallationIds?: readonly string[];
};

export type UserInputSubmissionIdentity = {
  fingerprint: string;
  responseId: string;
  messageId: string;
  turnId: string;
};

export type ApprovalSubmissionIdentity = {
  decision: "approve" | "reject";
  responseText: string;
  locale: "en-US" | "zh-CN" | "zh-HK";
  responseId: string;
  messageId: string;
  turnId: string;
};

type RunBuffer = {
  runId: string;
  /** Stable order of runs within the conversation (first-seen order). */
  order: number;
  /** Durable creation key used only to insert runs first discovered after a gap. */
  createdAt: string | null;
  status: string;
  eventsBySeq: Map<number, AgentOsEvent>;
  pendingApproval: AgentOsPendingApproval | null;
  pendingUserInput: AgentOsPendingUserInput | null;
  pendingExternal: AgentOsPendingExternal | null;
  assistantText: string | null;
  error: { code?: string; message?: string } | null;
  /** The target captured by RunStarted; never replaced by the current UI selection. */
  workbenchContext: AgentOsWorkbenchContext | null;
  /** Client-only user row until UserMessage lands in the journal. */
  optimisticUser: OptimisticUser | null;
  /** Client-only HITL decisions not yet in journal (no eventSequence). */
  optimisticDecisions: AgentOsChatMessage[];
  /** Client-only structured-input answers until the durable UserMessage arrives. */
  optimisticInputResponses: AgentOsChatMessage[];
};

function emptyRunBuffer(runId: string, order: number): RunBuffer {
  return {
    runId,
    order,
    createdAt: null,
    status: "running",
    eventsBySeq: new Map(),
    pendingApproval: null,
    pendingUserInput: null,
    pendingExternal: null,
    assistantText: null,
    error: null,
    workbenchContext: null,
    optimisticUser: null,
    optimisticDecisions: [],
    optimisticInputResponses: [],
  };
}

export type AgentOsConversationRunOrderEntry = {
  runId: string;
  order: number;
  createdAt: string | null;
};

type AgentOsDurableRunOrderEntry = {
  runId: string;
  createdAt: string;
};

function runCreatedAtMillis(createdAt: string | null): number | null {
  if (!createdAt) return null;
  const value = Date.parse(createdAt);
  return Number.isFinite(value) ? value : null;
}

/**
 * Merges a bounded durable history tail without reordering older local runs.
 *
 * The conversation endpoint intentionally returns only its newest runs. A
 * continuity repair must therefore treat omitted local buffers as older
 * durable history, not append them after the returned tail. Existing runs
 * keep their relative order; only genuinely unknown runs are inserted by the
 * server-owned `(createdAt, runId)` key.
 */
export function reconcileAgentOsConversationRunOrder(
  existing: readonly AgentOsConversationRunOrderEntry[],
  durableTail: readonly AgentOsDurableRunOrderEntry[]
): AgentOsConversationRunOrderEntry[] {
  const durableById = new Map(durableTail.map((run) => [run.runId, run.createdAt]));
  const ordered = [...existing]
    .sort((left, right) => left.order - right.order)
    .map((run) => ({
      ...run,
      createdAt: durableById.get(run.runId) ?? run.createdAt,
    }));
  const knownIds = new Set(ordered.map((run) => run.runId));
  const unknown = durableTail
    .filter((run) => !knownIds.has(run.runId))
    .sort((left, right) => {
      const leftAt = runCreatedAtMillis(left.createdAt);
      const rightAt = runCreatedAtMillis(right.createdAt);
      if (leftAt !== null && rightAt !== null && leftAt !== rightAt) return leftAt - rightAt;
      if (leftAt !== null && rightAt === null) return -1;
      if (leftAt === null && rightAt !== null) return 1;
      return left.runId.localeCompare(right.runId);
    });

  for (const run of unknown) {
    const createdAt = runCreatedAtMillis(run.createdAt);
    const insertAt =
      createdAt === null
        ? -1
        : ordered.findIndex((candidate) => {
            const candidateAt = runCreatedAtMillis(candidate.createdAt);
            if (candidateAt === null) return false;
            if (candidateAt !== createdAt) return candidateAt > createdAt;
            return candidate.runId.localeCompare(run.runId) > 0;
          });
    const entry = { runId: run.runId, order: 0, createdAt: run.createdAt };
    if (insertAt === -1) ordered.push(entry);
    else ordered.splice(insertAt, 0, entry);
  }

  return ordered.map((run, order) => ({ ...run, order }));
}

function userInputResponseText(
  request: AgentOsPendingUserInput,
  answers: Readonly<Record<string, string>>
): string {
  return request.questions
    .map((question) => {
      const value = answers[question.id];
      const option = question.options.find((candidate) => candidate.value === value);
      return `${question.header}: ${option?.label ?? value ?? ""}`;
    })
    .filter((line) => !line.endsWith(": "))
    .join("\n");
}

function eventMatchesOptimisticUser(event: AgentOsEvent, optimistic: OptimisticUser): boolean {
  if (event.type !== "UserMessage") return false;
  return event.data.messageId === optimistic.id && event.data.turnId === optimistic.turnId;
}

function userInputFingerprint(answers: Readonly<Record<string, string>>): string {
  return JSON.stringify(
    Object.entries(answers).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  );
}

export function userInputSubmissionIdentity(
  store: Map<string, UserInputSubmissionIdentity>,
  requestId: string,
  answers: Readonly<Record<string, string>>,
  createId: () => string = newId
): UserInputSubmissionIdentity {
  const fingerprint = userInputFingerprint(answers);
  const existing = store.get(requestId);
  if (existing?.fingerprint === fingerprint) return existing;
  const created = {
    fingerprint,
    responseId: createId(),
    messageId: createId(),
    turnId: createId(),
  };
  store.set(requestId, created);
  return created;
}

export function approvalSubmissionIdentity(
  store: Map<string, ApprovalSubmissionIdentity>,
  approvalId: string,
  decision: "approve" | "reject",
  responseText: string,
  locale: "en-US" | "zh-CN" | "zh-HK",
  createId: () => string = newId
): ApprovalSubmissionIdentity {
  const existing = store.get(approvalId);
  if (
    existing?.decision === decision &&
    existing.responseText === responseText &&
    existing.locale === locale
  ) {
    return existing;
  }
  const created = {
    decision,
    responseText,
    locale,
    responseId: createId(),
    messageId: createId(),
    turnId: createId(),
  };
  store.set(approvalId, created);
  return created;
}

/**
 * Conversation-level rebuild: every run in first-seen order, full event logs.
 * This is the ONLY path that produces `messages` for the UI (live + hydrate).
 */
export function rebuildConversationMessages(buffers: Iterable<RunBuffer>): {
  messages: AgentOsChatMessage[];
  runId: string | null;
  status: AgentOsSessionState["status"];
  pendingApproval: AgentOsPendingApproval | null;
  pendingUserInput: AgentOsPendingUserInput | null;
  pendingExternal: AgentOsPendingExternal | null;
  events: AgentOsEvent[];
  error: string | null;
  errorCode: string | null;
} {
  const ordered = [...buffers].sort((a, b) => a.order - b.order);
  const messages: AgentOsChatMessage[] = [];

  for (const buf of ordered) {
    const messageStart = messages.length;
    const events = [...buf.eventsBySeq.values()].sort((a, b) => a.sequence - b.sequence);
    buf.workbenchContext = workbenchContextFromEvents(events) ?? buf.workbenchContext;
    const optimisticReject = buf.optimisticDecisions.some((d) => d.meta?.decision === "reject");
    const optimisticApprove = buf.optimisticDecisions.some((d) => d.meta?.decision === "approve");
    const optimisticUserInput = buf.optimisticInputResponses.length > 0;
    // Event-derived status / HITL override stale buffer "running".
    // Client-side decision already made: do not resurrect HITL from a journal
    // that still only has ApprovalRequired (API lag).
    const derivedPending =
      optimisticReject || optimisticApprove
        ? null
        : (buf.pendingApproval ?? derivePendingApprovalFromEvents(events));
    const derivedUserInput = optimisticUserInput
      ? null
      : (buf.pendingUserInput ?? derivePendingUserInputFromEvents(events));
    let status = deriveStatusFromEvents(events, buf.status);
    if ((optimisticReject || optimisticApprove) && status === "waiting_for_approval") {
      // Either decision answers the approval and resumes the same run. A
      // rejected tool action is not a cancelled Agent conversation.
      status = "running";
    } else if (derivedPending && (status === "running" || status === "idle")) {
      status = "waiting_for_approval";
    } else if (derivedUserInput && (status === "running" || status === "idle")) {
      status = "waiting_for_input";
    } else if (optimisticUserInput && status === "waiting_for_input") {
      status = "running";
    }
    if (!derivedPending && status === "waiting_for_approval") {
      // Open approval was cleared by later events; fall back to event terminal.
      status = deriveStatusFromEvents(events, "running");
      if (status === "waiting_for_approval") status = "running";
    }
    if (!derivedUserInput && status === "waiting_for_input") {
      status = deriveStatusFromEvents(events, "running");
      if (status === "waiting_for_input") status = "running";
    }
    // Keep buffer in sync so subsequent publishes stay consistent.
    if (derivedPending) {
      buf.pendingApproval = derivedPending;
    } else if (status !== "waiting_for_approval") {
      buf.pendingApproval = null;
    }
    if (derivedUserInput) {
      buf.pendingUserInput = derivedUserInput;
    } else if (status !== "waiting_for_input") {
      buf.pendingUserInput = null;
    }
    const derivedExternal = buf.pendingExternal ?? derivePendingExternalFromEvents(events);
    buf.pendingExternal = status === "waiting_for_external" ? derivedExternal : null;
    buf.status = status;

    let rebuilt = rebuildRunTimelineFromEvents(events, buf.runId, status);

    const hasUser = rebuilt.some(
      (m) =>
        m.role === "user" &&
        m.meta?.kind !== "approval_response" &&
        m.meta?.kind !== "user_input_response"
    );
    if (!hasUser && buf.optimisticUser) {
      const u = buf.optimisticUser;
      rebuilt = [
        {
          id: u.id,
          role: "user",
          content: u.content,
          createdAt: u.createdAt,
          turnId: u.turnId,
          runId: buf.runId,
          meta: u.attachmentNames?.length
            ? { attachmentNames: u.attachmentNames, optimistic: true }
            : { optimistic: true },
        },
        ...rebuilt,
      ];
    }

    // Compatibility for snapshots whose event page is still catching up. New
    // journals reconstruct immutable messageId segments from events, but an
    // Ably snapshot can legitimately arrive before that segment's deltas.
    const snapshotText = buf.assistantText?.trim() ?? "";
    const snapshotTurnId =
      deriveActiveTurnId(events, buf.runId) ?? rebuilt.at(-1)?.turnId ?? `legacy:${buf.runId}:0`;
    const lastAssistant = [...rebuilt]
      .reverse()
      .find((message) => message.role === "assistant" && message.turnId === snapshotTurnId);
    const liveStartedSegment = lastAssistant?.segments?.at(-1);
    const snapshotAdvancesSegment =
      snapshotText &&
      liveStartedSegment &&
      !liveStartedSegment.completed &&
      snapshotText.startsWith(liveStartedSegment.content) &&
      snapshotText.length > liveStartedSegment.content.length;
    if (snapshotAdvancesSegment && lastAssistant && liveStartedSegment) {
      liveStartedSegment.content = snapshotText;
      // A waiting_for_external transition is itself a durable handoff
      // boundary: the receipt segment is settled even though the run is not.
      liveStartedSegment.completed = status !== "running";
      lastAssistant.content = (lastAssistant.segments ?? [])
        .map((segment) => segment.content.trim())
        .filter(Boolean)
        .join("\n\n");
      lastAssistant.meta = {
        ...lastAssistant.meta,
        kind: status === "running" ? "streaming" : "message_completed",
        fromSnapshot: true,
      };
    }

    // Interleave client-only HITL replies until their durable UserMessage lands.
    const journalApprovalIds = new Set(
      rebuilt
        .filter((m) => m.meta?.kind === "approval_response" && m.meta?.eventSequence != null)
        .map((m) => String(m.meta?.approvalId ?? ""))
    );
    const decisions = buf.optimisticDecisions.filter(
      (message) => !journalApprovalIds.has(String(message.meta?.approvalId ?? ""))
    );
    const journalInputRequestIds = new Set(
      rebuilt
        .filter((m) => m.meta?.kind === "user_input_response" && m.meta?.eventSequence != null)
        .map((m) => String(m.meta?.requestId ?? ""))
    );
    const inputResponses = buf.optimisticInputResponses.filter(
      (message) => !journalInputRequestIds.has(String(message.meta?.requestId ?? ""))
    );

    const withDecisions: AgentOsChatMessage[] = [];
    let di = 0;
    const sortedDec = [...decisions, ...inputResponses].sort(
      (a, b) => Number(a.meta?.afterSequence ?? 0) - Number(b.meta?.afterSequence ?? 0)
    );
    for (const msg of rebuilt) {
      const seq = Number(msg.meta?.eventSequence ?? 0);
      while (di < sortedDec.length && Number(sortedDec[di]!.meta?.afterSequence ?? 0) < seq) {
        withDecisions.push(sortedDec[di]!);
        di += 1;
      }
      withDecisions.push(msg);
    }
    while (di < sortedDec.length) {
      withDecisions.push(sortedDec[di]!);
      di += 1;
    }

    messages.push(...withDecisions);

    if (buf.workbenchContext) {
      for (let index = messageStart; index < messages.length; index += 1) {
        messages[index] = {
          ...messages[index]!,
          workbenchContext: buf.workbenchContext,
        };
      }
    }
  }

  // Keep the newest run that still owns live/actionable state. If every run
  // is terminal, the latest run is authoritative. Never combine one run's
  // id/pending state with another run's event page.
  let selected = ordered.at(-1) ?? null;
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    const b = ordered[i]!;
    const s = b.status;
    if (isAgentOsActionableRunStatus(s)) {
      selected = b;
      break;
    }
  }

  const selectedEvents = selected
    ? [...selected.eventsBySeq.values()].sort((a, b) => a.sequence - b.sequence)
    : [];
  const sessionStatus: AgentOsSessionState["status"] = selected
    ? deriveStatusFromEvents([], selected.status)
    : "idle";

  return {
    messages,
    runId: selected?.runId ?? null,
    status: sessionStatus,
    pendingApproval:
      sessionStatus === "waiting_for_approval"
        ? (selected?.pendingApproval ?? derivePendingApprovalFromEvents(selectedEvents))
        : null,
    pendingUserInput:
      sessionStatus === "waiting_for_input"
        ? (selected?.pendingUserInput ?? derivePendingUserInputFromEvents(selectedEvents))
        : null,
    pendingExternal:
      sessionStatus === "waiting_for_external"
        ? (selected?.pendingExternal ?? derivePendingExternalFromEvents(selectedEvents))
        : null,
    events: selectedEvents,
    error: sessionStatus === "failed" ? (selected?.error?.message ?? null) : null,
    errorCode: sessionStatus === "failed" ? (selected?.error?.code ?? null) : null,
  };
}

/** Flatten durable journal runs into conversation buffers then rebuild. */
export function messagesFromConversationHistory(
  runs: Array<{
    runId: string;
    status: string;
    events: AgentOsEvent[];
    createdAt?: string;
    pendingApproval?: AgentOsPendingApproval | null;
    pendingUserInput?: AgentOsPendingUserInput | null;
    pendingExternal?: AgentOsPendingExternal | null;
    assistantText?: string | null;
  }>
): {
  messages: AgentOsChatMessage[];
  runId: string | null;
  status: AgentOsSessionState["status"];
  pendingApproval: AgentOsPendingApproval | null;
  pendingUserInput: AgentOsPendingUserInput | null;
  pendingExternal: AgentOsPendingExternal | null;
  events: AgentOsEvent[];
} {
  const buffers: RunBuffer[] = runs.map((run, index) => {
    const buf = emptyRunBuffer(run.runId, index);
    buf.createdAt = run.createdAt ?? run.events.at(0)?.timestamp ?? null;
    buf.status = run.status;
    buf.pendingApproval = (run.pendingApproval as AgentOsPendingApproval | null) ?? null;
    buf.pendingUserInput = (run.pendingUserInput as AgentOsPendingUserInput | null) ?? null;
    buf.pendingExternal = (run.pendingExternal as AgentOsPendingExternal | null) ?? null;
    buf.assistantText = run.assistantText ?? null;
    for (const event of run.events) {
      buf.eventsBySeq.set(event.sequence, event);
    }
    return buf;
  });
  const rebuilt = rebuildConversationMessages(buffers);
  return {
    messages: rebuilt.messages,
    runId: rebuilt.runId,
    // Replay never invents a terminal result. PostgreSQL owns run state, while
    // the durable dispatch sweeper recovers interrupted execution; the client
    // only reattaches to those authoritative transitions.
    status: rebuilt.status,
    pendingApproval: rebuilt.pendingApproval,
    pendingUserInput: rebuilt.pendingUserInput,
    pendingExternal: rebuilt.pendingExternal,
    events: rebuilt.events,
  };
}

const LS_CONVERSATION_PREFIX = "fizz:agent-os:conversationId:";
const LS_START_OUTBOX_PREFIX = "fizz:agent-os:start-outbox:";
const MAX_START_OUTBOX_IDENTITIES = 8;
export const AGENT_OS_START_OUTBOX_TTL_MS = 24 * 60 * 60 * 1000;
const volatileStartOutbox = new Map<string, StartSubmissionIdentity[]>();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function agentOsConversationStorageKey(projectId: string): string {
  return `${LS_CONVERSATION_PREFIX}${projectId}`;
}

export function agentOsStartOutboxStorageKey(projectId: string): string {
  return `${LS_START_OUTBOX_PREFIX}${projectId}`;
}

export function isStartSubmissionIdentityFresh(
  identity: Pick<StartSubmissionIdentity, "createdAt">,
  now = Date.now()
): boolean {
  const createdAt = Date.parse(identity.createdAt);
  return (
    Number.isFinite(createdAt) &&
    createdAt <= now &&
    now - createdAt <= AGENT_OS_START_OUTBOX_TTL_MS
  );
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function startSubmissionFingerprint(
  input: StartSubmissionFingerprintInput
): Promise<string> {
  return sha256Hex(
    canonicalJson({
      ...input,
      message: input.message.trim(),
      modelProfileId: input.modelProfileId.trim(),
      attachmentIds: [...new Set(input.attachmentIds)],
      permissionMode: input.permissionMode ?? "smart",
      skillIds: [...new Set((input.skillIds ?? []).map((value) => value.trim()))].sort(),
      projectSkillInstallationIds: [...new Set(input.projectSkillInstallationIds ?? [])].sort(),
      disabledDefaultSkillInstallationIds: [
        ...new Set(input.disabledDefaultSkillInstallationIds ?? []),
      ].sort(),
    })
  );
}

function readStartOutbox(projectId: string): StartSubmissionIdentity[] {
  if (typeof window === "undefined") return volatileStartOutbox.get(projectId) ?? [];
  try {
    const parsed = JSON.parse(
      localStorage.getItem(agentOsStartOutboxStorageKey(projectId)) ?? "[]"
    );
    if (!Array.isArray(parsed)) return [];
    const valid = parsed.filter((entry): entry is StartSubmissionIdentity => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
      const item = entry as Partial<StartSubmissionIdentity>;
      const shaped =
        typeof item.fingerprint === "string" &&
        /^[0-9a-f]{64}$/.test(item.fingerprint) &&
        typeof item.conversationId === "string" &&
        UUID_PATTERN.test(item.conversationId) &&
        typeof item.clientSubmissionId === "string" &&
        UUID_PATTERN.test(item.clientSubmissionId) &&
        typeof item.turnId === "string" &&
        UUID_PATTERN.test(item.turnId) &&
        typeof item.messageId === "string" &&
        UUID_PATTERN.test(item.messageId) &&
        typeof item.createdAt === "string";
      return shaped && isStartSubmissionIdentityFresh(item as StartSubmissionIdentity);
    });
    return valid.length > 0
      ? valid
      : (volatileStartOutbox.get(projectId) ?? []).filter((identity) =>
          isStartSubmissionIdentityFresh(identity)
        );
  } catch {
    return (volatileStartOutbox.get(projectId) ?? []).filter((identity) =>
      isStartSubmissionIdentityFresh(identity)
    );
  }
}

function writeStartOutbox(projectId: string, identities: StartSubmissionIdentity[]): void {
  const bounded = identities.slice(-MAX_START_OUTBOX_IDENTITIES);
  volatileStartOutbox.set(projectId, bounded);
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(agentOsStartOutboxStorageKey(projectId), JSON.stringify(bounded));
  } catch {
    // The in-memory copy still keeps same-page transport retries stable.
  }
}

export async function startSubmissionIdentity(
  projectId: string,
  input: StartSubmissionFingerprintInput,
  createId: () => string = newId
): Promise<StartSubmissionIdentity> {
  const fingerprint = await startSubmissionFingerprint(input);
  const existing = readStartOutbox(projectId).find(
    (candidate) =>
      candidate.conversationId === input.conversationId && candidate.fingerprint === fingerprint
  );
  if (existing) return existing;
  const created: StartSubmissionIdentity = {
    fingerprint,
    conversationId: input.conversationId,
    clientSubmissionId: createId(),
    turnId: createId(),
    messageId: createId(),
    createdAt: new Date().toISOString(),
  };
  writeStartOutbox(projectId, [...readStartOutbox(projectId), created]);
  return created;
}

function forgetStartSubmission(projectId: string, identity: StartSubmissionIdentity): void {
  const remaining = readStartOutbox(projectId).filter(
    (candidate) => candidate.clientSubmissionId !== identity.clientSubmissionId
  );
  if (remaining.length === 0) {
    volatileStartOutbox.delete(projectId);
    try {
      localStorage.removeItem(agentOsStartOutboxStorageKey(projectId));
    } catch {
      // Storage may be disabled; the volatile entry is already gone.
    }
    return;
  }
  writeStartOutbox(projectId, remaining);
}

function forgetAcknowledgedStartSubmissions(
  projectId: string,
  events: readonly AgentOsEvent[]
): void {
  const durableMessageIds = new Set(
    events
      .filter((event) => event.type === "UserMessage")
      .map((event) => event.data.messageId)
      .filter((messageId): messageId is string => typeof messageId === "string")
  );
  if (durableMessageIds.size === 0) return;
  for (const identity of readStartOutbox(projectId)) {
    if (durableMessageIds.has(identity.messageId)) {
      forgetStartSubmission(projectId, identity);
    }
  }
}

function readStoredConversationId(projectId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(agentOsConversationStorageKey(projectId));
    if (!raw || !/^[0-9a-f-]{36}$/i.test(raw)) return null;
    return raw;
  } catch {
    return null;
  }
}

function writeStoredConversationId(projectId: string, conversationId: string | null) {
  if (typeof window === "undefined") return;
  try {
    const key = agentOsConversationStorageKey(projectId);
    if (!conversationId) localStorage.removeItem(key);
    else localStorage.setItem(key, conversationId);
  } catch {
    /* ignore */
  }
}

function statusFromEvent(event: AgentOsEvent): AgentOsRunStatus | string {
  switch (event.type) {
    case "RunCompleted":
      return "completed";
    case "RunFailed":
      return "failed";
    case "RunCancelled":
      return "cancelled";
    case "RunPaused":
      return event.data.status === "waiting_for_input"
        ? "waiting_for_input"
        : event.data.status === "waiting_for_external"
          ? "waiting_for_external"
          : "waiting_for_approval";
    case "ApprovalRequired":
      return "waiting_for_approval";
    case "UserInputRequired":
      return "waiting_for_input";
    case "ApprovalResolved":
    case "UserInputResolved":
      return "running";
    default:
      return "running";
  }
}

export function useAgentOsRun(projectId: string) {
  const [state, setState] = useState<AgentOsSessionState>(initial);
  const conversationRef = useRef<string | null>(null);
  const lastSequenceByRun = useRef(new Map<string, number>());
  /** Per-run poll controllers — starting run B must not kill run A catch-up. */
  const pollAborts = useRef(new Map<string, AbortController>());
  const activeRunIdRef = useRef<string | null>(null);
  const ablyLive = useRef(new AgentOsAblyLive());
  const ablyConnected = useRef(false);
  const resyncPuller = useRef<
    AgentOsRealtimeResyncPuller<Awaited<ReturnType<typeof agentOsApi.listEvents>>> | undefined
  >(undefined);
  const continuityReconciler = useRef<
    | AgentOsRealtimeConversationReconciler<Awaited<ReturnType<typeof agentOsApi.getConversation>>>
    | undefined
  >(undefined);

  /** Conversation-scoped event buffers — source of truth for transcript. */
  const runsRef = useRef(new Map<string, RunBuffer>());
  const nextRunOrder = useRef(0);
  /** Optimistic user before startRun returns a runId. */
  const pendingUserRef = useRef<OptimisticUser | null>(null);
  /** Idempotency identity survives a failed HTTP attempt and a user retry. */
  const userInputSubmissionIds = useRef(new Map<string, UserInputSubmissionIdentity>());
  /** Stable identity for an approval survives transport failure and UI retry. */
  const approvalSubmissionIds = useRef(new Map<string, ApprovalSubmissionIdentity>());

  const publishFromBuffers = useCallback(() => {
    // Attach pending user (no runId yet) as a trailing optimistic row.
    const buffers = [...runsRef.current.values()];
    const rebuilt = rebuildConversationMessages(buffers);
    let messages = rebuilt.messages;
    if (pendingUserRef.current) {
      const p = pendingUserRef.current;
      // Avoid duplicating if already represented.
      if (!messages.some((m) => m.id === p.id)) {
        messages = [
          ...messages,
          {
            id: p.id,
            role: "user",
            content: p.content,
            createdAt: p.createdAt,
            turnId: p.turnId,
            meta: p.attachmentNames?.length
              ? { attachmentNames: p.attachmentNames, optimistic: true }
              : { optimistic: true },
          },
        ];
      }
    }
    // Selection belongs to the conversation projection, not to whichever
    // realtime/poll request happened to finish last. A late resync for run A
    // must never retarget Stop or HITL actions away from the newer run B.
    activeRunIdRef.current = rebuilt.runId;
    setState({
      status: rebuilt.status === "idle" && messages.length > 0 ? "completed" : rebuilt.status,
      runId: rebuilt.runId,
      conversationId: conversationRef.current,
      messages,
      events: rebuilt.events,
      pendingApproval: rebuilt.pendingApproval,
      pendingUserInput: rebuilt.pendingUserInput,
      pendingExternal: rebuilt.pendingExternal,
      errorCode: rebuilt.errorCode,
      error: rebuilt.error,
    });
  }, []);

  const ensureRunBuffer = useCallback((runId: string): RunBuffer => {
    let buf = runsRef.current.get(runId);
    if (!buf) {
      buf = emptyRunBuffer(runId, nextRunOrder.current);
      nextRunOrder.current += 1;
      runsRef.current.set(runId, buf);
    }
    return buf;
  }, []);

  const applyToRunBuffer = useCallback(
    (input: {
      runId: string;
      status?: string;
      events?: AgentOsEvent[];
      pendingApproval?: AgentOsPendingApproval | null;
      pendingUserInput?: AgentOsPendingUserInput | null;
      pendingExternal?: AgentOsPendingExternal | null;
      assistantText?: string | null;
      error?: { code?: string; message?: string } | null;
      /** Poll / snapshot / ApprovalResolved may leave waiting_for_approval. */
      allowResumeFromWaiting?: boolean;
    }) => {
      const buf = ensureRunBuffer(input.runId);
      if (input.status) {
        buf.status = mergeRunStatus(buf.status, input.status, {
          allowResumeFromWaiting: input.allowResumeFromWaiting,
        });
      }
      if (input.events) {
        if (!buf.createdAt && input.events.length > 0) {
          buf.createdAt =
            [...input.events].sort((left, right) => left.sequence - right.sequence).at(0)
              ?.timestamp ?? null;
        }
        forgetAcknowledgedStartSubmissions(projectId, input.events);
        for (const event of input.events) {
          buf.eventsBySeq.set(event.sequence, event);
        }
        const pendingUser = pendingUserRef.current;
        if (
          pendingUser &&
          input.events.some((event) => eventMatchesOptimisticUser(event, pendingUser))
        ) {
          pendingUserRef.current = null;
        }
        if (buf.eventsBySeq.size > 0) {
          lastSequenceByRun.current.set(
            input.runId,
            advanceAgentOsContiguousSequence(
              buf.eventsBySeq,
              lastSequenceByRun.current.get(input.runId) ?? 0
            )
          );
        }
        // Durable UserMessage → drop optimistic user for this run.
        const hasUserMessage = [...buf.eventsBySeq.values()].some((e) => e.type === "UserMessage");
        if (hasUserMessage) buf.optimisticUser = null;
        const durableUserInteractions = [...buf.eventsBySeq.values()]
          .filter((event) => event.type === "UserMessage")
          .map((event) => event.data.interaction)
          .filter(
            (interaction): interaction is Record<string, unknown> =>
              Boolean(interaction) && typeof interaction === "object" && !Array.isArray(interaction)
          );
        const durableApprovalIds = new Set(
          durableUserInteractions
            .filter((interaction) => interaction.kind === "approval")
            .map((interaction) => String(interaction.approvalId ?? ""))
        );
        const durableApprovalResponseIds = new Set(
          durableUserInteractions
            .filter((interaction) => interaction.kind === "approval")
            .map((interaction) => String(interaction.responseId ?? ""))
            .filter(Boolean)
        );
        const durableRequestIds = new Set(
          durableUserInteractions
            .filter((interaction) => interaction.kind === "user_input")
            .map((interaction) => String(interaction.requestId ?? ""))
        );
        // Drop an optimistic answer only when its durable UserMessage exists.
        // Resolve events can arrive first and must not make the user row blink.
        buf.optimisticDecisions = buf.optimisticDecisions.filter((message) => {
          const responseId = String(message.meta?.responseId ?? "");
          if (responseId) return !durableApprovalResponseIds.has(responseId);
          return !durableApprovalIds.has(String(message.meta?.approvalId ?? ""));
        });
        buf.optimisticInputResponses = buf.optimisticInputResponses.filter(
          (message) => !durableRequestIds.has(String(message.meta?.requestId ?? ""))
        );
        for (const interaction of durableUserInteractions) {
          if (interaction.kind === "user_input") {
            const requestId = String(interaction.requestId ?? "");
            const responseId = String(interaction.responseId ?? "");
            const local = userInputSubmissionIds.current.get(requestId);
            if (local && (!responseId || responseId === local.responseId)) {
              userInputSubmissionIds.current.delete(requestId);
            }
          } else if (interaction.kind === "approval") {
            const approvalId = String(interaction.approvalId ?? "");
            const responseId = String(interaction.responseId ?? "");
            const local = approvalSubmissionIds.current.get(approvalId);
            if (local && (!responseId || responseId === local.responseId)) {
              approvalSubmissionIds.current.delete(approvalId);
            }
          }
        }

        // Journal ApprovalResolved leaves the blocking state; transcript
        // reconciliation above remains independently keyed to UserMessage.
        const hasResolved = [...buf.eventsBySeq.values()].some(
          (e) => e.type === "ApprovalResolved"
        );
        if (hasResolved) {
          if (buf.status === "waiting_for_approval") {
            buf.status = mergeRunStatus(buf.status, "running", {
              allowResumeFromWaiting: true,
            });
          }
        }
        const hasInputResolved = [...buf.eventsBySeq.values()].some(
          (e) => e.type === "UserInputResolved"
        );
        if (hasInputResolved && buf.status === "waiting_for_input") {
          buf.status = mergeRunStatus(buf.status, "running", {
            allowResumeFromWaiting: true,
          });
        }
      }
      if (input.pendingApproval !== undefined) {
        buf.pendingApproval = input.pendingApproval;
      }
      if (input.pendingUserInput !== undefined) {
        buf.pendingUserInput = input.pendingUserInput;
      }
      if (input.pendingExternal !== undefined) {
        buf.pendingExternal = input.pendingExternal;
      } else if (input.status && input.status !== "waiting_for_external") {
        buf.pendingExternal = null;
      }
      if (buf.status === "completed" || buf.status === "failed" || buf.status === "cancelled") {
        buf.pendingApproval = null;
        buf.pendingUserInput = null;
        buf.pendingExternal = null;
      }
      if (typeof input.assistantText === "string") {
        buf.assistantText = input.assistantText;
      }
      if (input.error !== undefined) {
        buf.error = input.error;
      }
      publishFromBuffers();
    },
    [ensureRunBuffer, projectId, publishFromBuffers]
  );

  const mergeResponseRef = useRef(applyToRunBuffer);
  useEffect(() => {
    mergeResponseRef.current = applyToRunBuffer;
  }, [applyToRunBuffer]);

  useEffect(() => {
    const puller = new AgentOsRealtimeResyncPuller(
      (target, afterSequence, signal) =>
        agentOsApi.listEvents(target.runId, projectId, afterSequence, signal),
      (page) => {
        mergeResponseRef.current({
          runId: page.runId,
          status: page.status,
          events: page.events,
          pendingApproval:
            page.status === "waiting_for_approval" ? (page.pendingApproval ?? null) : null,
          pendingUserInput:
            page.status === "waiting_for_input" ? (page.pendingUserInput ?? null) : null,
          pendingExternal:
            page.status === "waiting_for_external" ? (page.pendingExternal ?? null) : null,
          assistantText: page.assistantText,
          allowResumeFromWaiting: true,
        });
      },
      (runId) => lastSequenceByRun.current.get(runId) ?? 0
    );
    const reconciler = new AgentOsRealtimeConversationReconciler(
      (conversationId, signal) => agentOsApi.getConversation(projectId, conversationId, signal),
      (history) => {
        const durableRuns = [...history.runs].sort(
          (left, right) =>
            Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
            left.runId.localeCompare(right.runId)
        );
        const reconciledOrder = reconcileAgentOsConversationRunOrder(
          [...runsRef.current.values()].map((buffer) => ({
            runId: buffer.runId,
            order: buffer.order,
            createdAt: buffer.createdAt,
          })),
          durableRuns
        );
        for (const entry of reconciledOrder) {
          const buffer = ensureRunBuffer(entry.runId);
          buffer.order = entry.order;
          buffer.createdAt = entry.createdAt;
        }
        nextRunOrder.current = reconciledOrder.length;
        const durableBuffers = durableRuns.map((run) => ({
          run,
          buffer: ensureRunBuffer(run.runId),
        }));

        for (const { run } of durableBuffers) {
          mergeResponseRef.current({
            runId: run.runId,
            status: run.status,
            events: run.events,
            pendingApproval:
              run.status === "waiting_for_approval" ? (run.pendingApproval ?? null) : null,
            pendingUserInput:
              run.status === "waiting_for_input" ? (run.pendingUserInput ?? null) : null,
            pendingExternal:
              run.status === "waiting_for_external" ? (run.pendingExternal ?? null) : null,
            assistantText: run.assistantText,
            allowResumeFromWaiting: true,
          });
        }
        publishFromBuffers();

        const reconciledConversationId = history.conversationId ?? conversationRef.current;
        if (!reconciledConversationId) return;
        for (const { run, buffer } of durableBuffers) {
          const contiguous = lastSequenceByRun.current.get(run.runId) ?? 0;
          const observedMax = Math.max(0, ...buffer.eventsBySeq.keys());
          if (observedMax > contiguous) {
            void puller.requestWatermark({
              runId: run.runId,
              conversationId: reconciledConversationId,
              afterSequence: contiguous,
            });
          }
        }
      }
    );
    resyncPuller.current = puller;
    continuityReconciler.current = reconciler;
    return () => {
      reconciler.dispose();
      puller.dispose();
      if (resyncPuller.current === puller) resyncPuller.current = undefined;
      if (continuityReconciler.current === reconciler) {
        continuityReconciler.current = undefined;
      }
    };
  }, [ensureRunBuffer, projectId, publishFromBuffers]);

  useEffect(() => {
    const controllers = pollAborts.current;
    const live = ablyLive.current;
    return () => {
      for (const ac of controllers.values()) ac.abort();
      controllers.clear();
      live.detach();
    };
  }, []);

  const ensureAbly = useCallback(
    async (conversationId: string) => {
      const ok = await ablyLive.current.attach({
        projectId,
        conversationId,
        handlers: {
          onEvent: (event) => {
            const runId = event.runId;
            if (!runId) return;
            const contiguousBeforeEvent = lastSequenceByRun.current.get(runId) ?? 0;
            const mapped = statusFromEvent(event);
            mergeResponseRef.current({
              runId,
              status: mapped,
              events: [event],
              // Only ApprovalResolved / Run* terminal may leave HITL via events.
              allowResumeFromWaiting:
                event.type === "ApprovalResolved" ||
                event.type === "RunResumed" ||
                event.type === "RunCompleted" ||
                event.type === "RunFailed" ||
                event.type === "RunCancelled",
            });
            const catchUp = agentOsCatchUpTargetFromEventGap(event, contiguousBeforeEvent);
            if (catchUp) void resyncPuller.current?.request(catchUp);
          },
          onSnapshot: (snapshot: AgentOsAblyRunSnapshot) => {
            // Status + pending + assistantText only — never wipe event buffers.
            // Shared transport is deployed independently; accept the formal
            // pendingExternal field as soon as the Gateway starts publishing it.
            const transportSnapshot = snapshot as AgentOsAblyRunSnapshot & {
              pendingExternal?: AgentOsPendingExternal | null;
            };
            mergeResponseRef.current({
              runId: snapshot.runId,
              status: snapshot.status,
              assistantText: snapshot.assistantText,
              pendingApproval:
                snapshot.status === "waiting_for_approval"
                  ? ((snapshot.pendingApproval as AgentOsPendingApproval | null) ?? null)
                  : null,
              pendingUserInput:
                snapshot.status === "waiting_for_input"
                  ? ((snapshot.pendingUserInput as AgentOsPendingUserInput | null) ?? null)
                  : null,
              pendingExternal:
                snapshot.status === "waiting_for_external"
                  ? (transportSnapshot.pendingExternal ?? null)
                  : null,
              allowResumeFromWaiting: true,
            });
            const contiguous = lastSequenceByRun.current.get(snapshot.runId) ?? 0;
            const catchUp = agentOsCatchUpTargetFromSnapshot(snapshot, contiguous);
            if (catchUp) void resyncPuller.current?.request(catchUp);
          },
          onResync: (pointer: AgentOsAblyResyncPointer) => {
            if (pointer.conversationId !== conversationRef.current) return;
            void resyncPuller.current?.request(agentOsCatchUpTargetFromPointer(pointer));
          },
          onDiscontinuity: () => {
            const currentConversationId = conversationRef.current;
            if (!currentConversationId) return;
            void continuityReconciler.current?.request(currentConversationId);
          },
        },
      });
      ablyConnected.current = ok;
      return ok;
    },
    [projectId]
  );

  const pollRun = useCallback(
    async (runId: string) => {
      // Only abort a previous poll of the *same* run — never kill sibling turns.
      pollAborts.current.get(runId)?.abort();
      const ac = new AbortController();
      pollAborts.current.set(runId, ac);
      const maxMs = 10 * 60_000;
      let ordinaryDeadlineAt = Date.now() + maxMs;
      let wasWaitingForExternal = false;
      /**
       * Foreground inference has a bounded follow window and tolerates a run
       * of transient transport failures. A durable external handoff suspends
       * both limits because only its journal terminal event owns completion.
       *
       * This loop is the only transport when Ably is not live (Front Door does
       * not pass SSE), so failures must become visible without fabricating a
       * product failure for background work that is still healthy.
       */
      let consecutiveFailures = 0;
      const maxConsecutiveFailures = 8;
      const giveUp = (code: string, message: string) => {
        pollAborts.current.delete(runId);
        // Through the buffer, not a bare setState: a later rebuild would wipe
        // anything that lives outside it, and this is the only thing telling
        // the user their turn stopped.
        applyToRunBuffer({
          runId,
          status: "failed",
          error: { code, message },
          allowResumeFromWaiting: true,
        });
      };

      while (!ac.signal.aborted) {
        const currentStatus = runsRef.current.get(runId)?.status;
        const waitingForExternal = currentStatus === "waiting_for_external";
        if (waitingForExternal) {
          wasWaitingForExternal = true;
        } else {
          // Time spent in a durable background handoff never consumes the
          // foreground inference deadline. Once it resumes, grant a fresh
          // window to receive the terminal journal events.
          if (wasWaitingForExternal) {
            ordinaryDeadlineAt = Date.now() + maxMs;
            consecutiveFailures = 0;
            wasWaitingForExternal = false;
          }
          const failureCode = agentOsPollFailureCode({
            status: currentStatus,
            consecutiveFailures,
            maxConsecutiveFailures,
            now: Date.now(),
            ordinaryDeadlineAt,
          });
          if (failureCode) {
            giveUp(failureCode, "");
            return;
          }
        }

        const after = lastSequenceByRun.current.get(runId) ?? 0;
        let justFailed = false;
        try {
          const page = await agentOsApi.listEvents(runId, projectId, after, ac.signal);
          applyToRunBuffer({
            runId: page.runId,
            status: page.status,
            events: page.events,
            pendingApproval:
              page.status === "waiting_for_approval" ? (page.pendingApproval ?? null) : null,
            pendingUserInput:
              page.status === "waiting_for_input" ? (page.pendingUserInput ?? null) : null,
            pendingExternal:
              page.status === "waiting_for_external" ? (page.pendingExternal ?? null) : null,
            assistantText: page.assistantText,
            allowResumeFromWaiting: true,
          });
          consecutiveFailures = 0;
          if (agentOsPollSnapshotDisposition(page) === "stop") {
            pollAborts.current.delete(runId);
            return page;
          }
        } catch (error) {
          if (ac.signal.aborted) return;
          consecutiveFailures += 1;
          justFailed = true;
          const durableExternalWork = runsRef.current.get(runId)?.status === "waiting_for_external";
          const failureCode = agentOsPollFailureCode({
            status: runsRef.current.get(runId)?.status,
            consecutiveFailures,
            maxConsecutiveFailures,
            now: Date.now(),
            ordinaryDeadlineAt,
          });
          if (failureCode) {
            giveUp(
              failureCode,
              failureCode === "AGENT_OS_POLL_LOST"
                ? error instanceof Error
                  ? error.message
                  : String(error)
                : ""
            );
            return;
          }
          // A durable external run survives browser/gateway disconnects. Keep
          // retrying with a bounded exponent so reconnect can replay journal
          // events instead of fabricating a failed product turn.
          if (durableExternalWork) {
            consecutiveFailures = Math.min(consecutiveFailures, 12);
          }
        }
        const externalStillRunning = runsRef.current.get(runId)?.status === "waiting_for_external";
        const base = externalStillRunning
          ? ablyConnected.current || ablyLive.current.isLive
            ? 5_000
            : 2_000
          : ablyConnected.current || ablyLive.current.isLive
            ? 1_500
            : 120;
        // Back off while failing so a struggling gateway is not hammered at 8/s.
        const intervalMs = justFailed
          ? Math.min(base * 2 ** consecutiveFailures, externalStillRunning ? 30_000 : 5_000)
          : base;
        await new Promise((r) => setTimeout(r, intervalMs));
      }
      pollAborts.current.delete(runId);
    },
    [applyToRunBuffer, projectId]
  );

  // Restore the durable transcript for this project conversation.
  useEffect(() => {
    const storedConversationId = readStoredConversationId(projectId);
    if (!storedConversationId) {
      return;
    }
    let cancelled = false;
    void agentOsApi
      .getConversation(projectId, storedConversationId)
      .then((history) => {
        if (cancelled) return;
        if (!history.conversationId || history.runs.length === 0) {
          if (storedConversationId) {
            conversationRef.current = storedConversationId;
            setState((prev) => ({
              ...prev,
              conversationId: storedConversationId,
            }));
          }
          return;
        }
        conversationRef.current = history.conversationId;
        writeStoredConversationId(projectId, history.conversationId);
        resyncPuller.current?.reset();
        continuityReconciler.current?.reset();
        runsRef.current = new Map();
        nextRunOrder.current = 0;
        for (const run of history.runs) {
          const buf = emptyRunBuffer(run.runId, nextRunOrder.current);
          nextRunOrder.current += 1;
          buf.createdAt = run.createdAt;
          buf.status = run.status;
          buf.pendingApproval = (run.pendingApproval as AgentOsPendingApproval | null) ?? null;
          buf.pendingUserInput = (run.pendingUserInput as AgentOsPendingUserInput | null) ?? null;
          buf.pendingExternal = (run.pendingExternal as AgentOsPendingExternal | null) ?? null;
          buf.assistantText = run.assistantText ?? null;
          for (const event of run.events) {
            buf.eventsBySeq.set(event.sequence, event);
          }
          runsRef.current.set(run.runId, buf);
          if (buf.eventsBySeq.size > 0) {
            lastSequenceByRun.current.set(
              run.runId,
              advanceAgentOsContiguousSequence(buf.eventsBySeq)
            );
          }
        }
        publishFromBuffers();
        const rebuilt = rebuildConversationMessages(runsRef.current.values());
        if (rebuilt.runId) activeRunIdRef.current = rebuilt.runId;
        if (
          rebuilt.runId &&
          history.conversationId &&
          (rebuilt.status === "waiting_for_approval" ||
            rebuilt.status === "waiting_for_input" ||
            rebuilt.status === "waiting_for_external" ||
            rebuilt.status === "running")
        ) {
          void ensureAbly(history.conversationId).then(() => {
            if (
              (rebuilt.status === "running" || rebuilt.status === "waiting_for_external") &&
              rebuilt.runId
            ) {
              void pollRun(rebuilt.runId);
            }
          });
        }
      })
      .catch(() => {
        if (cancelled) return;
        if (storedConversationId) {
          conversationRef.current = storedConversationId;
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ensureAbly, pollRun, projectId, publishFromBuffers]);

  const send = useCallback(
    async (input: {
      message: string;
      modelProfileId: string;
      attachmentIds?: string[];
      attachmentNames?: string[];
      permissionMode?: "ask" | "smart" | "full";
      workbenchMode: "storyboard" | "canvas" | "brief" | "story";
      workbenchContext?: AgentOsWorkbenchContext;
      skillIds?: string[];
      projectSkillInstallationIds?: string[];
      disabledDefaultSkillInstallationIds?: string[];
    }) => {
      const text = input.message.trim();
      const attachmentIds = input.attachmentIds ?? [];
      if (!text && attachmentIds.length === 0) return;

      const conversationId = conversationRef.current ?? crypto.randomUUID();
      conversationRef.current = conversationId;
      writeStoredConversationId(projectId, conversationId);

      const names = input.attachmentNames ?? [];
      const submission = await startSubmissionIdentity(projectId, {
        conversationId,
        message: text,
        modelProfileId: input.modelProfileId,
        attachmentIds,
        permissionMode: input.permissionMode,
        workbenchMode: input.workbenchMode,
        workbenchContext: input.workbenchContext,
        skillIds: input.skillIds,
        projectSkillInstallationIds: input.projectSkillInstallationIds,
        disabledDefaultSkillInstallationIds: input.disabledDefaultSkillInstallationIds,
      });
      const optimistic: OptimisticUser = {
        id: submission.messageId,
        turnId: submission.turnId,
        content: text,
        createdAt: submission.createdAt,
        attachmentNames: names.length > 0 ? names : undefined,
      };
      pendingUserRef.current = optimistic;
      setState((prev) => ({
        ...prev,
        status: "running",
        conversationId,
        error: null,
        pendingApproval: null,
        pendingUserInput: null,
        pendingExternal: null,
      }));
      publishFromBuffers();

      try {
        void ensureAbly(conversationId);
        const response = await agentOsApi.startRun({
          projectId,
          conversationId,
          clientSubmissionId: submission.clientSubmissionId,
          turnId: submission.turnId,
          messageId: submission.messageId,
          message: text,
          modelProfileId: input.modelProfileId,
          attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
          permissionMode: input.permissionMode,
          workbenchMode: input.workbenchMode,
          workbenchContext: input.workbenchContext,
          skillIds: input.skillIds,
          projectSkillInstallationIds: input.projectSkillInstallationIds,
          disabledDefaultSkillInstallationIds: input.disabledDefaultSkillInstallationIds,
        });

        // Bind optimistic user to this run *before* merging events.
        forgetStartSubmission(projectId, submission);
        pendingUserRef.current = null;
        const buf = ensureRunBuffer(response.runId);
        buf.createdAt = buf.createdAt ?? submission.createdAt;
        buf.optimisticUser = optimistic;
        buf.workbenchContext = input.workbenchContext ?? null;
        lastSequenceByRun.current.set(
          response.runId,
          lastSequenceByRun.current.get(response.runId) ?? 0
        );
        activeRunIdRef.current = response.runId;

        applyToRunBuffer({
          runId: response.runId,
          status: response.status,
          events: response.events,
          pendingApproval:
            response.status === "waiting_for_approval" ? (response.pendingApproval ?? null) : null,
          pendingUserInput:
            response.status === "waiting_for_input" ? (response.pendingUserInput ?? null) : null,
          pendingExternal:
            response.status === "waiting_for_external" ? (response.pendingExternal ?? null) : null,
          assistantText: response.assistantText,
          allowResumeFromWaiting: true,
        });

        await ensureAbly(conversationId);
        // Fire-and-forget: a second send must not await this poll.
        if (
          response.status === "running" ||
          response.status === "waiting_for_external" ||
          response.status === "queued" ||
          response.status === "paused"
        ) {
          void pollRun(response.runId);
        }
        return response;
      } catch (error) {
        const recovered = [...runsRef.current.values()].find((buffer) =>
          [...buffer.eventsBySeq.values()].some((event) =>
            eventMatchesOptimisticUser(event, optimistic)
          )
        );
        if (recovered) {
          forgetStartSubmission(projectId, submission);
          pendingUserRef.current = null;
          activeRunIdRef.current = recovered.runId;
          publishFromBuffers();
          if (recovered.status === "running" || recovered.status === "waiting_for_external") {
            void pollRun(recovered.runId);
          }
          return;
        }
        pendingUserRef.current = null;
        const message = error instanceof Error ? error.message : "FizzAgent run failed";
        setState((prev) => ({
          ...prev,
          status: "failed",
          error: message,
          messages: [
            ...prev.messages.filter((m) => m.id !== optimistic.id),
            {
              id: optimistic.id,
              role: "user",
              content: optimistic.content,
              createdAt: optimistic.createdAt,
              turnId: optimistic.turnId,
              meta: optimistic.attachmentNames
                ? { attachmentNames: optimistic.attachmentNames }
                : undefined,
            },
          ],
        }));
        throw error;
      }
    },
    [applyToRunBuffer, ensureAbly, ensureRunBuffer, pollRun, projectId, publishFromBuffers]
  );

  const resolveUserInput = useCallback(
    async (input: {
      requestId: string;
      answers: Record<string, string>;
      modelProfileId: string;
      permissionMode?: "ask" | "smart" | "full";
    }) => {
      const runId = activeRunIdRef.current ?? state.runId;
      const conversationId = conversationRef.current;
      if (!runId || !conversationId) {
        throw new Error("No active input request");
      }
      const buffer = ensureRunBuffer(runId);
      const pending =
        buffer.pendingUserInput ??
        derivePendingUserInputFromEvents([...buffer.eventsBySeq.values()]);
      if (!pending || pending.requestId !== input.requestId) {
        throw new Error("This input request is no longer pending");
      }

      const identity = userInputSubmissionIdentity(
        userInputSubmissionIds.current,
        input.requestId,
        input.answers
      );
      if (
        buffer.optimisticInputResponses.some(
          (message) => message.meta?.responseId === identity.responseId
        )
      ) {
        return;
      }
      const afterSequence = lastSequenceByRun.current.get(runId) ?? 0;
      const responseMessage: AgentOsChatMessage = {
        id: identity.messageId,
        role: "user",
        content: userInputResponseText(pending, input.answers),
        createdAt: new Date().toISOString(),
        turnId: identity.turnId,
        runId,
        meta: {
          kind: "user_input_response",
          requestId: input.requestId,
          responseId: identity.responseId,
          answers: input.answers,
          afterSequence,
        },
      };
      buffer.optimisticInputResponses = [
        ...buffer.optimisticInputResponses.filter(
          (message) => message.meta?.responseId !== identity.responseId
        ),
        responseMessage,
      ];
      buffer.pendingUserInput = null;
      buffer.status = "running";
      publishFromBuffers();

      try {
        const response = await agentOsApi.resolveUserInput({
          runId,
          requestId: input.requestId,
          responseId: identity.responseId,
          answers: input.answers,
          projectId,
          conversationId,
          modelProfileId: input.modelProfileId,
          permissionMode: input.permissionMode,
        });
        activeRunIdRef.current = response.runId;
        applyToRunBuffer({
          runId: response.runId,
          status: response.status,
          events: response.events,
          pendingApproval:
            response.status === "waiting_for_approval" ? (response.pendingApproval ?? null) : null,
          pendingUserInput:
            response.status === "waiting_for_input" ? (response.pendingUserInput ?? null) : null,
          pendingExternal:
            response.status === "waiting_for_external" ? (response.pendingExternal ?? null) : null,
          assistantText: response.assistantText,
          allowResumeFromWaiting: true,
        });
        if (
          response.status === "running" ||
          response.status === "waiting_for_external" ||
          response.status === "queued" ||
          response.status === "paused"
        ) {
          void pollRun(runId);
        }
        return response;
      } catch (error) {
        buffer.optimisticInputResponses = buffer.optimisticInputResponses.filter(
          (message) => message.id !== responseMessage.id
        );
        const journalEvents = [...buffer.eventsBySeq.values()];
        const requestWasJournaled = journalEvents.some(
          (event) =>
            event.type === "UserInputRequired" && event.data.requestId === pending.requestId
        );
        const restoredPending = requestWasJournaled
          ? derivePendingUserInputFromEvents(journalEvents)
          : pending;
        buffer.pendingUserInput = restoredPending;
        buffer.status = restoredPending
          ? "waiting_for_input"
          : deriveStatusFromEvents(journalEvents, buffer.status);
        publishFromBuffers();
        throw error;
      }
    },
    [applyToRunBuffer, ensureRunBuffer, pollRun, projectId, publishFromBuffers, state.runId]
  );

  const resolveApproval = useCallback(
    async (input: {
      approvalId: string;
      decision: "approve" | "reject";
      /** Localized user-visible transcript copy for the optimistic row. */
      responseText: string;
      locale: "en-US" | "zh-CN" | "zh-HK";
      modelProfileId: string;
      permissionMode?: "ask" | "smart" | "full";
      experience?: "mobile_h5";
    }) => {
      const runId = activeRunIdRef.current ?? state.runId;
      const conversationId = conversationRef.current;
      if (!runId || !conversationId) {
        throw new Error("No active turn to approve");
      }
      const responseText = input.responseText.trim();
      if (responseText.length < 1 || responseText.length > 300) {
        throw new Error("Approval response text must contain 1–300 characters");
      }
      const afterSequence = lastSequenceByRun.current.get(runId) ?? 0;
      const buf = ensureRunBuffer(runId);
      const pendingApproval =
        buf.pendingApproval ?? derivePendingApprovalFromEvents([...buf.eventsBySeq.values()]);
      if (!pendingApproval || pendingApproval.approvalId !== input.approvalId) {
        throw new Error("This approval is no longer pending");
      }
      const identity = approvalSubmissionIdentity(
        approvalSubmissionIds.current,
        input.approvalId,
        input.decision,
        responseText,
        input.locale
      );
      if (
        buf.optimisticDecisions.some((message) => message.meta?.responseId === identity.responseId)
      ) {
        return;
      }
      const decisionMsg: AgentOsChatMessage = {
        id: identity.messageId,
        role: "user",
        content: responseText,
        createdAt: new Date().toISOString(),
        turnId: identity.turnId,
        runId,
        meta: {
          kind: "approval_response",
          approvalId: input.approvalId,
          responseId: identity.responseId,
          decision: input.decision,
          responseText,
          locale: input.locale,
          afterSequence,
        },
      };
      buf.optimisticDecisions = [...buf.optimisticDecisions, decisionMsg];
      // Both decisions resume the same run. Reject means "do not execute this
      // action", not "cancel the Agent conversation".
      buf.status = "running";
      buf.pendingApproval = null;
      publishFromBuffers();

      try {
        const response = await agentOsApi.resolveApproval({
          runId,
          approvalId: input.approvalId,
          responseId: identity.responseId,
          decision: input.decision,
          responseText,
          locale: input.locale,
          projectId,
          conversationId,
          modelProfileId: input.modelProfileId,
          permissionMode: input.permissionMode,
          experience: input.experience,
        });
        activeRunIdRef.current = response.runId;
        applyToRunBuffer({
          runId: response.runId,
          status: response.status,
          events: response.events,
          pendingApproval:
            response.status === "waiting_for_approval" ? (response.pendingApproval ?? null) : null,
          pendingUserInput:
            response.status === "waiting_for_input" ? (response.pendingUserInput ?? null) : null,
          pendingExternal:
            response.status === "waiting_for_external" ? (response.pendingExternal ?? null) : null,
          assistantText: response.assistantText,
          allowResumeFromWaiting: true,
        });
        if (
          response.status === "running" ||
          response.status === "waiting_for_external" ||
          response.status === "queued" ||
          response.status === "paused"
        ) {
          void pollRun(runId);
        }
        return response;
      } catch (error) {
        buf.optimisticDecisions = buf.optimisticDecisions.filter((d) => d.id !== decisionMsg.id);
        const journalEvents = [...buf.eventsBySeq.values()];
        const approvalWasJournaled = journalEvents.some(
          (event) =>
            event.type === "ApprovalRequired" &&
            event.data.approvalId === pendingApproval?.approvalId
        );
        const restoredPending = approvalWasJournaled
          ? derivePendingApprovalFromEvents(journalEvents)
          : pendingApproval;
        buf.pendingApproval = restoredPending;
        buf.status = restoredPending
          ? "waiting_for_approval"
          : deriveStatusFromEvents(journalEvents, buf.status);
        publishFromBuffers();
        throw error;
      }
    },
    [applyToRunBuffer, ensureRunBuffer, pollRun, projectId, publishFromBuffers, state.runId]
  );

  const newChat = useCallback(() => {
    for (const ac of pollAborts.current.values()) ac.abort();
    pollAborts.current.clear();
    ablyLive.current.detach();
    ablyConnected.current = false;
    resyncPuller.current?.reset();
    continuityReconciler.current?.reset();
    conversationRef.current = null;
    lastSequenceByRun.current = new Map();
    activeRunIdRef.current = null;
    runsRef.current = new Map();
    nextRunOrder.current = 0;
    pendingUserRef.current = null;
    userInputSubmissionIds.current.clear();
    approvalSubmissionIds.current.clear();
    writeStoredConversationId(projectId, null);
    setState(initial);
  }, [projectId]);

  const stop = useCallback(
    async (label = "Stopped") => {
      const runId = activeRunIdRef.current;
      if (runId) {
        const response = await agentOsApi.cancelRun(runId, projectId, label);
        for (const ac of pollAborts.current.values()) ac.abort();
        pollAborts.current.clear();
        applyToRunBuffer({
          runId: response.runId,
          status: response.status,
          events: response.events,
          pendingApproval: response.pendingApproval ?? null,
          pendingUserInput: response.pendingUserInput ?? null,
          pendingExternal: response.pendingExternal ?? null,
          assistantText: response.assistantText,
          allowResumeFromWaiting: true,
        });
      }
      pendingUserRef.current = null;
      userInputSubmissionIds.current.clear();
      approvalSubmissionIds.current.clear();
      publishFromBuffers();
    },
    [applyToRunBuffer, projectId, publishFromBuffers]
  );

  return {
    state,
    send,
    resolveApproval,
    resolveUserInput,
    newChat,
    stop,
  };
}
