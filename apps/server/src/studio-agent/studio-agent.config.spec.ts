import { loadStudioAgentServerConfig } from './studio-agent.config';

describe('loadStudioAgentServerConfig', () => {
  const required = {
    TEMPORAL_ADDRESS: 'temporal:7233',
    TEMPORAL_NAMESPACE: 'fizzdragon',
    TEMPORAL_TLS_MODE: 'disabled',
    STUDIO_AGENT_RELEASE: 'git-0123456789abcdef',
    STUDIO_AGENT_RUNTIME_TOKEN: 'x'.repeat(32),
  } satisfies NodeJS.ProcessEnv;

  it('fails loudly when runtime credentials are absent', () => {
    expect(() =>
      loadStudioAgentServerConfig({
        TEMPORAL_ADDRESS: 'temporal:7233',
        TEMPORAL_NAMESPACE: 'fizzdragon',
        TEMPORAL_TLS_MODE: 'disabled',
      }),
    ).toThrow();
  });

  it('requires a complete Temporal mTLS tuple when mTLS is enabled', () => {
    expect(() =>
      loadStudioAgentServerConfig({
        ...required,
        TEMPORAL_TLS_MODE: 'mtls',
        TEMPORAL_TLS_CA: 'ca',
      }),
    ).toThrow(/requires TEMPORAL_TLS_CA/);
  });

  it('forbids TLS material and hostname overrides in disabled mode', () => {
    expect(() =>
      loadStudioAgentServerConfig({
        ...required,
        TEMPORAL_SERVER_NAME: 'temporal.example.test',
      }),
    ).toThrow(/forbidden/);
  });

  it('materializes an explicit mTLS transport configuration', () => {
    expect(
      loadStudioAgentServerConfig({
        ...required,
        TEMPORAL_TLS_MODE: 'mtls',
        TEMPORAL_SERVER_NAME: 'temporal.example.test',
        TEMPORAL_TLS_CA: 'ca',
        TEMPORAL_TLS_CERT: 'cert',
        TEMPORAL_TLS_KEY: 'key',
      }).temporal,
    ).toMatchObject({
      tlsMode: 'mtls',
      serverName: 'temporal.example.test',
      tls: {
        serverRootCACertificate: Buffer.from('ca'),
        clientCertPair: {
          crt: Buffer.from('cert'),
          key: Buffer.from('key'),
        },
      },
    });
  });

  it('keeps only operational tuning defaults', () => {
    expect(loadStudioAgentServerConfig(required)).toMatchObject({
      temporal: {
        address: 'temporal:7233',
        namespace: 'fizzdragon',
        tlsMode: 'disabled',
        tls: undefined,
        controlTaskQueue: 'studio-agent-control-v1',
        activityTaskQueue: 'studio-agent-activities-v1',
        workerDeploymentName: 'fizzdragon-studio-agent',
        buildId: 'git-0123456789abcdef',
        connectTimeoutMs: 5_000,
        healthProbeIntervalMs: 5_000,
        reconnectMinDelayMs: 500,
        reconnectMaxDelayMs: 30_000,
        pollerStaleMs: 30_000,
      },
      commandPollIntervalMs: 250,
      commandLeaseMs: 30_000,
      commandBatchSize: 20,
      admission: {
        leaseMs: 120_000,
        reconcileIntervalMs: 5_000,
        reconcileBatchSize: 50,
        maxActiveRootRuns: {
          global: 512,
          workspace: 64,
          user: 4,
        },
        maxReservedTokenUnits: {
          global: 512_000_000,
          workspace: 64_000_000,
          user: 4_000_000,
        },
      },
      attachmentCleanup: {
        ttlMs: 86_400_000,
        pollIntervalMs: 30_000,
        batchSize: 25,
        discoveryBatchSize: 500,
        leaseMs: 60_000,
        maxAttempts: 12,
        retryBaseMs: 10_000,
        retryMaxMs: 1_800_000,
      },
      sseHeartbeatMs: 15_000,
      sseBatchSize: 250,
      model: {
        provider: 'alibaba',
        textModelId: 'qwen3-max',
        visionModelId: 'qwen3-vl-plus',
      },
      budget: {
        maxChildDepth: 4,
        maxChildRuns: 24,
        maxConcurrentChildRuns: 8,
        maxModelStepsPerRun: 32,
        maxModelStepsPerRoot: 128,
        maxTotalTokenUnits: 1_000_000,
        maxContextBytesPerStep: 2_000_000,
        imageTokenReserveUnits: 8_192,
        minOutputTokenUnitsPerStep: 256,
        wallTimeMs: 3_600_000,
      },
    });
  });

  it('caps the discovery batch so one sweep cannot monopolize the pool', () => {
    expect(() =>
      loadStudioAgentServerConfig({
        ...required,
        STUDIO_AGENT_ATTACHMENT_CLEANUP_DISCOVERY_BATCH_SIZE: '6000',
      }),
    ).toThrow();
    expect(
      loadStudioAgentServerConfig({
        ...required,
        STUDIO_AGENT_ATTACHMENT_CLEANUP_DISCOVERY_BATCH_SIZE: '5000',
      }).attachmentCleanup.discoveryBatchSize,
    ).toBe(5_000);
  });

  it('rejects internally inconsistent root-run budgets', () => {
    expect(() =>
      loadStudioAgentServerConfig({
        ...required,
        STUDIO_AGENT_BUDGET_MAX_CHILD_RUNS: '2',
        STUDIO_AGENT_BUDGET_MAX_CONCURRENT_CHILD_RUNS: '3',
      }),
    ).toThrow(/must not exceed STUDIO_AGENT_BUDGET_MAX_CHILD_RUNS/);
    expect(() =>
      loadStudioAgentServerConfig({
        ...required,
        STUDIO_AGENT_BUDGET_MAX_MODEL_STEPS_PER_RUN: '5',
        STUDIO_AGENT_BUDGET_MAX_MODEL_STEPS_PER_ROOT: '4',
      }),
    ).toThrow(/must not exceed STUDIO_AGENT_BUDGET_MAX_MODEL_STEPS_PER_ROOT/);
    expect(() =>
      loadStudioAgentServerConfig({
        ...required,
        STUDIO_AGENT_MODEL_MAX_OUTPUT_TOKENS: '128',
        STUDIO_AGENT_BUDGET_MIN_OUTPUT_TOKEN_UNITS_PER_STEP: '256',
      }),
    ).toThrow(/must not exceed STUDIO_AGENT_MODEL_MAX_OUTPUT_TOKENS/);
  });

  it('rejects admission limits that cannot contain the root budget hierarchy', () => {
    expect(() =>
      loadStudioAgentServerConfig({
        ...required,
        STUDIO_AGENT_ADMISSION_MAX_ACTIVE_ROOT_RUNS_PER_USER: '5',
        STUDIO_AGENT_ADMISSION_MAX_ACTIVE_ROOT_RUNS_PER_WORKSPACE: '4',
      }),
    ).toThrow(/user <= workspace <= global/);
    expect(() =>
      loadStudioAgentServerConfig({
        ...required,
        STUDIO_AGENT_BUDGET_MAX_TOTAL_TOKEN_UNITS: '1000000',
        STUDIO_AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_PER_USER: '999999',
      }),
    ).toThrow(/fit one root budget/);
  });

  it('rejects Worker Deployment identity drift and invalid reconnect bounds', () => {
    expect(() =>
      loadStudioAgentServerConfig({
        ...required,
        STUDIO_AGENT_WORKER_DEPLOYMENT_NAME: 'legacy-deployment',
      }),
    ).toThrow(/must equal fizzdragon-studio-agent/);
    expect(() =>
      loadStudioAgentServerConfig({
        ...required,
        STUDIO_AGENT_TEMPORAL_RECONNECT_MIN_DELAY_MS: '2000',
        STUDIO_AGENT_TEMPORAL_RECONNECT_MAX_DELAY_MS: '1000',
      }),
    ).toThrow(/must be greater than or equal/);
  });
});
