import {
  createHmac,
  createPublicKey,
  generateKeyPairSync,
  verify,
  type JsonWebKey,
  type KeyObject,
} from 'node:crypto';

import { createAblyTokenCredentials } from '../infra/realtime/ably-token-credentials';
import type { AuthorizedAgentContext } from './agent-platform-gateway.dto';
import { AgentPlatformCredentialsService } from './agent-platform-credentials.service';

function fixture() {
  const { privateKey } = generateKeyPairSync('ed25519');
  const config = {
    values: Object.freeze({
      agentUrl: new URL('http://agent.internal:4111'),
      signingPrivateKey: privateKey,
      signingKeyId: 'agent-key-1',
      issuer: 'https://api.example.com/agent-platform',
      audience: 'fizzdragon-agent-platform',
      agentTokenTtlSeconds: 300,
      ablyTokenTtlSeconds: 120,
      requestTimeoutMs: 5_000,
    }),
  };
  return {
    privateKey,
    service: new AgentPlatformCredentialsService(
      config as never,
      createAblyTokenCredentials('app.key:ably-secret'),
    ),
  };
}

const CONTEXT: AuthorizedAgentContext = Object.freeze({
  actorId: '42',
  actorDisplayName: 'Isaac',
  conversationId: '0197f4a2-0800-7000-8000-000000000004',
  surface: 'story-studio',
  scope: Object.freeze({
    kind: 'story-project',
    workspaceId: '0197f4a2-0800-7000-8000-000000000001',
    projectId: '0197f4a2-0800-7000-8000-000000000002',
  }),
  sessionName: 'agent:v1:conversation:0197f4a2-0800-7000-8000-000000000004',
  permissionMode: 'smart',
  locale: 'en-US',
  roles: Object.freeze(['story.owner']),
  permissions: Object.freeze(['story.read', 'story.write']),
  traceId: '0197f4a2-0800-7000-8000-000000000003',
});

describe('AgentPlatformCredentialsService', () => {
  it('publishes the exact Ed25519 public key and signs scope-bound Agent JWTs', () => {
    const { privateKey, service } = fixture();
    const token = service.issueAgentToken(CONTEXT);
    const [headerPart, payloadPart, signaturePart] = token.split('.');
    const header = decodePart(headerPart);
    const payload = decodePart(payloadPart);

    expect(header).toEqual({
      alg: 'EdDSA',
      kid: 'agent-key-1',
      typ: 'JWT',
    });
    expect(payload).toMatchObject({
      iss: 'https://api.example.com/agent-platform',
      aud: 'fizzdragon-agent-platform',
      sub: '42',
      agent_context: CONTEXT,
    });
    expect(
      verify(
        null,
        Buffer.from(`${headerPart}.${payloadPart}`),
        createPublicKey(privateKey),
        Buffer.from(signaturePart, 'base64url'),
      ),
    ).toBe(true);

    const jwk = service.jwks().keys[0];
    expect(jwk).toMatchObject({
      kid: 'agent-key-1',
      alg: 'EdDSA',
      use: 'sig',
      kty: 'OKP',
      crv: 'Ed25519',
    });
    expect(jwk).not.toHaveProperty('d');
    expect(publicKeyFromJwk(jwk).asymmetricKeyType).toBe('ed25519');
  });

  it('issues an exact-channel Ably JWT with no wildcard capability', () => {
    const { service } = fixture();
    const channel =
      'agent:v1:conversation:0197f4a2-0800-7000-8000-000000000004';
    const { token, expiresAt } = service.issueAblyToken(channel, '42');
    const [headerPart, payloadPart, signaturePart] = token.split('.');
    const payload = decodePart(payloadPart);

    expect(decodePart(headerPart)).toEqual({
      alg: 'HS256',
      kid: 'app.key',
      typ: 'JWT',
    });
    expect(payload['x-ably-clientId']).toBe('42');
    expect(JSON.parse(String(payload['x-ably-capability']))).toEqual({
      [channel]: ['publish', 'subscribe', 'history'],
    });
    expect(payload['x-ably-capability']).not.toContain('*');
    expect(
      createHmac('sha256', 'ably-secret')
        .update(`${headerPart}.${payloadPart}`)
        .digest('base64url'),
    ).toBe(signaturePart);
    expect(Date.parse(expiresAt)).toBe(Number(payload.exp) * 1_000);
    expect(Number(payload.exp) - Number(payload.iat)).toBe(120);
  });
});

function decodePart(value: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
}

function publicKeyFromJwk(jwk: JsonWebKey): KeyObject {
  return createPublicKey({ format: 'jwk', key: jwk });
}
