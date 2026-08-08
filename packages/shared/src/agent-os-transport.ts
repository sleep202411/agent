/**
 * Agent OS realtime transport (Ably) + surface identity.
 *
 * Skills (system + future catalog/project/turn) are owned by @repo/agent-skills.
 * Surface only selects which system base skills mount for the Studio mode.
 *
 * Delivery model:
 * - Worker publishes product events with a root key (never to the browser).
 * - Nest mints a short-lived token for exactly one conversation channel.
 * - Browser subscribes only; start / approve / cancel stay on HTTP.
 * - Postgres journal remains the durable source of truth; Ably accelerates.
 */

/** Studio product surface the Agent OS panel is opened from. */
export const AGENT_OS_SURFACES = ["storyboard", "canvas", "brief"] as const;
export type AgentOsSurface = (typeof AGENT_OS_SURFACES)[number];

export function isAgentOsSurface(value: unknown): value is AgentOsSurface {
  return typeof value === "string" && (AGENT_OS_SURFACES as readonly string[]).includes(value);
}

/** Map Studio URL mode slug → Agent OS surface (system skill mount key). */
export function agentOsSurfaceFromStudioMode(mode: string | null | undefined): AgentOsSurface {
  if (mode === "storyboard") return "storyboard";
  if (mode === "brief") return "brief";
  if (mode === "canvas") return "canvas";
  // Unknown / retired modes (e.g. former "cast") → storyboard tools.
  return "storyboard";
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

export interface AgentOsAblyRunSnapshot {
  runId: string;
  conversationId: string;
  status: string;
  lastSequence: number;
  assistantText?: string | null;
  pendingApproval?: unknown;
}
