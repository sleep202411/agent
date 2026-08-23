import { createHmac } from 'node:crypto';

import { Inject, Module, type Provider } from '@nestjs/common';
import * as Ably from 'ably';
import { z } from 'zod';

const ablyApiKeyPattern = /^[\w-]+\.[\w-]+:[\w+/=-]+$/;
const ablyEnvironmentSchema = z.object({
  ABLY_API_KEY: z
    .string()
    .trim()
    .min(1, 'ABLY_API_KEY is required')
    .regex(
      ablyApiKeyPattern,
      'ABLY_API_KEY must be a complete <appId>.<keyId>:<secret> key',
    ),
});

export interface AblyTokenRequest {
  keyName: string;
  clientId: string;
  capability: string;
  timestamp: number;
  nonce: string;
  mac: string;
  ttl: number;
}

export interface AblyTokenCredentials {
  createTokenRequest(params: {
    capability: Record<string, readonly string[]>;
    clientId: string;
    ttlMs: number;
  }): Promise<AblyTokenRequest>;
  issueJwt(params: {
    capability: Record<string, readonly string[]>;
    clientId: string;
    ttlSeconds: number;
  }): {
    token: string;
    expiresAt: string;
  };
}

export const ABLY_TOKEN_CREDENTIALS = Symbol('ABLY_TOKEN_CREDENTIALS');
export const ABLY_REST_CLIENT = Symbol('ABLY_REST_CLIENT');

export type AblyRestClient = Pick<
  Ably.Rest,
  'auth' | 'batchPublish' | 'channels' | 'request'
>;

/**
 * Creates the process-wide REST transport without exposing the root key to
 * business modules. REST publishing holds no realtime connection.
 */
export function createAblyRestClient(
  env: NodeJS.ProcessEnv = process.env,
): Ably.Rest {
  const parsed = ablyEnvironmentSchema.parse(env);
  return new Ably.Rest({
    key: parsed.ABLY_API_KEY,
    clientId: 'fizzdragon-server',
    idempotentRestPublishing: true,
    // Agent OS outbox budgets the exact JSON UTF-8 request body. Ably's Node
    // default prefers MessagePack, so pin JSON here rather than proving one
    // wire format in tests and deploying another.
    useBinaryProtocol: false,
    restAgentOptions: { keepAlive: true, maxSockets: 64 },
  });
}

/**
 * The sole owner of the Ably root credential in the Nest process.
 *
 * Consumers provide an already-authorized, exact capability. They can request
 * a signed credential but cannot read, copy, or log the API key. `Ably.Rest`
 * creates legacy TokenRequests locally and never opens a realtime connection;
 * JWT signing is also local.
 */
export function createAblyTokenCredentials(
  apiKey: string,
): AblyTokenCredentials {
  const parsed = ablyEnvironmentSchema.parse({ ABLY_API_KEY: apiKey });
  const separator = parsed.ABLY_API_KEY.indexOf(':');
  const keyName = parsed.ABLY_API_KEY.slice(0, separator);
  const keySecret = parsed.ABLY_API_KEY.slice(separator + 1);
  const client = new Ably.Rest({ key: parsed.ABLY_API_KEY });

  const credentials: AblyTokenCredentials = {
    createTokenRequest: async (params) => {
      const signed = await client.auth.createTokenRequest({
        capability: params.capability as Ably.TokenParams['capability'],
        clientId: params.clientId,
        ttl: params.ttlMs,
      });
      return {
        keyName: signed.keyName,
        clientId: signed.clientId ?? params.clientId,
        capability: signed.capability,
        timestamp: signed.timestamp,
        nonce: signed.nonce,
        mac: signed.mac,
        ttl: signed.ttl ?? params.ttlMs,
      };
    },
    issueJwt: (params) => {
      const now = Math.floor(Date.now() / 1_000);
      const expires = now + params.ttlSeconds;
      const signingInput = jwtSigningInput(
        {
          alg: 'HS256',
          kid: keyName,
          typ: 'JWT',
        },
        {
          iat: now,
          exp: expires,
          'x-ably-clientId': params.clientId,
          'x-ably-capability': JSON.stringify(params.capability),
        },
      );
      const signature = createHmac('sha256', keySecret)
        .update(signingInput)
        .digest('base64url');
      return {
        token: `${signingInput}.${signature}`,
        expiresAt: new Date(expires * 1_000).toISOString(),
      };
    },
  };
  return Object.freeze(credentials);
}

const ablyTokenCredentialsProvider: Provider = {
  provide: ABLY_TOKEN_CREDENTIALS,
  useFactory: (): AblyTokenCredentials =>
    createAblyTokenCredentials(process.env.ABLY_API_KEY ?? ''),
};

const ablyRestClientProvider: Provider = {
  provide: ABLY_REST_CLIENT,
  useFactory: (): Ably.Rest => createAblyRestClient(),
};

@Module({
  providers: [ablyTokenCredentialsProvider, ablyRestClientProvider],
  exports: [ABLY_TOKEN_CREDENTIALS, ABLY_REST_CLIENT],
})
export class AblyTokenCredentialsModule {}

export function InjectAblyTokenCredentials(): ParameterDecorator {
  return Inject(ABLY_TOKEN_CREDENTIALS);
}

function jwtSigningInput(
  header: Readonly<Record<string, unknown>>,
  payload: Readonly<Record<string, unknown>>,
): string {
  return `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(
    JSON.stringify(payload),
  ).toString('base64url')}`;
}
