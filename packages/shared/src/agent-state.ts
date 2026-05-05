/**
 * Agent state — the project-scoped, server-authoritative state machine
 * for the StoryOS chat. Replaces the client-only `sending`/`streaming`
 * Redux flags so multi-tab / refresh / reconnect all read the same
 * truth, and the submit endpoint can refuse a second concurrent turn
 * for the same project (HTTP 409) instead of silently double-running.
 *
 * Single Redis key per project: `project:{projectId}:agent_state`.
 * State transitions are CAS-guarded in Lua so two concurrent submits
 * can't both win the gate.
 *
 * Pushed to subscribed WS clients via the existing
 * `chat:events:{projectId}` Redis pubsub channel as
 * `{ kind: "agent_state_changed", projectId, state }`.
 */

export type AgentStateKind = "idle" | "running" | "failed" | "cancelled";

export interface AgentState {
  kind: AgentStateKind;
  /** Set when kind === "running". Identifies the active turn so cancel /
   *  resume / heartbeat calls can target it. */
  turnId?: string;
  /** Unix ms when this state was entered. */
  enteredAt?: number;
  /** Set when kind === "failed". Surfaced in the chat composer as a
   *  "上次失败 — 重新发送" hint. Cleared by the next successful submit. */
  lastError?: string;
}

/** WS event broadcast on every state transition. The envelope uses
 *  `type` for the discriminator to match the existing chat-events
 *  StoreEvent union (message_added / message_updated / etc); inside,
 *  `state.kind` is the AgentStateKind. */
export interface AgentStateChangedEvent {
  type: "agent_state_changed";
  projectId: string;
  state: AgentState;
}

/** Conflict body returned when submit is blocked because another turn
 *  is already running. Frontend uses this to display the right hint
 *  instead of a generic "request failed". */
export interface AgentBusyConflict {
  code: "AGENT_BUSY";
  message: string;
  current: AgentState;
}

/** True when the user is allowed to submit a new message. Gate logic
 *  used by both the chat composer (UI disabled state) and the submit
 *  endpoint (server-side 409 gate). Single function so the rule lives
 *  in one place. */
export function canSubmit(state: AgentState | undefined): boolean {
  if (!state) return true;
  return state.kind !== "running";
}
