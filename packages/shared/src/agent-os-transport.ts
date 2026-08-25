/**
 * Agent OS realtime transport (Ably) + workbench identity.
 *
 * Skills (system + future catalog/project/turn) are owned by @repo/agent-skills.
 * Workbench mode selects which system base skills mount for the product view.
 *
 * Delivery model:
 * - Worker publishes product events with a root key (never to the browser).
 * - Nest mints a short-lived token for exactly one conversation channel.
 * - Browser subscribes only; start / approve / cancel stay on HTTP.
 * - Postgres journal remains the durable source of truth; Ably accelerates.
 */

export const PLATFORM_AGENT_WORKBENCH_MODES = ["storyboard", "canvas", "brief"] as const;
export type PlatformAgentWorkbenchMode = (typeof PLATFORM_AGENT_WORKBENCH_MODES)[number];

/** Map a Platform Studio route mode to its Agent OS workbench mode. */
export function agentOsWorkbenchModeFromStudioMode(
  mode: string | null | undefined
): PlatformAgentWorkbenchMode {
  if (mode === "storyboard") return "storyboard";
  if (mode === "brief") return "brief";
  if (mode === "canvas") return "canvas";
  throw new Error(`Unsupported Agent OS Platform workbench mode: ${String(mode)}`);
}

export const AGENT_OS_CHANNEL_NAMESPACE = "agent-os" as const;

export const AGENT_OS_CONVERSATION_CHANNEL_PREFIX =
  `${AGENT_OS_CHANNEL_NAMESPACE}:conversation:` as const;

/** Ably channel for one continuous Agent OS chat thread. */
export function agentOsConversationChannel(conversationId: string): string {
  return `${AGENT_OS_CONVERSATION_CHANNEL_PREFIX}${conversationId}`;
}

/**
 * Browser capability: read live events + history for reconnect.
 * No publish — user input and cancel go through Nest HTTP.
 */
export const AGENT_OS_CLIENT_CHANNEL_CAPABILITY = ["subscribe", "history"] as const;

/** Ably message name for a fizz.agent.v1 event envelope. */
export const AGENT_OS_ABLY_EVENT_NAME = "agent.event" as const;

/** Ably message name for a compact run status snapshot (not an event envelope). */
export const AGENT_OS_ABLY_SNAPSHOT_NAME = "run.snapshot" as const;

/**
 * Ably message name for a lightweight pointer back to the durable HTTP
 * journal. The realtime transport has a strict per-message byte ceiling, so a
 * large event or snapshot is represented by this pointer instead of being
 * retried forever and blocking the conversation outbox.
 */
export const AGENT_OS_ABLY_RESYNC_NAME = "run.resync" as const;

interface AgentOsAblyResyncPointerBase {
  version: 1;
  runId: string;
  conversationId: string;
  /** Durable sequence that must be present after the HTTP catch-up. */
  sequence: number;
  /** Fixed journal cursor. Never substitute the client's current max cursor. */
  afterSequence: number;
}

export interface AgentOsAblyEventResyncPointer extends AgentOsAblyResyncPointerBase {
  kind: "event_oversized";
  eventId: string;
}

export interface AgentOsAblySnapshotResyncPointer extends AgentOsAblyResyncPointerBase {
  kind: "snapshot_oversized";
}

/** A realtime nudge; the PostgreSQL journal remains the payload authority. */
export type AgentOsAblyResyncPointer =
  | AgentOsAblyEventResyncPointer
  | AgentOsAblySnapshotResyncPointer;

/**
 * PostgreSQL advisory-lock namespace for the one LangGraph writer allowed to
 * advance a conversation checkpoint thread.  Both the Nest control plane and
 * Agent OS Worker hash this exact value inside PostgreSQL; changing it is a
 * wire/storage migration, not a local implementation detail.
 */
export const AGENT_OS_CHECKPOINT_EXECUTION_LOCK_SEED = 1_907_443_517 as const;

export function agentOsCheckpointExecutionLockKey(conversationId: string): string {
  return `agent-os:checkpoint:conversation:${conversationId}`;
}

export interface AgentOsPendingExternal {
  kind: "external_job";
  jobId: string;
  startedMessage: string;
  turnId: string;
  toolCallId: string;
  toolId: string;
}

export interface AgentOsAblyRunSnapshot {
  runId: string;
  conversationId: string;
  status: string;
  lastSequence: number;
  assistantText?: string | null;
  pendingApproval?: unknown;
  pendingUserInput?: unknown;
  pendingExternal?: AgentOsPendingExternal | null;
}
