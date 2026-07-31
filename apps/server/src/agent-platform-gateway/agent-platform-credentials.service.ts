import {
  createPublicKey,
  randomUUID,
  sign,
  type JsonWebKey,
} from 'node:crypto';

import { Injectable } from '@nestjs/common';

import {
  InjectAblyTokenCredentials,
  type AblyTokenCredentials,
} from '../infra/realtime/ably-token-credentials';
import type { AuthorizedAgentContext } from './agent-platform-gateway.dto';
import { AgentPlatformGatewayConfigService } from './agent-platform-gateway.config';

@Injectable()
export class AgentPlatformCredentialsService {
  readonly #config: AgentPlatformGatewayConfigService['values'];
  readonly #jwks: Readonly<{ keys: readonly JsonWebKey[] }>;

  constructor(
    config: AgentPlatformGatewayConfigService,
    @InjectAblyTokenCredentials()
    private readonly ablyCredentials: AblyTokenCredentials,
  ) {
    this.#config = config.values;
    const publicJwk = createPublicKey(this.#config.signingPrivateKey).export({
      format: 'jwk',
    });
    this.#jwks = Object.freeze({
      keys: [
        Object.freeze({
          ...publicJwk,
          kid: this.#config.signingKeyId,
          alg: 'EdDSA',
          use: 'sig',
        }),
      ],
    });
  }

  jwks(): Readonly<{ keys: readonly JsonWebKey[] }> {
    return this.#jwks;
  }

  issueAgentToken(context: AuthorizedAgentContext): string {
    const now = Math.floor(Date.now() / 1_000);
    return signEd25519Jwt(
      {
        alg: 'EdDSA',
        kid: this.#config.signingKeyId,
        typ: 'JWT',
      },
      {
        iss: this.#config.issuer,
        aud: this.#config.audience,
        sub: context.actorId,
        iat: now,
        exp: now + this.#config.agentTokenTtlSeconds,
        jti: randomUUID(),
        agent_context: context,
      },
      this.#config.signingPrivateKey,
    );
  }

  issueAblyToken(
    channelName: string,
    clientId: string,
  ): {
    token: string;
    expiresAt: string;
  } {
    return this.ablyCredentials.issueJwt({
      capability: {
        [channelName]: ['publish', 'subscribe', 'history'],
      },
      clientId,
      ttlSeconds: this.#config.ablyTokenTtlSeconds,
    });
  }
}

function signEd25519Jwt(
  header: Readonly<Record<string, unknown>>,
  payload: Readonly<Record<string, unknown>>,
  key: AgentPlatformGatewayConfigService['values']['signingPrivateKey'],
): string {
  const signingInput = jwtSigningInput(header, payload);
  const signature = sign(null, Buffer.from(signingInput), key);
  return `${signingInput}.${signature.toString('base64url')}`;
}

function jwtSigningInput(
  header: Readonly<Record<string, unknown>>,
  payload: Readonly<Record<string, unknown>>,
): string {
  return `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(
    JSON.stringify(payload),
  ).toString('base64url')}`;
}
