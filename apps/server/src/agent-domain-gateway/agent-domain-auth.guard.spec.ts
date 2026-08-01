import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';

import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';

import { AgentDomainAuthGuard } from './agent-domain-auth.guard';

const workerKeyPair = generateKeyPairSync('ed25519');
const apiKeyPair = generateKeyPairSync('ed25519');
const worker = { kid: 'domain-key-1', privateKey: workerKeyPair.privateKey };
const api = { kid: 'domain-key-2', privateKey: apiKeyPair.privateKey };
const config = {
  values: {
    verificationKeys: new Map([
      [worker.kid, { key: workerKeyPair.publicKey, capability: 'runtime' }],
      [api.kid, { key: apiKeyPair.publicKey, capability: 'readiness' }],
    ]),
    issuer: 'fizzdragon-agent-platform',
    audience: 'fizzdragon-domain-gateway',
  },
};
type SigningIdentity = typeof worker;

describe('AgentDomainAuthGuard', () => {
  it('accepts only an exact request-bound workload credential', () => {
    const body = Buffer.from('{"schemaVersion":"agent-tool-request/v2"}');
    const request = requestFixture(body);
    const guard = new AgentDomainAuthGuard(config as never);

    expect(guard.canActivate(context(request))).toBe(true);
    expect(request.agentDomainClaims).toMatchObject({
      tool_id: 'story_get_snapshot',
      idempotency_key: 'run-1:tool-1',
    });
  });

  const replayMutations: Array<
    [
      string,
      Partial<{
        body: Buffer;
        toolId: string;
        idempotencyKey: string;
        method: string;
      }>,
    ]
  > = [
    ['body', { body: Buffer.from('{}') }],
    ['tool route', { toolId: 'story_apply_change_set' }],
    ['idempotency header', { idempotencyKey: 'different-key' }],
    ['method', { method: 'GET' }],
  ];

  it.each(replayMutations)(
    'rejects a token replayed against a different %s',
    (_label, mutation) => {
      const body = Buffer.from('{"schemaVersion":"agent-tool-request/v2"}');
      const request = requestFixture(body);
      Object.assign(request, {
        ...(mutation.body ? { rawBody: mutation.body } : {}),
        ...(mutation.method ? { method: mutation.method } : {}),
        ...(mutation.toolId ? { params: { toolId: mutation.toolId } } : {}),
        ...(mutation.idempotencyKey
          ? {
              headers: {
                ...request.headers,
                'idempotency-key': mutation.idempotencyKey,
              },
            }
          : {}),
      });

      expect(() =>
        new AgentDomainAuthGuard(config as never).canActivate(context(request)),
      ).toThrow(UnauthorizedException);
    },
  );

  it('rejects credentials with a lifetime above the hard ceiling', () => {
    const body = Buffer.from('{}');
    const request = requestFixture(body, 121);
    expect(() =>
      new AgentDomainAuthGuard(config as never).canActivate(context(request)),
    ).toThrow(UnauthorizedException);
  });

  it('allows the exact non-idempotent attachment resolution route only', () => {
    const body = Buffer.from('{"schemaVersion":"agent-attachment-resolve/v1"}');
    const method = 'POST';
    const path = '/v1/agent/attachments/resolve';
    const request = {
      method,
      path,
      params: {},
      headers: {
        authorization: `Bearer ${token({
          method,
          path,
          body,
          ttlSeconds: 30,
        })}`,
      },
      rawBody: body,
      body: JSON.parse(body.toString('utf8')) as unknown,
      agentDomainClaims: undefined,
    };

    expect(
      new AgentDomainAuthGuard(config as never).canActivate(context(request)),
    ).toBe(true);

    request.path = '/v1/agent/attachments/other';
    expect(() =>
      new AgentDomainAuthGuard(config as never).canActivate(context(request)),
    ).toThrow(UnauthorizedException);
  });

  it('allows only the exact body-bound invocation lifecycle route', () => {
    const invocationId = '0197f4a2-0800-7000-8000-000000000010';
    const body = Buffer.from(
      JSON.stringify({
        schemaVersion: 'agent-invocation-lifecycle/v1',
        invocationId,
      }),
    );
    const method = 'POST';
    const path = `/v1/agent/invocations/${invocationId}/lifecycle`;
    const request = {
      method,
      path,
      params: { invocationId },
      headers: {
        authorization: `Bearer ${token({
          method,
          path,
          body,
          ttlSeconds: 30,
        })}`,
      },
      rawBody: body,
      body: JSON.parse(body.toString('utf8')) as unknown,
      agentDomainClaims: undefined,
    };

    expect(
      new AgentDomainAuthGuard(config as never).canActivate(context(request)),
    ).toBe(true);

    request.path = `/v1/agent/invocations/${invocationId}/other`;
    expect(() =>
      new AgentDomainAuthGuard(config as never).canActivate(context(request)),
    ).toThrow(UnauthorizedException);
  });

  it('refuses a readiness-only key on every state-bearing route', () => {
    const invocationId = '0197f4a2-0800-7000-8000-000000000011';
    const jobId = '0197f4a2-0800-7000-8000-000000000012';
    const requests = [
      requestFixture(
        Buffer.from('{"schemaVersion":"agent-tool-request/v2"}'),
        30,
        api,
      ),
      routeFixture({
        method: 'POST',
        path: '/v1/agent/attachments/resolve',
        body: Buffer.from('{"schemaVersion":"agent-attachment-resolve/v1"}'),
        identity: api,
      }),
      routeFixture({
        method: 'POST',
        path: `/v1/agent/invocations/${invocationId}/lifecycle`,
        params: { invocationId },
        body: Buffer.from(JSON.stringify({ invocationId })),
        identity: api,
      }),
      routeFixture({
        method: 'POST',
        path: `/v1/agent/document-analysis/${jobId}/claim`,
        params: { jobId },
        body: Buffer.from(JSON.stringify({ jobId })),
        identity: api,
      }),
    ];

    for (const request of requests) {
      expect(() =>
        new AgentDomainAuthGuard(config as never).canActivate(context(request)),
      ).toThrow(UnauthorizedException);
    }
  });

  it('accepts the readiness probe from either workload key', () => {
    for (const identity of [worker, api]) {
      const request = routeFixture({
        method: 'GET',
        path: '/v1/agent/health/ready',
        body: Buffer.alloc(0),
        identity,
      });

      expect(
        new AgentDomainAuthGuard(config as never).canActivate(context(request)),
      ).toBe(true);
    }
  });
});

function requestFixture(
  body: Buffer,
  ttlSeconds = 30,
  identity: SigningIdentity = worker,
) {
  const method = 'POST';
  const path = '/v1/agent/tools/story_get_snapshot/execute';
  const toolId = 'story_get_snapshot';
  const idempotencyKey = 'run-1:tool-1';
  return {
    method,
    path,
    params: { toolId },
    headers: {
      authorization: `Bearer ${token({
        method,
        path,
        body,
        toolId,
        idempotencyKey,
        ttlSeconds,
        identity,
      })}`,
      'idempotency-key': idempotencyKey,
    },
    rawBody: body,
    body: JSON.parse(body.toString('utf8')) as unknown,
    agentDomainClaims: undefined,
  };
}

function routeFixture(input: {
  method: 'GET' | 'POST';
  path: string;
  params?: Record<string, string>;
  body: Buffer;
  identity: SigningIdentity;
}) {
  return {
    method: input.method,
    path: input.path,
    params: input.params ?? {},
    headers: {
      authorization: `Bearer ${token({
        method: input.method,
        path: input.path,
        body: input.body,
        ttlSeconds: 30,
        identity: input.identity,
      })}`,
    },
    rawBody: input.body,
    body: input.body.byteLength
      ? (JSON.parse(input.body.toString('utf8')) as unknown)
      : undefined,
    agentDomainClaims: undefined,
  };
}

function token(input: {
  method: string;
  path: string;
  body: Buffer;
  toolId?: string;
  idempotencyKey?: string;
  ttlSeconds: number;
  identity?: SigningIdentity;
}): string {
  const identity = input.identity ?? worker;
  const now = Math.floor(Date.now() / 1_000);
  const header = {
    alg: 'EdDSA',
    kid: identity.kid,
    typ: 'JWT',
  };
  const claims = {
    iss: 'fizzdragon-agent-platform',
    aud: 'fizzdragon-domain-gateway',
    sub: 'fizzdragon-agent-platform',
    iat: now,
    exp: now + input.ttlSeconds,
    jti: randomUUID(),
    request_method: input.method,
    request_path: input.path,
    body_sha256: createHash('sha256').update(input.body).digest('hex'),
    ...(input.toolId ? { tool_id: input.toolId } : {}),
    ...(input.idempotencyKey ? { idempotency_key: input.idempotencyKey } : {}),
  };
  const signingInput = `${Buffer.from(JSON.stringify(header)).toString(
    'base64url',
  )}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
  return `${signingInput}.${sign(null, Buffer.from(signingInput), identity.privateKey).toString('base64url')}`;
}

function context(request: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as ExecutionContext;
}
