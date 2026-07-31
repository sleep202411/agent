import { generateKeyPairSync } from 'node:crypto';

import { loadAgentPlatformGatewayConfig } from './agent-platform-gateway.config';

function validEnvironment(): NodeJS.ProcessEnv {
  const { privateKey } = generateKeyPairSync('ed25519');
  return {
    AGENT_PLATFORM_URL: 'http://agent.internal:4111',
    AGENT_PLATFORM_JWT_PRIVATE_KEY_B64: Buffer.from(
      privateKey.export({ format: 'pem', type: 'pkcs8' }),
    ).toString('base64'),
    AGENT_PLATFORM_JWT_KEY_ID: 'agent-key-1',
    AGENT_PLATFORM_JWT_ISSUER: 'https://api.example.com/agent-platform',
    AGENT_PLATFORM_JWT_AUDIENCE: 'fizzdragon-agent-platform',
    AGENT_ADMISSION_PROVIDER_LANE: 'gemini',
    AGENT_ADMISSION_RETRY_AFTER_SECONDS: '5',
    AGENT_ADMISSION_RESERVED_TOKEN_UNITS_PER_RUN: '131072',
    AGENT_ADMISSION_RESERVED_COST_MICROUSD_PER_RUN: '500000',
    AGENT_ADMISSION_MAX_ACTIVE_GLOBAL: '64',
    AGENT_ADMISSION_MAX_ACTIVE_PER_WORKSPACE: '8',
    AGENT_ADMISSION_MAX_ACTIVE_PER_ACTOR: '2',
    AGENT_ADMISSION_MAX_ACTIVE_PER_PROVIDER_LANE: '32',
    AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_GLOBAL: '8388608',
    AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_PER_WORKSPACE: '1048576',
    AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_PER_ACTOR: '262144',
    AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_PER_PROVIDER_LANE: '4194304',
    AGENT_ADMISSION_MAX_RESERVED_COST_MICROUSD_GLOBAL: '32000000',
    AGENT_ADMISSION_MAX_RESERVED_COST_MICROUSD_PER_WORKSPACE: '4000000',
    AGENT_ADMISSION_MAX_RESERVED_COST_MICROUSD_PER_ACTOR: '1000000',
    AGENT_ADMISSION_MAX_RESERVED_COST_MICROUSD_PER_PROVIDER_LANE: '16000000',
    TEMPORAL_ADDRESS: 'localhost:7233',
    TEMPORAL_NAMESPACE: 'default',
    // The deployed base queue (agentPlatform.temporal.taskQueue). Kept literal
    // so a fixture drift shows up here rather than as document jobs dispatched
    // onto a lane no worker polls.
    AGENT_PLATFORM_TEMPORAL_TASK_QUEUE: 'fizzdragon-agent-platform-v1',
  };
}

describe('loadAgentPlatformGatewayConfig', () => {
  it('loads an Ed25519 signer and bounded operational defaults', () => {
    const config = loadAgentPlatformGatewayConfig(validEnvironment());

    expect(config.agentUrl.href).toBe('http://agent.internal:4111/');
    expect(config.signingPrivateKey.asymmetricKeyType).toBe('ed25519');
    expect(config.agentTokenTtlSeconds).toBe(300);
    expect(config.ablyTokenTtlSeconds).toBe(300);
    expect(config.requestTimeoutMs).toBe(5_000);
    expect(config.invocationDispatchIntervalMs).toBe(500);
    expect(config.invocationDispatchLeaseMs).toBe(45_000);
    expect(config.invocationDispatchConcurrency).toBe(8);
    expect(config.invocationDispatchMaxAttempts).toBe(10);
    expect(config.approvalWaitTimeoutMs).toBe(3_600_000);
    expect(config.admission).toEqual({
      providerLane: 'gemini',
      retryAfterSeconds: 5,
      reservation: {
        tokenUnits: 131_072n,
        costMicrousd: 500_000n,
      },
      limits: {
        activeRuns: {
          global: 64,
          workspace: 8,
          actor: 2,
          providerLane: 32,
        },
        reservedTokenUnits: {
          global: 8_388_608n,
          workspace: 1_048_576n,
          actor: 262_144n,
          providerLane: 4_194_304n,
        },
        reservedCostMicrousd: {
          global: 32_000_000n,
          workspace: 4_000_000n,
          actor: 1_000_000n,
          providerLane: 16_000_000n,
        },
      },
    });
    expect(config.attachmentProcessingLeaseMs).toBe(180_000);
    expect(config.attachmentProcessingMaxAttempts).toBe(3);
    expect(config.attachmentParserConcurrency).toBe(2);
    expect(config.attachmentIngestTimeoutMs).toBe(120_000);
    expect(config.attachmentIngestIntervalMs).toBe(500);
    expect(config.attachmentIngestBatchSize).toBe(4);
    expect(config.attachmentParser).toEqual({
      timeoutMs: 30_000,
      resourceLimits: {
        maxOldGenerationSizeMb: 192,
        maxYoungGenerationSizeMb: 32,
        codeRangeSizeMb: 32,
        stackSizeMb: 4,
      },
    });
    // Literal, not derived from the fixture: this pins the "<base>-document"
    // rule itself. The worker expands the same base through agentTaskQueues(),
    // so a change here that is not mirrored there dispatches onto a lane no
    // worker polls.
    expect(config.temporal).toEqual({
      address: 'localhost:7233',
      namespace: 'default',
      documentTaskQueue: 'fizzdragon-agent-platform-v1-document',
    });
  });

  it('fails closed when required trust configuration is absent', () => {
    const environment = validEnvironment();
    delete environment.AGENT_PLATFORM_JWT_AUDIENCE;

    expect(() => loadAgentPlatformGatewayConfig(environment)).toThrow();
  });

  it('rejects the wrong asymmetric key type', () => {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const environment = validEnvironment();
    environment.AGENT_PLATFORM_JWT_PRIVATE_KEY_B64 = Buffer.from(
      privateKey.export({ format: 'pem', type: 'pkcs8' }),
    ).toString('base64');

    expect(() => loadAgentPlatformGatewayConfig(environment)).toThrow(
      'must encode an Ed25519 private key',
    );
  });

  it('refuses security TTLs above the platform maximum', () => {
    expect(() =>
      loadAgentPlatformGatewayConfig({
        ...validEnvironment(),
        AGENT_PLATFORM_ABLY_TOKEN_TTL_SECONDS: '901',
      }),
    ).toThrow();
  });

  it('requires the admission lease to outlive the full upstream request', () => {
    expect(() =>
      loadAgentPlatformGatewayConfig({
        ...validEnvironment(),
        AGENT_PLATFORM_REQUEST_TIMEOUT_MS: '10000',
        AGENT_INVOCATION_DISPATCH_LEASE_MS: '14999',
      }),
    ).toThrow('must exceed AGENT_PLATFORM_REQUEST_TIMEOUT_MS');
  });

  it('fails loud when distributed admission capacity is absent', () => {
    const environment = validEnvironment();
    delete environment.AGENT_ADMISSION_MAX_ACTIVE_GLOBAL;

    expect(() => loadAgentPlatformGatewayConfig(environment)).toThrow();
  });

  it('rejects admission hierarchies that cannot contain narrower scopes', () => {
    expect(() =>
      loadAgentPlatformGatewayConfig({
        ...validEnvironment(),
        AGENT_ADMISSION_MAX_ACTIVE_GLOBAL: '4',
        AGENT_ADMISSION_MAX_ACTIVE_PER_WORKSPACE: '8',
      }),
    ).toThrow('global >= workspace >= actor');
  });

  it('requires every budget axis to contain one complete reservation', () => {
    expect(() =>
      loadAgentPlatformGatewayConfig({
        ...validEnvironment(),
        AGENT_ADMISSION_MAX_RESERVED_COST_MICROUSD_PER_ACTOR: '499999',
      }),
    ).toThrow('must each contain one per-run reservation');
  });
});
