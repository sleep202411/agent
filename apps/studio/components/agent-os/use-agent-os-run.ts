"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentOsAblyRunSnapshot } from "@repo/shared";
import { AgentOsAblyLive } from "@/lib/agent-os/ably-live";
import {
  agentOsApi,
  type AgentOsEvent,
  type AgentOsPendingApproval,
  type AgentOsRunStatus,
  type AgentOsWorkbenchContext,
} from "@/lib/agent-os/api-client";

export type AgentOsChatRole = "user" | "assistant" | "system" | "tool" | "approval";

export interface AgentOsChatMessage {
  id: string;
  role: AgentOsChatRole;
  /** Primary text shown in the bubble / card. */
  content: string;
  createdAt: string;
  /** Optional structured payload (tool id, steps, approval args preview). */
  meta?: Record<string, unknown>;
  /** Which agent run produced this message (product turn). */
  runId?: string;
  /** Immutable workbench target captured when this turn started. */
  workbenchContext?: AgentOsWorkbenchContext;
}

export interface AgentOsSessionState {
  status: "idle" | "running" | "waiting_for_approval" | "completed" | "failed" | "cancelled";
  runId: string | null;
  conversationId: string | null;
  /** Full chat transcript (Codex-style continuous thread). */
  messages: AgentOsChatMessage[];
  events: AgentOsEvent[];
  pendingApproval: AgentOsPendingApproval | null;
  assistantText: string | null;
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
  assistantText: null,
  error: null,
  errorCode: null,
};

const TERMINAL = new Set(["completed", "failed", "cancelled", "waiting_for_approval"]);

function mapRunStatus(status: string | undefined): AgentOsSessionState["status"] {
  if (status === "waiting_for_approval") return "waiting_for_approval";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  if (status === "running" || status === "queued" || status === "paused") return "running";
  if (status) return "failed";
  return "idle";
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
  if (terminal.has(prev) && incoming === "running") return prev;
  if (incoming === "waiting_for_approval") return incoming;
  if (terminal.has(incoming)) return incoming;
  if (prev === "waiting_for_approval" && incoming === "running" && !opts?.allowResumeFromWaiting) {
    return prev;
  }
  return incoming || prev;
}

// ─── Per-run event buffer (conversation-scoped) ───────────────────────────

type OptimisticUser = {
  id: string;
  content: string;
  createdAt: string;
  attachmentNames?: string[];
};

type RunBuffer = {
  runId: string;
  /** Stable order of runs within the conversation (first-seen order). */
  order: number;
  status: string;
  eventsBySeq: Map<number, AgentOsEvent>;
  pendingApproval: AgentOsPendingApproval | null;
  assistantText: string | null;
  error: { code?: string; message?: string } | null;
  /** The target captured by RunStarted; never replaced by the current UI selection. */
  workbenchContext: AgentOsWorkbenchContext | null;
  /** Client-only user row until UserMessage lands in the journal. */
  optimisticUser: OptimisticUser | null;
  /** Client-only HITL decisions not yet in journal (no eventSequence). */
  optimisticDecisions: AgentOsChatMessage[];
};

function emptyRunBuffer(runId: string, order: number): RunBuffer {
  return {
    runId,
    order,
    status: "running",
    eventsBySeq: new Map(),
    pendingApproval: null,
    assistantText: null,
    error: null,
    workbenchContext: null,
    optimisticUser: null,
    optimisticDecisions: [],
  };
}

/**
 * Rebuild one run's timeline from sorted events in true chronological order.
 *
 * Rules:
 * - MessageDelta opens/extends an assistant segment
 * - Tool / plan / approval-related boundaries close the open assistant segment
 *   so later deltas become a NEW bubble *after* the tools (not rewrite above)
 * - ToolStarted/Completed/Failed collapse to one row per toolCallId
 * - MessageCompleted finalizes the open segment; does not re-merge full text
 *   into the first bubble (that was the main out-of-order bug)
 */
export function rebuildRunTimelineFromEvents(
  events: AgentOsEvent[],
  runId: string,
  runStatus: AgentOsSessionState["status"]
): AgentOsChatMessage[] {
  const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
  const out: AgentOsChatMessage[] = [];
  let segment = 0;
  let streamText = "";
  let openAssistant = false;
  /** toolCallId (or fallback key) → index in out */
  const toolIndex = new Map<string, number>();

  const openAssistantId = () => `assistant:stream:${runId}:${segment}`;

  const closeOpenAssistant = (kind: "streaming" | "message_completed", eventSequence?: number) => {
    if (!openAssistant && !streamText.trim()) return;
    const id = openAssistantId();
    const last = out.at(-1);
    const seq = eventSequence ?? Number(last?.meta?.eventSequence ?? 0);
    if (last?.id === id) {
      last.content = streamText;
      last.meta = { kind, eventSequence: seq };
    } else if (streamText.trim()) {
      out.push({
        id,
        role: "assistant",
        content: streamText,
        createdAt: last?.createdAt ?? new Date().toISOString(),
        runId,
        meta: { kind, eventSequence: seq },
      });
    }
    openAssistant = false;
    streamText = "";
    segment += 1;
  };

  const upsertAssistantDelta = (delta: string, ts: string, eventSequence: number) => {
    streamText += delta;
    openAssistant = true;
    const id = openAssistantId();
    const last = out.at(-1);
    if (last?.id === id) {
      last.content = streamText;
      last.createdAt = ts;
      last.meta = { kind: "streaming", eventSequence };
      return;
    }
    out.push({
      id,
      role: "assistant",
      content: streamText,
      createdAt: ts,
      runId,
      meta: { kind: "streaming", eventSequence },
    });
  };

  const toolKey = (event: AgentOsEvent): string => {
    const callId = event.data.toolCallId;
    if (typeof callId === "string" && callId.trim()) return callId.trim();
    const toolId = String(event.data.toolId ?? "tool");
    return `${toolId}@${event.sequence}`;
  };

  const upsertTool = (
    event: AgentOsEvent,
    phase: "proposed" | "started" | "completed" | "failed"
  ) => {
    if (openAssistant || streamText.trim()) {
      closeOpenAssistant("message_completed");
    }
    const key = toolKey(event);
    const toolId = String(event.data.toolId ?? "tool");
    const id = `tool:${runId}:${key}`;
    const existing = toolIndex.get(key);
    const row: AgentOsChatMessage = {
      id,
      role: "tool",
      content: toolId,
      createdAt: event.timestamp,
      runId,
      meta: {
        kind: "tool",
        toolId,
        toolCallId: event.data.toolCallId,
        phase,
        message: event.data.message,
        // The tool's own result — it carries the canvas nodes a write touched,
        // which is what lets the transcript link to them.
        result: event.data.result,
        eventSequence: event.sequence,
      },
    };
    if (existing !== undefined) {
      const prevPhase = String(out[existing]?.meta?.phase ?? "");
      const rank = { proposed: 0, started: 1, completed: 2, failed: 2 } as const;
      const prevRank = rank[prevPhase as keyof typeof rank] ?? -1;
      const nextRank = rank[phase];
      if (nextRank >= prevRank) {
        out[existing] = row;
      }
      return;
    }
    toolIndex.set(key, out.length);
    out.push(row);
  };

  for (const event of sorted) {
    if (event.type === "UserMessage") {
      if (openAssistant || streamText.trim()) {
        closeOpenAssistant("message_completed", event.sequence);
      }
      const text = typeof event.data.text === "string" ? event.data.text.trim() : "";
      if (text) {
        out.push({
          id: `user:${runId}:${event.sequence}`,
          role: "user",
          content: text,
          createdAt: event.timestamp,
          runId,
          meta: { eventSequence: event.sequence },
        });
      }
      continue;
    }

    if (event.type === "ApprovalResolved") {
      if (openAssistant || streamText.trim()) {
        closeOpenAssistant("message_completed", event.sequence);
      }
      const decision = event.data.decision === "reject" ? "reject" : "approve";
      // Reject short-circuits execution: mark the open proposed tool failed so
      // the UI does not spin on phase=proposed forever (even if ToolFailed is
      // missing from an older journal).
      if (decision === "reject") {
        const openIdx = [...toolIndex.values()].reverse().find((idx) => {
          const phase = String(out[idx]?.meta?.phase ?? "");
          return phase === "proposed" || phase === "started";
        });
        if (openIdx !== undefined) {
          const prev = out[openIdx]!;
          out[openIdx] = {
            ...prev,
            meta: {
              ...prev.meta,
              phase: "failed",
              message: "User rejected the proposed write.",
              eventSequence: event.sequence,
            },
          };
        }
      }
      out.push({
        id: `decision:${runId}:${event.sequence}`,
        role: "user",
        content: decision === "approve" ? "Approved write" : "Rejected write",
        createdAt: event.timestamp,
        runId,
        meta: {
          kind: "approval_decision",
          decision,
          afterSequence: event.sequence,
          eventSequence: event.sequence,
        },
      });
      continue;
    }

    if (event.type === "PlanCreated" && Array.isArray(event.data.steps)) {
      if (openAssistant || streamText.trim()) {
        closeOpenAssistant("message_completed", event.sequence);
      }
      out.push({
        id: `plan:${runId}:${event.sequence}`,
        role: "tool",
        content: (event.data.steps as string[]).join(" → "),
        createdAt: event.timestamp,
        runId,
        meta: {
          kind: "plan",
          steps: event.data.steps,
          eventSequence: event.sequence,
        },
      });
      continue;
    }

    if (event.type === "MessageDelta" && typeof event.data.delta === "string") {
      upsertAssistantDelta(event.data.delta, event.timestamp, event.sequence);
      continue;
    }

    if (event.type === "MessageCompleted") {
      const text = typeof event.data.text === "string" ? event.data.text.trim() : "";
      if (openAssistant || streamText.trim()) {
        if (!streamText.trim() && text) streamText = text;
        closeOpenAssistant("message_completed", event.sequence);
      } else if (text && !out.some((m) => m.role === "assistant")) {
        out.push({
          id: openAssistantId(),
          role: "assistant",
          content: text,
          createdAt: event.timestamp,
          runId,
          meta: { kind: "message_completed", eventSequence: event.sequence },
        });
        segment += 1;
      } else {
        const lastAsst = [...out].reverse().find((m) => m.role === "assistant");
        if (lastAsst?.meta?.kind === "streaming") {
          lastAsst.meta = {
            ...lastAsst.meta,
            kind: "message_completed",
            eventSequence: event.sequence,
          };
        }
      }
      continue;
    }

    if (event.type === "ToolProposed") {
      upsertTool(event, "proposed");
      continue;
    }
    if (event.type === "ToolStarted") {
      upsertTool(event, "started");
      continue;
    }
    if (event.type === "ToolCompleted") {
      upsertTool(event, "completed");
      continue;
    }
    if (event.type === "ToolFailed") {
      upsertTool(event, "failed");
      continue;
    }

    if (event.type === "ProjectPatchApplied") {
      if (openAssistant || streamText.trim()) {
        closeOpenAssistant("message_completed", event.sequence);
      }
      out.push({
        id: `patch:${runId}:${event.sequence}`,
        role: "system",
        content: "Project updated",
        createdAt: event.timestamp,
        runId,
        meta: { kind: "patch", eventSequence: event.sequence },
      });
      continue;
    }

    if (event.type === "RunFailed") {
      if (openAssistant || streamText.trim()) {
        closeOpenAssistant("message_completed", event.sequence);
      }
      const msg =
        typeof event.data.message === "string"
          ? event.data.message
          : typeof (event.data.error as { message?: string } | undefined)?.message === "string"
            ? (event.data.error as { message: string }).message
            : "Run failed";
      out.push({
        id: `err:${runId}:${event.sequence}`,
        role: "system",
        content: msg,
        createdAt: event.timestamp,
        runId,
        meta: { kind: "error", eventSequence: event.sequence },
      });
    }
  }

  // Terminal / cancelled runs must not leave tool cards spinning.
  if (runStatus === "cancelled" || runStatus === "failed" || runStatus === "completed") {
    for (const idx of toolIndex.values()) {
      const row = out[idx];
      if (!row) continue;
      const phase = String(row.meta?.phase ?? "");
      if (phase === "proposed" || phase === "started") {
        out[idx] = {
          ...row,
          meta: {
            ...row.meta,
            phase: runStatus === "completed" ? "completed" : "failed",
            message:
              runStatus === "cancelled"
                ? "Run cancelled"
                : runStatus === "failed"
                  ? "Run failed"
                  : row.meta?.message,
          },
        };
      }
    }
  }

  if (openAssistant || streamText.trim()) {
    const kind =
      runStatus === "running" || runStatus === "waiting_for_approval"
        ? "streaming"
        : "message_completed";
    const id = openAssistantId();
    const last = out.at(-1);
    const seq = Number(last?.meta?.eventSequence ?? 0);
    if (last?.id === id) {
      last.content = streamText;
      last.meta = { kind, eventSequence: seq };
    } else if (streamText.trim()) {
      out.push({
        id,
        role: "assistant",
        content: streamText,
        createdAt: new Date().toISOString(),
        runId,
        meta: { kind, eventSequence: seq },
      });
    }
  }

  return out;
}

/**
 * Prefer journal terminal / HITL events over a stale buffer status of "running"
 * (e.g. last MessageDelta left status running after RunCompleted was missed).
 */
export function deriveStatusFromEvents(
  events: readonly AgentOsEvent[],
  bufferStatus: string
): AgentOsSessionState["status"] {
  const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
  let derived: AgentOsSessionState["status"] | null = null;
  for (const event of sorted) {
    switch (event.type) {
      case "RunCompleted":
        derived = "completed";
        break;
      case "RunFailed":
        derived = "failed";
        break;
      case "RunCancelled":
        derived = "cancelled";
        break;
      case "ApprovalRequired":
      case "RunPaused":
        derived = "waiting_for_approval";
        break;
      case "ApprovalResolved":
        // Reject ends the turn; approve resumes execution.
        derived = event.data.decision === "reject" ? "cancelled" : "running";
        break;
      case "RunStarted":
      case "RunResumed":
        derived = "running";
        break;
      default:
        break;
    }
  }
  if (derived === "completed" || derived === "failed" || derived === "cancelled") {
    return derived;
  }
  if (derived === "waiting_for_approval") {
    return "waiting_for_approval";
  }
  return mapRunStatus(bufferStatus);
}

/**
 * Reconstruct HITL card from journal events when poll/snapshot pendingApproval
 * is missing (common after Ably-only ToolProposed / resume races).
 * Latest open approval wins; cleared by resolve / tool terminal / run terminal.
 */
export function derivePendingApprovalFromEvents(
  events: readonly AgentOsEvent[]
): AgentOsPendingApproval | null {
  const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
  let lastProposed: {
    toolId: string;
    toolCallId: string;
    arguments: unknown;
  } | null = null;
  let pending: AgentOsPendingApproval | null = null;

  for (const event of sorted) {
    if (event.type === "ToolProposed") {
      lastProposed = {
        toolId: String(event.data.toolId ?? "tool"),
        toolCallId: String(event.data.toolCallId ?? ""),
        arguments: event.data.arguments,
      };
      // Provisional — until ApprovalRequired supplies approvalId.
      if (lastProposed.toolCallId) {
        pending = {
          kind: "tool_approval",
          toolId: lastProposed.toolId,
          toolCallId: lastProposed.toolCallId,
          arguments: lastProposed.arguments,
          title: `Approve ${lastProposed.toolId}`,
          description: "Sensitive write requires approval.",
          approvalId: `pending:${lastProposed.toolCallId}`,
        };
      }
      continue;
    }
    if (event.type === "ApprovalRequired") {
      const toolCallId = String(event.data.toolCallId ?? lastProposed?.toolCallId ?? "");
      const toolId =
        lastProposed && lastProposed.toolCallId === toolCallId
          ? lastProposed.toolId
          : String(event.data.toolId ?? lastProposed?.toolId ?? "tool");
      const approvalId = String(event.data.approvalId ?? "").trim();
      if (!toolCallId || !approvalId) continue;
      pending = {
        kind: "tool_approval",
        toolId,
        toolCallId,
        arguments:
          lastProposed && lastProposed.toolCallId === toolCallId
            ? lastProposed.arguments
            : event.data.arguments,
        title: String(event.data.title ?? `Approve ${toolId}`),
        description: String(event.data.description ?? "Sensitive write requires approval."),
        approvalId,
      };
      continue;
    }
    if (
      event.type === "ApprovalResolved" ||
      event.type === "ToolStarted" ||
      event.type === "ToolCompleted" ||
      event.type === "ToolFailed" ||
      event.type === "RunCompleted" ||
      event.type === "RunCancelled" ||
      event.type === "RunFailed"
    ) {
      pending = null;
    }
  }
  return pending;
}

function workbenchContextFromEvents(
  events: readonly AgentOsEvent[]
): AgentOsWorkbenchContext | null {
  const value = events.find((event) => event.type === "RunStarted")?.data.workbenchContext;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.some(([, item]) => typeof item !== "string")) return null;
  return Object.fromEntries(entries) as AgentOsWorkbenchContext;
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
  events: AgentOsEvent[];
  assistantText: string | null;
  error: string | null;
  errorCode: string | null;
} {
  const ordered = [...buffers].sort((a, b) => a.order - b.order);
  const messages: AgentOsChatMessage[] = [];
  let last: RunBuffer | null = null;

  for (const buf of ordered) {
    const messageStart = messages.length;
    last = buf;
    const events = [...buf.eventsBySeq.values()].sort((a, b) => a.sequence - b.sequence);
    buf.workbenchContext = workbenchContextFromEvents(events) ?? buf.workbenchContext;
    const optimisticReject = buf.optimisticDecisions.some((d) => d.meta?.decision === "reject");
    const optimisticApprove = buf.optimisticDecisions.some((d) => d.meta?.decision === "approve");
    // Event-derived status / HITL override stale buffer "running".
    // Client-side decision already made: do not resurrect HITL from a journal
    // that still only has ApprovalRequired (API lag).
    const derivedPending =
      optimisticReject || optimisticApprove
        ? null
        : (buf.pendingApproval ?? derivePendingApprovalFromEvents(events));
    let status = deriveStatusFromEvents(events, buf.status);
    if (optimisticReject) {
      status = "cancelled";
    } else if (optimisticApprove && status === "waiting_for_approval") {
      status = "running";
    } else if (derivedPending && (status === "running" || status === "idle")) {
      status = "waiting_for_approval";
    }
    if (!derivedPending && status === "waiting_for_approval") {
      // Open approval was cleared by later events; fall back to event terminal.
      status = deriveStatusFromEvents(events, "running");
      if (status === "waiting_for_approval") status = "running";
    }
    // Keep buffer in sync so subsequent publishes stay consistent.
    if (derivedPending) {
      buf.pendingApproval = derivedPending;
    } else if (status !== "waiting_for_approval") {
      buf.pendingApproval = null;
    }
    buf.status = status;

    let rebuilt = rebuildRunTimelineFromEvents(events, buf.runId, status);

    const hasUser = rebuilt.some((m) => m.role === "user" && m.meta?.kind !== "approval_decision");
    if (!hasUser && buf.optimisticUser) {
      const u = buf.optimisticUser;
      rebuilt = [
        {
          id: u.id,
          role: "user",
          content: u.content,
          createdAt: u.createdAt,
          runId: buf.runId,
          meta: u.attachmentNames?.length
            ? { attachmentNames: u.attachmentNames, optimistic: true }
            : { optimistic: true },
        },
        ...rebuilt,
      ];
    }

    // Snapshot assistantText only when this run has no assistant rows yet.
    if (
      !rebuilt.some((m) => m.role === "assistant") &&
      typeof buf.assistantText === "string" &&
      buf.assistantText.trim()
    ) {
      rebuilt = [
        ...rebuilt,
        {
          id: `assistant:stream:${buf.runId}:snap`,
          role: "assistant",
          content: buf.assistantText.trim(),
          createdAt: new Date().toISOString(),
          runId: buf.runId,
          meta: {
            kind: status === "running" ? "streaming" : "message_completed",
            fromSnapshot: true,
          },
        },
      ];
    }

    // Interleave client-only approval decisions (until ApprovalResolved lands).
    const journalDecisions = new Set(
      rebuilt
        .filter((m) => m.meta?.kind === "approval_decision" && m.meta?.eventSequence != null)
        .map((m) => String(m.meta?.decision ?? ""))
    );
    const clientDecisions = buf.optimisticDecisions.filter((d) => {
      const dec = String(d.meta?.decision ?? "");
      return !journalDecisions.has(dec) || d.meta?.eventSequence == null;
    });
    // If journal already has ApprovalResolved, drop client mirrors.
    const hasJournalDecision = rebuilt.some(
      (m) => m.meta?.kind === "approval_decision" && m.meta?.eventSequence != null
    );
    const decisions = hasJournalDecision ? [] : clientDecisions;

    const withDecisions: AgentOsChatMessage[] = [];
    let di = 0;
    const sortedDec = [...decisions].sort(
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

    const pendingForCard = derivedPending ?? buf.pendingApproval;
    if (status === "waiting_for_approval" && pendingForCard) {
      const pa = pendingForCard;
      const approvalId = `approval:${buf.runId}:${pa.approvalId}`;
      if (!messages.some((m) => m.id === approvalId)) {
        messages.push({
          id: approvalId,
          role: "approval",
          content: pa.title,
          createdAt: new Date().toISOString(),
          runId: buf.runId,
          meta: {
            toolId: pa.toolId,
            description: pa.description,
            arguments: pa.arguments,
            approvalId: pa.approvalId,
          },
        });
      }
    }

    if (
      status === "completed" &&
      !messages.some((m) => m.role === "assistant" && m.runId === buf.runId && m.content.trim())
    ) {
      messages.push({
        id: `system:empty:${buf.runId}`,
        role: "system",
        content:
          "Turn finished but no assistant text was returned. Check worker logs / model config.",
        createdAt: new Date().toISOString(),
        runId: buf.runId,
        meta: { kind: "empty_reply" },
      });
    }

    if (status === "failed" && buf.error?.message) {
      if (!messages.some((m) => m.id === `system:err:${buf.runId}`)) {
        messages.push({
          id: `system:err:${buf.runId}`,
          role: "system",
          content: buf.error.message,
          createdAt: new Date().toISOString(),
          runId: buf.runId,
          meta: { kind: "error", code: buf.error.code },
        });
      }
    }

    if (buf.workbenchContext) {
      for (let index = messageStart; index < messages.length; index += 1) {
        messages[index] = {
          ...messages[index]!,
          workbenchContext: buf.workbenchContext,
        };
      }
    }
  }

  const lastEvents = last
    ? [...last.eventsBySeq.values()].sort((a, b) => a.sequence - b.sequence)
    : [];

  // Session status = most recent run's event-derived status (not stale "running").
  let sessionStatus: AgentOsSessionState["status"] = last
    ? deriveStatusFromEvents([...last.eventsBySeq.values()], last.status)
    : "idle";
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    const b = ordered[i]!;
    const events = [...b.eventsBySeq.values()];
    const derived = b.pendingApproval ?? derivePendingApprovalFromEvents(events);
    let s = deriveStatusFromEvents(events, b.status);
    if (derived && (s === "running" || s === "idle")) {
      s = "waiting_for_approval";
    }
    if (
      s === "waiting_for_approval" ||
      s === "running" ||
      s === "completed" ||
      s === "failed" ||
      s === "cancelled"
    ) {
      sessionStatus = s;
      last = b;
      if (derived) b.pendingApproval = derived;
      else if (s !== "waiting_for_approval") b.pendingApproval = null;
      // Prefer the latest run that still needs user action, else latest terminal.
      if (s === "waiting_for_approval" || s === "running") break;
    }
  }

  const assistantText =
    [...messages].reverse().find((m) => m.role === "assistant")?.content ??
    last?.assistantText ??
    null;

  return {
    messages,
    runId: last?.runId ?? null,
    status: sessionStatus,
    pendingApproval:
      sessionStatus === "waiting_for_approval"
        ? (last?.pendingApproval ??
          (last ? derivePendingApprovalFromEvents([...last.eventsBySeq.values()]) : null))
        : null,
    events: lastEvents,
    assistantText,
    error: sessionStatus === "failed" ? (last?.error?.message ?? null) : null,
    errorCode: sessionStatus === "failed" ? (last?.error?.code ?? null) : null,
  };
}

/** Flatten durable journal runs into conversation buffers then rebuild. */
export function messagesFromConversationHistory(
  runs: Array<{
    runId: string;
    status: string;
    events: AgentOsEvent[];
    pendingApproval?: AgentOsPendingApproval | null;
    assistantText?: string | null;
  }>
): {
  messages: AgentOsChatMessage[];
  runId: string | null;
  status: AgentOsSessionState["status"];
  pendingApproval: AgentOsPendingApproval | null;
  events: AgentOsEvent[];
} {
  const buffers: RunBuffer[] = runs.map((run, index) => {
    const buf = emptyRunBuffer(run.runId, index);
    buf.status = run.status;
    buf.pendingApproval = (run.pendingApproval as AgentOsPendingApproval | null) ?? null;
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
    // Hydrate: don't leave the UI stuck in "running" if the process died.
    status: rebuilt.status === "running" ? "completed" : rebuilt.status,
    pendingApproval: rebuilt.pendingApproval,
    events: rebuilt.events,
  };
}

const LS_CONVERSATION_PREFIX = "fizz:agent-os:conversationId:";

export function agentOsConversationStorageKey(projectId: string): string {
  return `${LS_CONVERSATION_PREFIX}${projectId}`;
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

function statusFromEventType(type: string): AgentOsRunStatus | string {
  switch (type) {
    case "RunCompleted":
      return "completed";
    case "RunFailed":
      return "failed";
    case "RunCancelled":
      return "cancelled";
    case "RunPaused":
    case "ApprovalRequired":
      return "waiting_for_approval";
    case "ApprovalResolved":
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

  /** Conversation-scoped event buffers — source of truth for transcript. */
  const runsRef = useRef(new Map<string, RunBuffer>());
  const nextRunOrder = useRef(0);
  /** Optimistic user before startRun returns a runId. */
  const pendingUserRef = useRef<OptimisticUser | null>(null);

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
            meta: p.attachmentNames?.length
              ? { attachmentNames: p.attachmentNames, optimistic: true }
              : { optimistic: true },
          },
        ];
      }
    }
    setState({
      status: rebuilt.status === "idle" && messages.length > 0 ? "completed" : rebuilt.status,
      runId: rebuilt.runId,
      conversationId: conversationRef.current,
      messages,
      events: rebuilt.events,
      pendingApproval: rebuilt.pendingApproval,
      assistantText: rebuilt.assistantText,
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
        for (const event of input.events) {
          buf.eventsBySeq.set(event.sequence, event);
        }
        if (buf.eventsBySeq.size > 0) {
          lastSequenceByRun.current.set(input.runId, Math.max(...buf.eventsBySeq.keys()));
        }
        // Durable UserMessage → drop optimistic user for this run.
        const hasUserMessage = [...buf.eventsBySeq.values()].some((e) => e.type === "UserMessage");
        if (hasUserMessage) buf.optimisticUser = null;
        // Journal ApprovalResolved → drop client decision mirrors + leave HITL.
        const hasResolved = [...buf.eventsBySeq.values()].some(
          (e) => e.type === "ApprovalResolved"
        );
        if (hasResolved) {
          buf.optimisticDecisions = [];
          if (buf.status === "waiting_for_approval") {
            buf.status = mergeRunStatus(buf.status, "running", {
              allowResumeFromWaiting: true,
            });
          }
        }
      }
      if (input.pendingApproval !== undefined) {
        buf.pendingApproval = input.pendingApproval;
      }
      if (buf.status === "completed" || buf.status === "failed" || buf.status === "cancelled") {
        buf.pendingApproval = null;
      }
      if (typeof input.assistantText === "string") {
        buf.assistantText = input.assistantText;
      }
      if (input.error !== undefined) {
        buf.error = input.error;
      }
      activeRunIdRef.current = input.runId;
      publishFromBuffers();
    },
    [ensureRunBuffer, publishFromBuffers]
  );

  const mergeResponseRef = useRef(applyToRunBuffer);
  useEffect(() => {
    mergeResponseRef.current = applyToRunBuffer;
  }, [applyToRunBuffer]);

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
            const mapped = statusFromEventType(event.type);
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
          },
          onSnapshot: (snapshot: AgentOsAblyRunSnapshot) => {
            // Status + pending + assistantText only — never wipe event buffers.
            mergeResponseRef.current({
              runId: snapshot.runId,
              status: snapshot.status,
              assistantText: snapshot.assistantText,
              pendingApproval:
                snapshot.status === "waiting_for_approval"
                  ? ((snapshot.pendingApproval as AgentOsPendingApproval | null) ?? null)
                  : null,
              allowResumeFromWaiting: true,
            });
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
      const started = Date.now();
      const maxMs = 10 * 60_000;
      /**
       * Give up on CONSECUTIVE failures, never on elapsed time.
       *
       * Measuring from the poll's start meant any turn longer than 15s died on
       * its first transient error — and it died by throwing out of a
       * fire-and-forget call, so nothing was shown: the transcript simply froze
       * on "Working…" with the composer locked. This loop is the ONLY transport
       * when Ably is not live, which is the case the design exists for (Front
       * Door does not pass SSE), so it has to survive a blip and has to speak up
       * when it truly cannot.
       */
      let consecutiveFailures = 0;
      const maxConsecutiveFailures = 8;
      /**
       * A run the worker does not have is not running.
       *
       * The gateway asks the worker first and only falls back to the durable
       * journal when the worker does not report the run as open — so
       * `source: "postgres"` while the row still says "running" means the
       * process that owned this turn is gone (a restart, a crash, a deploy).
       * The journal will say "running" forever, so without this the panel
       * spins on reopen until the poll window closes ten minutes later.
       *
       * Requires a few observations because the worker client does not check
       * res.ok — one transient error also lands on the journal.
       */
      let orphanObservations = 0;
      const orphanThreshold = 3;

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

      while (!ac.signal.aborted && Date.now() - started < maxMs) {
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
            assistantText: page.assistantText,
            allowResumeFromWaiting: true,
          });
          consecutiveFailures = 0;
          if (TERMINAL.has(page.status)) {
            pollAborts.current.delete(runId);
            return page;
          }
          if (page.status === "running" && page.source === "postgres") {
            orphanObservations += 1;
            if (orphanObservations >= orphanThreshold) {
              giveUp("AGENT_OS_RUN_ORPHANED", "");
              return;
            }
          } else {
            orphanObservations = 0;
          }
        } catch (error) {
          if (ac.signal.aborted) return;
          consecutiveFailures += 1;
          justFailed = true;
          if (consecutiveFailures >= maxConsecutiveFailures) {
            giveUp("AGENT_OS_POLL_LOST", error instanceof Error ? error.message : String(error));
            return;
          }
        }
        const base = ablyConnected.current || ablyLive.current.isLive ? 1_500 : 120;
        // Back off while failing so a struggling gateway is not hammered at 8/s.
        const intervalMs = justFailed ? Math.min(base * 2 ** consecutiveFailures, 5_000) : base;
        await new Promise((r) => setTimeout(r, intervalMs));
      }

      if (!ac.signal.aborted) {
        // The window closed with the run still open. Saying so is honest and
        // unlocks the composer; leaving it spinning is neither.
        giveUp("AGENT_OS_POLL_TIMEOUT", "");
        return;
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
        runsRef.current = new Map();
        nextRunOrder.current = 0;
        for (const run of history.runs) {
          const buf = emptyRunBuffer(run.runId, nextRunOrder.current);
          nextRunOrder.current += 1;
          buf.status = run.status;
          buf.pendingApproval = (run.pendingApproval as AgentOsPendingApproval | null) ?? null;
          buf.assistantText = run.assistantText ?? null;
          for (const event of run.events) {
            buf.eventsBySeq.set(event.sequence, event);
          }
          runsRef.current.set(run.runId, buf);
          if (buf.eventsBySeq.size > 0) {
            lastSequenceByRun.current.set(run.runId, Math.max(...buf.eventsBySeq.keys()));
          }
        }
        publishFromBuffers();
        const rebuilt = rebuildConversationMessages(runsRef.current.values());
        if (rebuilt.runId) activeRunIdRef.current = rebuilt.runId;
        if (
          rebuilt.runId &&
          history.conversationId &&
          (rebuilt.status === "waiting_for_approval" || rebuilt.status === "running")
        ) {
          void ensureAbly(history.conversationId).then(() => {
            if (rebuilt.status === "running" && rebuilt.runId) {
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
      const optimistic: OptimisticUser = {
        id: newId(),
        content: text || "(attachment)",
        createdAt: new Date().toISOString(),
        attachmentNames: names.length > 0 ? names : undefined,
      };
      pendingUserRef.current = optimistic;
      setState((prev) => ({
        ...prev,
        status: "running",
        conversationId,
        error: null,
        pendingApproval: null,
      }));
      publishFromBuffers();

      try {
        void ensureAbly(conversationId);
        const response = await agentOsApi.startRun({
          projectId,
          message: text || "Please analyze the attached file(s).",
          modelProfileId: input.modelProfileId,
          conversationId,
          attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
          permissionMode: input.permissionMode,
          workbenchMode: input.workbenchMode,
          workbenchContext: input.workbenchContext,
          skillIds: input.skillIds,
          projectSkillInstallationIds: input.projectSkillInstallationIds,
          disabledDefaultSkillInstallationIds: input.disabledDefaultSkillInstallationIds,
        });

        // Bind optimistic user to this run *before* merging events.
        pendingUserRef.current = null;
        const buf = ensureRunBuffer(response.runId);
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
          assistantText: response.assistantText,
          allowResumeFromWaiting: true,
        });

        await ensureAbly(conversationId);
        // Fire-and-forget: a second send must not await this poll.
        if (
          response.status === "running" ||
          response.status === "queued" ||
          response.status === "paused"
        ) {
          void pollRun(response.runId);
        }
        return response;
      } catch (error) {
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
              meta: optimistic.attachmentNames
                ? { attachmentNames: optimistic.attachmentNames }
                : undefined,
            },
            {
              id: newId(),
              role: "system",
              content: message,
              createdAt: new Date().toISOString(),
              meta: { kind: "error" },
            },
          ],
        }));
        throw error;
      }
    },
    [applyToRunBuffer, ensureAbly, ensureRunBuffer, pollRun, projectId, publishFromBuffers]
  );

  const resolveApproval = useCallback(
    async (input: {
      decision: "approve" | "reject";
      modelProfileId: string;
      permissionMode?: "ask" | "smart" | "full";
    }) => {
      const runId = activeRunIdRef.current ?? state.runId;
      const conversationId = conversationRef.current;
      if (!runId || !conversationId) {
        throw new Error("No active turn to approve");
      }
      const afterSequence = lastSequenceByRun.current.get(runId) ?? 0;
      const decisionMsg: AgentOsChatMessage = {
        id: newId(),
        role: "user",
        content: input.decision === "approve" ? "Approved write" : "Rejected write",
        createdAt: new Date().toISOString(),
        runId,
        meta: {
          kind: "approval_decision",
          decision: input.decision,
          afterSequence,
        },
      };
      const buf = ensureRunBuffer(runId);
      buf.optimisticDecisions = [...buf.optimisticDecisions, decisionMsg];
      // Reject ends the turn — do not flip to "running" or Working/spinner sticks.
      buf.status = input.decision === "reject" ? "cancelled" : "running";
      buf.pendingApproval = null;
      publishFromBuffers();

      try {
        const response = await agentOsApi.resolveApproval({
          runId,
          decision: input.decision,
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
          assistantText: response.assistantText,
          allowResumeFromWaiting: true,
        });
        if (
          response.status === "running" ||
          response.status === "queued" ||
          response.status === "paused"
        ) {
          void pollRun(runId);
        }
        return response;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Approval failed";
        buf.optimisticDecisions = buf.optimisticDecisions.filter((d) => d.id !== decisionMsg.id);
        publishFromBuffers();
        setState((prev) => ({
          ...prev,
          status: "failed",
          error: message,
          messages: [
            ...prev.messages,
            {
              id: newId(),
              role: "system",
              content: message,
              createdAt: new Date().toISOString(),
              meta: { kind: "error" },
            },
          ],
        }));
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
    conversationRef.current = null;
    lastSequenceByRun.current = new Map();
    activeRunIdRef.current = null;
    runsRef.current = new Map();
    nextRunOrder.current = 0;
    pendingUserRef.current = null;
    writeStoredConversationId(projectId, null);
    setState(initial);
  }, [projectId]);

  const stop = useCallback(
    (label = "Stopped") => {
      for (const ac of pollAborts.current.values()) ac.abort();
      pollAborts.current.clear();
      const runId = activeRunIdRef.current;
      if (runId) {
        void agentOsApi.cancelRun(runId, projectId, label).catch(() => {
          /* best-effort */
        });
        const buf = runsRef.current.get(runId);
        if (buf) {
          buf.status = "cancelled";
          buf.pendingApproval = null;
        }
      }
      pendingUserRef.current = null;
      publishFromBuffers();
      setState((prev) => {
        if (prev.status !== "running" && prev.status !== "waiting_for_approval") {
          return { ...prev, status: "cancelled", pendingApproval: null };
        }
        return {
          ...prev,
          status: "cancelled",
          pendingApproval: null,
          messages: [
            ...prev.messages,
            {
              id: newId(),
              role: "system",
              content: label,
              createdAt: new Date().toISOString(),
              meta: { kind: "stopped" },
            },
          ],
        };
      });
    },
    [projectId, publishFromBuffers]
  );

  return { state, send, resolveApproval, newChat, stop, reset: newChat };
}
