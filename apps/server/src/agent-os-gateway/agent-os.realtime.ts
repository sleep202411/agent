import { Injectable } from '@nestjs/common';
import {
  AGENT_OS_CLIENT_CHANNEL_CAPABILITY,
  agentOsConversationChannel,
} from '@repo/shared';
import {
  InjectAblyTokenCredentials,
  type AblyTokenCredentials,
  type AblyTokenRequest,
} from '../infra/realtime/ably-token-credentials';

const DEFAULT_TOKEN_TTL_MS = 15 * 60_000;

export type AgentOsAblyTokenRequest = AblyTokenRequest;

export interface AgentOsRealtimeGrant {
  channel: string;
  ttlMs: number;
  /** Signed Ably TokenRequest — browser exchanges via Realtime auth. */
  tokenRequest: AgentOsAblyTokenRequest;
}

/**
 * Mints a short-lived Ably credential for exactly one Agent OS conversation.
 *
 * Capability is subscribe+history on `agent-os:conversation:<id>` only.
 * The browser never publishes; start / approve / cancel remain HTTP.
 * Authorization is the caller's responsibility (project membership).
 */
@Injectable()
export class AgentOsAblyTokenIssuer {
  constructor(
    @InjectAblyTokenCredentials()
    private readonly credentials: AblyTokenCredentials,
  ) {}

  async issueConversationToken(
    conversationId: string,
    actorId: string,
    ttlMs = DEFAULT_TOKEN_TTL_MS,
  ): Promise<AgentOsRealtimeGrant> {
    const channel = agentOsConversationChannel(conversationId);
    const tokenRequest = await this.credentials.createTokenRequest({
      capability: { [channel]: AGENT_OS_CLIENT_CHANNEL_CAPABILITY },
      clientId: actorId,
      ttlMs,
    });
    return { channel, ttlMs, tokenRequest };
  }
}
