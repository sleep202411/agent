import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  Connection,
  WorkflowClient,
  WorkflowExecutionAlreadyStartedError,
} from '@temporalio/client';
import { temporal } from '@temporalio/proto';
import {
  StudioAgentApprovalSignalSchema,
  StudioAgentCancelSignalSchema,
  StudioAgentInputSignalSchema,
  StudioAgentWorkflowInputSchema,
} from '@repo/shared/studio-agent';
import type { StudioAgentCommandType } from '@prisma/client';
import { StudioAgentConfigService } from './studio-agent.config';

export interface StudioAgentTemporalCommand {
  workflowId: string;
  type: StudioAgentCommandType;
  payload: unknown;
}

export type StudioAgentTemporalState =
  | 'starting'
  | 'ready'
  | 'temporal_unreachable'
  | 'workers_unavailable'
  | 'stopped';

export interface StudioAgentTemporalHealth {
  state: StudioAgentTemporalState;
  ready: boolean;
  lastCheckedAt: Date | null;
  lastReadyAt: Date | null;
  retryAfterMs: number | null;
}

/**
 * The sole Temporal client boundary in Nest.
 *
 * Temporal is an optional product dependency, not a Nest process dependency:
 * strict configuration is parsed synchronously by StudioAgentConfigService,
 * while network connection and worker discovery recover in the background.
 * HTTP request handlers only write the database outbox; an unavailable runtime
 * therefore delays commands without delaying or terminating unrelated APIs.
 */
@Injectable()
export class StudioAgentTemporalTransport
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(StudioAgentTemporalTransport.name);
  private connection: Connection | null = null;
  private client: WorkflowClient | null = null;
  private probeTimer: NodeJS.Timeout | null = null;
  private probing: Promise<void> | null = null;
  private shuttingDown = false;
  private consecutiveConnectionFailures = 0;
  private health: StudioAgentTemporalHealth = {
    state: 'starting',
    ready: false,
    lastCheckedAt: null,
    lastReadyAt: null,
    retryAfterMs: 0,
  };

  constructor(private readonly config: StudioAgentConfigService) {}

  onApplicationBootstrap(): void {
    this.scheduleProbe(0);
  }

  getHealth(): StudioAgentTemporalHealth {
    return { ...this.health };
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.probeTimer) clearTimeout(this.probeTimer);
    this.probeTimer = null;
    await this.probing?.catch(() => undefined);
    await this.disposeConnection();
    this.health = {
      ...this.health,
      state: 'stopped',
      ready: false,
      retryAfterMs: null,
    };
  }

  async dispatch(command: StudioAgentTemporalCommand): Promise<void> {
    const client = this.requireReadyClient();
    try {
      switch (command.type) {
        case 'start': {
          const input = StudioAgentWorkflowInputSchema.parse(command.payload);
          try {
            await client.start('studioAgentWorkflow', {
              taskQueue: this.config.value.temporal.controlTaskQueue,
              workflowId: command.workflowId,
              args: [input],
              // A run never changes workflow code implicitly. New releases
              // get a new immutable build ID; existing histories remain on
              // the worker version that first accepted them.
              versioningOverride: {
                pinnedTo: {
                  deploymentName:
                    this.config.value.temporal.workerDeploymentName,
                  buildId: this.config.value.temporal.buildId,
                },
              },
            });
          } catch (error) {
            // The outbox is at-least-once. A previous ambiguous start response
            // may already have created the exact workflow identity.
            if (!(error instanceof WorkflowExecutionAlreadyStartedError)) {
              throw error;
            }
          }
          return;
        }
        case 'signal': {
          const payload = command.payload as { decision?: unknown };
          const parsed =
            'decision' in payload
              ? StudioAgentApprovalSignalSchema.parse(command.payload)
              : StudioAgentInputSignalSchema.parse(command.payload);
          const signalName =
            'decision' in parsed
              ? 'studio-agent.approval'
              : 'studio-agent.input';
          await client.getHandle(command.workflowId).signal(signalName, parsed);
          return;
        }
        case 'cancel': {
          const signal = StudioAgentCancelSignalSchema.parse(command.payload);
          // A domain signal, not Temporal's hard cancel, lets the workflow
          // persist a canonical terminal state before it exits.
          await client
            .getHandle(command.workflowId)
            .signal('studio-agent.cancel', signal);
          return;
        }
      }
    } catch (error) {
      // Do not classify a domain/RPC error as connectivity loss. A prompt
      // asynchronous probe verifies the channel and pollers independently.
      this.scheduleProbe(0);
      throw error;
    }
  }

  private requireReadyClient(): WorkflowClient {
    if (!this.client || !this.health.ready) {
      this.scheduleProbe(0);
      throw new Error(
        `Studio Agent Temporal runtime is not ready (${this.health.state}).`,
      );
    }
    return this.client;
  }

  private scheduleProbe(delayMs: number): void {
    if (this.shuttingDown) return;
    if (this.probeTimer) {
      if (delayMs !== 0) return;
      clearTimeout(this.probeTimer);
    }
    this.probeTimer = setTimeout(() => {
      this.probeTimer = null;
      void this.runProbe();
    }, delayMs);
    this.probeTimer.unref?.();
    this.health = {
      ...this.health,
      retryAfterMs: delayMs,
    };
  }

  private async runProbe(): Promise<void> {
    if (this.shuttingDown || this.probing) return;
    this.probing = this.probe().finally(() => {
      this.probing = null;
    });
    await this.probing;
    if (this.shuttingDown) return;
    const delay = this.nextProbeDelay();
    this.scheduleProbe(delay);
  }

  private async probe(): Promise<void> {
    const checkedAt = new Date();
    try {
      await this.ensureConnection();
    } catch (error) {
      this.consecutiveConnectionFailures += 1;
      await this.disposeConnection();
      this.health = {
        ...this.health,
        state: 'temporal_unreachable',
        ready: false,
        lastCheckedAt: checkedAt,
      };
      this.logger.warn(
        `Temporal connection probe failed (attempt ${this.consecutiveConnectionFailures}): ${safeErrorMessage(error)}`,
      );
      return;
    }

    let workersReady = false;
    try {
      workersReady = await this.hasExpectedWorkerPollers(checkedAt);
    } catch (error) {
      // The Temporal channel itself is healthy. A missing Worker Deployment,
      // unsupported server API, or inaccessible task queue is product
      // unavailability, not a reason to tear down a healthy gRPC channel.
      this.logger.warn(
        `Temporal worker readiness probe failed: ${safeErrorMessage(error)}`,
      );
    }

    this.consecutiveConnectionFailures = 0;
    this.health = {
      state: workersReady ? 'ready' : 'workers_unavailable',
      ready: workersReady,
      lastCheckedAt: checkedAt,
      lastReadyAt: workersReady ? checkedAt : this.health.lastReadyAt,
      retryAfterMs: null,
    };
  }

  private async ensureConnection(): Promise<void> {
    if (this.connection && this.client) {
      await this.connection.withDeadline(
        Date.now() + this.config.value.temporal.connectTimeoutMs,
        () => this.connection!.ensureConnected(),
      );
      return;
    }
    const temporalConfig = this.config.value.temporal;
    const connection = await Connection.connect({
      address: temporalConfig.address,
      connectTimeout: temporalConfig.connectTimeoutMs,
      tls: temporalConfig.tls
        ? {
            ...temporalConfig.tls,
            ...(temporalConfig.serverName
              ? { serverNameOverride: temporalConfig.serverName }
              : {}),
          }
        : undefined,
    });
    if (this.shuttingDown) {
      await connection.close();
      throw new Error(
        'Studio Agent Temporal transport shut down while connecting.',
      );
    }
    this.connection = connection;
    this.client = new WorkflowClient({
      connection,
      namespace: temporalConfig.namespace,
    });
  }

  private async hasExpectedWorkerPollers(now: Date): Promise<boolean> {
    const connection = this.connection;
    if (!connection) return false;
    const temporalConfig = this.config.value.temporal;
    const [control, activities] = await connection.withDeadline(
      Date.now() + temporalConfig.connectTimeoutMs,
      () =>
        Promise.all([
          connection.workflowService.describeTaskQueue({
            namespace: temporalConfig.namespace,
            taskQueue: { name: temporalConfig.controlTaskQueue },
            taskQueueType:
              temporal.api.enums.v1.TaskQueueType.TASK_QUEUE_TYPE_WORKFLOW,
          }),
          connection.workflowService.describeTaskQueue({
            namespace: temporalConfig.namespace,
            taskQueue: { name: temporalConfig.activityTaskQueue },
            taskQueueType:
              temporal.api.enums.v1.TaskQueueType.TASK_QUEUE_TYPE_ACTIVITY,
          }),
        ]),
    );
    return (
      hasFreshDeploymentPoller(
        control.pollers,
        temporalConfig.workerDeploymentName,
        temporalConfig.buildId,
        now,
        temporalConfig.pollerStaleMs,
      ) &&
      hasFreshDeploymentPoller(
        activities.pollers,
        temporalConfig.workerDeploymentName,
        temporalConfig.buildId,
        now,
        temporalConfig.pollerStaleMs,
      )
    );
  }

  private nextProbeDelay(): number {
    const temporalConfig = this.config.value.temporal;
    if (this.health.state !== 'temporal_unreachable') {
      return temporalConfig.healthProbeIntervalMs;
    }
    const exponent = Math.max(
      0,
      Math.min(20, this.consecutiveConnectionFailures - 1),
    );
    return Math.min(
      temporalConfig.reconnectMaxDelayMs,
      temporalConfig.reconnectMinDelayMs * 2 ** exponent,
    );
  }

  private async disposeConnection(): Promise<void> {
    const connection = this.connection;
    this.client = null;
    this.connection = null;
    await connection?.close().catch(() => undefined);
  }
}

export function hasFreshDeploymentPoller(
  pollers: readonly temporal.api.taskqueue.v1.IPollerInfo[],
  deploymentName: string,
  buildId: string,
  now: Date,
  staleAfterMs: number,
): boolean {
  return pollers.some((poller) => {
    const options = poller.deploymentOptions;
    if (
      options?.deploymentName !== deploymentName ||
      options.buildId !== buildId
    ) {
      return false;
    }
    const timestamp = poller.lastAccessTime;
    if (!timestamp) return false;
    const seconds =
      typeof timestamp.seconds === 'number'
        ? timestamp.seconds
        : Number(timestamp.seconds ?? 0);
    const millis = seconds * 1_000 + Math.floor((timestamp.nanos ?? 0) / 1e6);
    return (
      Number.isSafeInteger(millis) &&
      Math.abs(now.getTime() - millis) <= staleAfterMs
    );
  });
}

function safeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    2_000,
  );
}
