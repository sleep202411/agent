import type { AgentConversationGrant } from "@repo/shared/agent-platform";

/** The single-conversation product grant consumed by the Ably client. */
export type StudioAgentRealtimeGrant = AgentConversationGrant;

export const STUDIO_AGENT_REALTIME_UNAVAILABLE_MESSAGE =
  "The realtime connection is unavailable. Reconnect and try again.";

/** A realtime failure the client cannot retry without renewing authorization. */
export class StudioAgentRealtimeError extends Error {
  readonly terminal: boolean;

  constructor(message: string, terminal: boolean, options?: ErrorOptions) {
    super(message, options);
    this.name = "StudioAgentRealtimeError";
    this.terminal = terminal;
  }
}

export function studioAgentRealtimeUnavailableError(): StudioAgentRealtimeError {
  return new StudioAgentRealtimeError(STUDIO_AGENT_REALTIME_UNAVAILABLE_MESSAGE, true);
}
