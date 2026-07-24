import { Logger } from '@nestjs/common';
import { Connection, type WorkflowClient } from '@temporalio/client';
import { temporal } from '@temporalio/proto';
import {
  STUDIO_AGENT_SCHEMA_VERSION,
  STUDIO_AGENT_WORKER_DEPLOYMENT_NAME,
} from '@repo/shared/studio-agent';
import type { StudioAgentConfigService } from './studio-agent.config';
import {
  hasFreshDeploymentPoller,
  StudioAgentTemporalTransport,
} from './studio-agent.temporal';

const RELEASE = 'git-0123456789abcdef';
const NOW = new Date('2026-07-24T12:00:00.000Z');

describe('StudioAgentTemporalTransport', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('never places Temporal connectivity on the Nest bootstrap path', async () => {
    jest
      .spyOn(Connection, 'connect')
      .mockRejectedValue(new Error('Temporal is offline'));
    const transport = new StudioAgentTemporalTransport(config());

    expect(transport.onApplicationBootstrap()).toBeUndefined();
    expect(transport.getHealth()).toMatchObject({
      state: 'starting',
      ready: false,
    });

    await runProbe(transport);

    expect(transport.getHealth()).toMatchObject({
      state: 'temporal_unreachable',
      ready: false,
      retryAfterMs: 500,
    });
    await transport.onApplicationShutdown();
  });

  it('becomes ready only when both configured queues have fresh release pollers', async () => {
    const describeTaskQueue = jest
      .fn()
      .mockResolvedValue({ pollers: [poller(Date.now())] });
    const connection = {
      close: jest.fn().mockResolvedValue(undefined),
      ensureConnected: jest.fn().mockResolvedValue(undefined),
      withDeadline: jest.fn(
        async <T>(_deadline: number | Date, operation: () => Promise<T>) =>
          operation(),
      ),
      workflowService: { describeTaskQueue },
    };
    jest
      .spyOn(Connection, 'connect')
      .mockResolvedValue(connection as unknown as Connection);
    const transport = new StudioAgentTemporalTransport(config());

    await runProbe(transport);

    expect(transport.getHealth()).toMatchObject({
      state: 'ready',
      ready: true,
    });
    expect(describeTaskQueue).toHaveBeenCalledTimes(2);
    await transport.onApplicationShutdown();
  });

  it('pins every new workflow to the exact immutable deployment release', async () => {
    const start = jest.fn().mockResolvedValue({ workflowId: 'workflow-1' });
    const transport = new StudioAgentTemporalTransport(config());
    setReadyClient(transport, { start } as unknown as WorkflowClient);

    await transport.dispatch({
      workflowId: 'workflow-1',
      type: 'start',
      payload: {
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        threadId: '00000000-0000-4000-8000-000000000001',
        runId: '00000000-0000-4000-8000-000000000002',
        rootRunId: '00000000-0000-4000-8000-000000000002',
        parentRunId: null,
        kind: 'turn',
        scenario: { id: 'story.studio.assistant', version: '1.0.0' },
        permissionPolicy: {
          policyId: '00000000-0000-4000-8000-000000000003',
          revision: 1,
        },
      },
    });

    expect(start).toHaveBeenCalledWith(
      'studioAgentWorkflow',
      expect.objectContaining({
        workflowId: 'workflow-1',
        taskQueue: 'studio-agent-control-v1',
        versioningOverride: {
          pinnedTo: {
            deploymentName: STUDIO_AGENT_WORKER_DEPLOYMENT_NAME,
            buildId: RELEASE,
          },
        },
      }),
    );
    await transport.onApplicationShutdown();
  });
});

describe('hasFreshDeploymentPoller', () => {
  it('rejects stale, foreign, and wrong-release pollers', () => {
    expect(
      hasFreshDeploymentPoller(
        [poller(NOW.getTime() - 30_001)],
        STUDIO_AGENT_WORKER_DEPLOYMENT_NAME,
        RELEASE,
        NOW,
        30_000,
      ),
    ).toBe(false);
    expect(
      hasFreshDeploymentPoller(
        [
          poller(NOW.getTime(), {
            deploymentName: 'other-deployment',
          }),
        ],
        STUDIO_AGENT_WORKER_DEPLOYMENT_NAME,
        RELEASE,
        NOW,
        30_000,
      ),
    ).toBe(false);
    expect(
      hasFreshDeploymentPoller(
        [poller(NOW.getTime(), { buildId: 'other-release' })],
        STUDIO_AGENT_WORKER_DEPLOYMENT_NAME,
        RELEASE,
        NOW,
        30_000,
      ),
    ).toBe(false);
  });

  it('accepts a fresh poller for the exact deployment release', () => {
    expect(
      hasFreshDeploymentPoller(
        [poller(NOW.getTime() - 1_000)],
        STUDIO_AGENT_WORKER_DEPLOYMENT_NAME,
        RELEASE,
        NOW,
        30_000,
      ),
    ).toBe(true);
  });
});

function config(): StudioAgentConfigService {
  return {
    value: {
      temporal: {
        address: 'temporal:7233',
        namespace: 'fizzdragon',
        tlsMode: 'disabled',
        serverName: undefined,
        tls: undefined,
        controlTaskQueue: 'studio-agent-control-v1',
        activityTaskQueue: 'studio-agent-activities-v1',
        workerDeploymentName: STUDIO_AGENT_WORKER_DEPLOYMENT_NAME,
        buildId: RELEASE,
        connectTimeoutMs: 1_000,
        healthProbeIntervalMs: 5_000,
        reconnectMinDelayMs: 500,
        reconnectMaxDelayMs: 30_000,
        pollerStaleMs: 30_000,
      },
    },
  } as StudioAgentConfigService;
}

function poller(
  accessedAt: number,
  overrides: {
    deploymentName?: string;
    buildId?: string;
  } = {},
): temporal.api.taskqueue.v1.IPollerInfo {
  return temporal.api.taskqueue.v1.PollerInfo.fromObject({
    lastAccessTime: {
      seconds: Math.floor(accessedAt / 1_000),
      nanos: (accessedAt % 1_000) * 1_000_000,
    },
    deploymentOptions: {
      deploymentName:
        overrides.deploymentName ?? STUDIO_AGENT_WORKER_DEPLOYMENT_NAME,
      buildId: overrides.buildId ?? RELEASE,
    },
  });
}

async function runProbe(
  transport: StudioAgentTemporalTransport,
): Promise<void> {
  const mutable = transport as unknown as {
    probeTimer: NodeJS.Timeout | null;
    runProbe(): Promise<void>;
  };
  if (mutable.probeTimer) {
    clearTimeout(mutable.probeTimer);
    mutable.probeTimer = null;
  }
  await mutable.runProbe();
}

function setReadyClient(
  transport: StudioAgentTemporalTransport,
  client: WorkflowClient,
): void {
  const mutable = transport as unknown as {
    client: WorkflowClient;
    health: {
      state: 'ready';
      ready: true;
      lastCheckedAt: Date;
      lastReadyAt: Date;
      retryAfterMs: number;
    };
  };
  mutable.client = client;
  mutable.health = {
    state: 'ready',
    ready: true,
    lastCheckedAt: NOW,
    lastReadyAt: NOW,
    retryAfterMs: 5_000,
  };
}
