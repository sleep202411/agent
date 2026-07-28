/**
 * The server's authorization to join one thread's conversation channel.
 *
 * The account key never reaches the browser. The server mints a token scoped to
 * one channel and re-runs the thread's authorization on every mint, so a
 * revoked grant stops working at the next renewal rather than at the next page
 * load. `@ably/ai-transport` needs `subscribe` (agent output), `publish` (the
 * creator's prompts, steers, and cancels) and `history` (`view.loadOlder`);
 * the capability string is the server's to sign and this file never inspects it.
 *
 * The channel name is likewise the server's to choose, not ours to construct: it
 * has to match the capability that was signed into the same token, and a client
 * that rebuilt the name itself could drift from it silently.
 */

/** A signed, single-use Ably token request. */
export interface StudioAgentRealtimeTokenRequest {
  keyName: string;
  mac: string;
  nonce: string;
  timestamp: number;
  capability: string;
  clientId?: string;
  ttl?: number;
}

export interface StudioAgentRealtimeGrant {
  channel: string;
  ttlMs: number;
  tokenRequest: StudioAgentRealtimeTokenRequest;
}

/** A pipe failure the client cannot retry its way out of (auth, capability). */
export class StudioAgentRealtimeError extends Error {
  readonly terminal: boolean;

  constructor(message: string, terminal: boolean, options?: ErrorOptions) {
    super(message, options);
    this.name = "StudioAgentRealtimeError";
    this.terminal = terminal;
  }
}

/**
 * Validates the server's grant before it is handed to the SDK.
 *
 * A malformed grant otherwise surfaces as an opaque Ably connection failure
 * several seconds later, which is a miserable thing to debug.
 */
export function parseStudioAgentRealtimeGrant(value: unknown): StudioAgentRealtimeGrant {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StudioAgentRealtimeError("Studio Agent realtime grant is not an object.", true);
  }
  const grant = value as Record<string, unknown>;
  const channel = grant.channel;
  if (typeof channel !== "string" || channel.trim().length === 0) {
    throw new StudioAgentRealtimeError("Studio Agent realtime grant has no channel.", true);
  }
  const ttlMs = grant.ttlMs;
  if (typeof ttlMs !== "number" || !Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new StudioAgentRealtimeError("Studio Agent realtime grant has no lifetime.", true);
  }
  const request = grant.tokenRequest;
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new StudioAgentRealtimeError("Studio Agent realtime grant has no token request.", true);
  }
  const token = request as Record<string, unknown>;
  for (const field of ["keyName", "mac", "nonce", "capability"] as const) {
    if (typeof token[field] !== "string" || token[field].length === 0) {
      throw new StudioAgentRealtimeError(
        `Studio Agent realtime token request is missing ${field}.`,
        true
      );
    }
  }
  if (typeof token.timestamp !== "number" || !Number.isFinite(token.timestamp)) {
    throw new StudioAgentRealtimeError(
      "Studio Agent realtime token request is missing timestamp.",
      true
    );
  }
  return { channel, ttlMs, tokenRequest: token as unknown as StudioAgentRealtimeTokenRequest };
}
