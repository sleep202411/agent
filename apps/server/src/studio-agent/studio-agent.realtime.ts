import { Injectable } from '@nestjs/common';
import {
  STUDIO_AGENT_CLIENT_CHANNEL_CAPABILITY,
  studioAgentThreadChannel,
} from '@repo/shared/studio-agent-transport';
import {
  InjectAblyTokenCredentials,
  type AblyTokenCredentials,
  type AblyTokenRequest,
} from '../infra/realtime/ably-token-credentials';
import { StudioAgentConfigService } from './studio-agent.config';

/**
 * The server does not publish. Delivery is `@ably/ai-transport`, driven by the
 * Temporal activity worker inside an `AgentSession`; Nest holds no run, so it
 * has nothing truthful to say on the channel. That is the whole boundary, and
 * `studio-agent.publish-boundary.spec.ts` asserts it rather than trusting
 * anyone to remember.
 */

/**
 * A signed Ably token request. Safe to hand to the browser that asked for it:
 * `mac` is a signature over the other fields, never the key secret.
 *
 * Declared here rather than re-exported from the SDK so no other module —
 * including the controller that returns it — has to name an Ably type.
 */
export type StudioAgentAblyTokenRequest = AblyTokenRequest;

export interface StudioAgentRealtimeGrant {
  channel: string;
  ttlMs: number;
  tokenRequest: StudioAgentAblyTokenRequest;
}

/**
 * Mints the credential a browser uses to take part in ONE thread.
 *
 * The policy, which is the security-relevant part and why this is its own unit:
 *
 *   Capability   exactly one channel — `studio-agent:thread:<threadId>` — with
 *                {@link STUDIO_AGENT_CLIENT_CHANNEL_CAPABILITY}. Not `["*"]`,
 *                and not `{"*": [...]}`: that second one is what a static
 *                shared key gives, i.e. every channel of every tenant with no
 *                way to withdraw it from one user.
 *   Operations   `subscribe` reads the turn; `publish` is REQUIRED because the
 *                client transport puts the user's own input and cancel on the
 *                channel before any HTTP request is made; `history` backs
 *                `view.loadOlder()`. Nothing else — no presence, no
 *                channel-metadata, no push. Publish rights are bounded by the
 *                resource, not by trust: the caller may only ever address the
 *                one thread they proved access to.
 *   clientId     the caller. It identifies the connection in Ably's own tooling
 *                and leaves per-client token revocation available without a
 *                redesign. It is server-set, so a client cannot impersonate
 *                another participant on the channel.
 *   TTL          short, for the reason written at the config knob.
 *
 * Authorization is deliberately NOT done here. The caller must already have
 * passed the same check the thread read path uses, and the controller runs it
 * immediately before every mint — so a grant revoked between two refreshes
 * stops being renewable at the next one.
 */
@Injectable()
export class StudioAgentAblyTokenIssuer {
  constructor(
    @InjectAblyTokenCredentials()
    private readonly credentials: AblyTokenCredentials,
    private readonly config: StudioAgentConfigService,
  ) {}

  async issueThreadToken(
    threadId: string,
    actorId: string,
  ): Promise<StudioAgentRealtimeGrant> {
    const channel = studioAgentThreadChannel(threadId);
    const ttlMs = this.config.value.ably.tokenTtlMs;
    const tokenRequest = await this.credentials.createTokenRequest({
      capability: { [channel]: STUDIO_AGENT_CLIENT_CHANNEL_CAPABILITY },
      clientId: actorId,
      ttlMs,
    });
    return { channel, ttlMs, tokenRequest };
  }
}
