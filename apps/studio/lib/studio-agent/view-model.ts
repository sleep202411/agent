/**
 * UI-only projections for the Studio Agent surface.
 *
 * Persisted runtime DTOs live in @repo/shared. These types deliberately model
 * only what the Studio UI needs after an adapter has normalized a runtime
 * event. Keeping that boundary explicit prevents the renderer from becoming a
 * second source of truth for the agent protocol.
 */

import type {
  StudioAgentActivityKind as RuntimeStudioAgentActivityKind,
  StudioAgentApprovalStatus as RuntimeStudioAgentApprovalStatus,
  StudioAgentEvent,
  StudioAgentInput,
  StudioAgentInputDelivery,
  StudioAgentMessagePart,
  StudioAgentPermissionMode as RuntimeStudioAgentPermissionMode,
  StudioAgentRiskLevel,
  StudioAgentRunStatus as RuntimeStudioAgentRunStatus,
} from "@repo/shared";

export type StudioAgentRunStatus = RuntimeStudioAgentRunStatus;

export type StudioAgentActivityStatus = "running" | "succeeded" | "failed" | "cancelled";

export type StudioAgentApprovalStatus = RuntimeStudioAgentApprovalStatus;

export type StudioAgentDeliveryMode = "send" | StudioAgentInputDelivery;

export type StudioAgentPermissionMode = RuntimeStudioAgentPermissionMode;

export type StudioAgentActivityKind = RuntimeStudioAgentActivityKind;

export interface StudioAgentRunView {
  id: string;
  parentRunId: string | null;
  title: string;
  summary: string | null;
  status: StudioAgentRunStatus;
  progress: number | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  sequence: number;
}

export type StudioAgentTerminalRunView = StudioAgentRunView & {
  status: "failed" | "cancelled";
};

export interface StudioAgentMessageView {
  /** Segment id for streamed assistant output; message id for hydrated user input. */
  id: string;
  messageId: string;
  clientMessageId: string | null;
  runId: string | null;
  role: "user" | "assistant";
  format: "plain_text" | "markdown";
  text: string;
  attachments: Extract<StudioAgentMessagePart, { type: "attachment" }>[];
  status: "accepted" | "streaming" | "completed" | "failed" | "cancelled";
  createdAt: string;
  sequence: number;
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
  /** Original activity.started event sequence. */
  sequence: number;
  /** Most recent activity lifecycle event sequence. */
  lastSequence: number;
}

export interface StudioAgentApprovalView {
  id: string;
  runId: string;
  actionInputHash: string;
  capability: string;
  capabilityVersion: string | null;
  title: string;
  description: string | null;
  risk: StudioAgentRiskLevel;
  status: StudioAgentApprovalStatus;
  resolution: string | null;
  createdAt: string;
  resolvedAt: string | null;
  sequence: number;
}

export interface StudioAgentContextCompactionView {
  id: string;
  runId: string | null;
  coveredMessageCount: number;
  retainedMessageCount: number;
  occurredAt: string;
  sequence: number;
}

export interface StudioAgentThreadCursor {
  eventId: string;
  sequence: number;
  value: string;
}

export interface StudioAgentProtocolIssue {
  code: "THREAD_MISMATCH" | "SEQUENCE_COLLISION" | "INVALID_SEQUENCE";
  eventId: string;
  sequence: number;
}

export interface StudioAgentEventState {
  threadId: string;
  /**
   * Highest sequence that was already represented by the snapshot used to
   * create this state.
   */
  baseSequence: number;
  cursor: StudioAgentThreadCursor | null;
  journal: StudioAgentEvent[];
  eventIds: Record<string, true>;
  sequenceEventIds: Record<number, string>;
  runs: Record<string, StudioAgentRunView>;
  messages: Record<string, StudioAgentMessageView>;
  activities: Record<string, StudioAgentActivityView>;
  actions: Record<
    string,
    {
      id: string;
      capability: string;
      capabilityVersion: string;
      title: string;
      summary: string;
      risk: StudioAgentRiskLevel;
    }
  >;
  approvals: Record<string, StudioAgentApprovalView>;
  contextCompactions: Record<string, StudioAgentContextCompactionView>;
  inputs: Record<string, StudioAgentInput>;
  issues: StudioAgentProtocolIssue[];
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

export type StudioAgentTimelineItemView =
  | { kind: "message"; id: string; sequence: number; message: StudioAgentMessageView }
  | { kind: "activity"; id: string; sequence: number; activity: StudioAgentActivityView }
  | { kind: "approval"; id: string; sequence: number; approval: StudioAgentApprovalView }
  | { kind: "run"; id: string; sequence: number; run: StudioAgentTerminalRunView }
  | {
      kind: "context_compaction";
      id: string;
      sequence: number;
      compaction: StudioAgentContextCompactionView;
    };
