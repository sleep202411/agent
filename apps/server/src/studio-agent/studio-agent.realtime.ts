import { Inject, Injectable, type Provider } from '@nestjs/common';
import {
  STUDIO_AGENT_CLIENT_CHANNEL_CAPABILITY,
  studioAgentThreadChannel,
} from '@repo/shared/studio-agent-transport';
import * as Ably from 'ably';
import { StudioAgentConfigService } from './studio-agent.config';

/**
 * THE ONLY MODULE IN THE SERVER THAT MAY IMPORT THE ABLY SDK — and it mints
 * credentials, nothing else.
 *
 * The server does not publish. Delivery is `@ably/ai-transport`, driven by the
 * Temporal activity worker inside an `AgentSession`; Nest holds no run, so it
 * has nothing truthful to say on the channel. That is the whole boundary, and
 * `studio-agent.publish-boundary.spec.ts` asserts it rather than trusting
 * anyone to remember.
 *
 * ROOT KEY HANDLING. `ABLY_API_KEY` is a ROOT credential: its capability is
 * `{"[*]*":["*"]}`, every operation on every channel of the app. Here it is
 * used for exactly one thing — signing token requests, locally, with an HMAC —
 * and it never leaves the process. It is never logged either.
 */

/**
 * A signed Ably token request. Safe to hand to the browser that asked for it:
 * `mac` is a signature over the other fields, never the key secret.
 *
 * Declared here rather than re-exported from the SDK so no other module —
 * including the controller that returns it — has to name an Ably type.
 */
export interface StudioAgentAblyTokenRequest {
  keyName: string;
  clientId: string;
  capability: string;
  timestamp: number;
  nonce: string;
  mac: string;
  ttl: number;
}

export interface StudioAgentRealtimeGrant {
  channel: string;
  ttlMs: number;
  tokenRequest: StudioAgentAblyTokenRequest;
}

/**
 * Exactly the slice of the Ably SDK this server uses: ONE method.
 *
 * Narrow on purpose. It is the seam that lets the token policy be tested
 * without an Ably account, and it makes the total surface we depend on legible
 * in four lines instead of an SDK's worth of `.d.ts`.
 *
 * There is no `close()`. There was one — empty, with a comment saying it
 * existed "so the DI lifecycle is symmetric with anything that later does" —
 * and it bought a Nest shutdown hook, a spy test and an interface member for a
 * resource that does not exist: `Ably.Rest` holds no connection, no socket and
 * no timer. A lifecycle hook for a thing with no lifecycle is a claim that
 * something is being cleaned up. If this ever grows a `Realtime` client, it
 * grows a `close()` at the same moment, for a reason.
 */
export interface StudioAgentAblyTokenSigner {
  createTokenRequest(params: {
    capability: Record<string, readonly string[]>;
    clientId: string;
    ttl: number;
  }): Promise<StudioAgentAblyTokenRequest>;
}

export const STUDIO_AGENT_ABLY_TOKEN_SIGNER = Symbol(
  'STUDIO_AGENT_ABLY_TOKEN_SIGNER',
);

/**
 * `Ably.Rest`, not `Ably.Realtime`.
 *
 * The server publishes nothing, so a persistent realtime connection would be a
 * socket per replica held open for no reason — and on the free plan the account
 * ceiling is 200 concurrent connections, which the worker's publishing
 * connections actually need. Signing is a local HMAC over the request with the
 * key secret: no call leaves the process, which is both why the secret never
 * travels and why minting keeps working when Ably is unreachable.
 */
export function createStudioAgentAblyTokenSigner(
  apiKey: string,
): StudioAgentAblyTokenSigner {
  if (!/^[\w-]+\.[\w-]+:[\w+/=-]+$/.test(apiKey)) {
    // The point of use. The config service already refuses to load without a
    // well-formed key, so this is the second of two locked doors — but it is
    // the one standing where the credential is actually used, and a server that
    // quietly came up unable to mint tokens would leave every creator staring
    // at an assistant that never connects.
    throw new Error(
      'ABLY_API_KEY is missing or malformed: Studio Agent cannot mint realtime credentials without a complete Ably API key.',
    );
  }
  const client = new Ably.Rest({ key: apiKey });
  return {
    createTokenRequest: async (params) => {
      const signed = await client.auth.createTokenRequest({
        capability: params.capability as Ably.TokenParams['capability'],
        clientId: params.clientId,
        ttl: params.ttl,
      });
      // Mapped field by field rather than spread: this response is public, and
      // a future SDK version adding a field would otherwise ship it to a
      // browser without anyone deciding to.
      return {
        keyName: signed.keyName,
        clientId: signed.clientId ?? params.clientId,
        capability: signed.capability,
        timestamp: signed.timestamp,
        nonce: signed.nonce,
        mac: signed.mac,
        ttl: signed.ttl ?? params.ttl,
      };
    },
  };
}

export const studioAgentAblyTokenSignerProvider: Provider = {
  provide: STUDIO_AGENT_ABLY_TOKEN_SIGNER,
  inject: [StudioAgentConfigService],
  useFactory: (config: StudioAgentConfigService): StudioAgentAblyTokenSigner =>
    createStudioAgentAblyTokenSigner(config.value.ably.apiKey),
};

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
    @Inject(STUDIO_AGENT_ABLY_TOKEN_SIGNER)
    private readonly signer: StudioAgentAblyTokenSigner,
    private readonly config: StudioAgentConfigService,
  ) {}

  async issueThreadToken(
    threadId: string,
    actorId: string,
  ): Promise<StudioAgentRealtimeGrant> {
    const channel = studioAgentThreadChannel(threadId);
    const ttlMs = this.config.value.ably.tokenTtlMs;
    const tokenRequest = await this.signer.createTokenRequest({
      capability: { [channel]: STUDIO_AGENT_CLIENT_CHANNEL_CAPABILITY },
      clientId: actorId,
      ttl: ttlMs,
    });
    return { channel, ttlMs, tokenRequest };
  }
}
