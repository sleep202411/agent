import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { journalErrorText } from '../agent-os-journal/agent-os-journal.mapper';
import { AgentOsRunJournalService } from '../agent-os-journal/agent-os-run-journal.service';
import { backgroundTasksEnabled } from '../common/background-tasks';
import {
  AgentOsWorkerClient,
  type AgentOsWorkerRunResponse,
} from './agent-os-worker.client';

const SWEEP_INTERVAL_MS = 2_000;
const CONTINUATION_LEASE_MS = 90_000;
const DISPATCH_CONCURRENCY = 4;

/** Durable dispatcher for HITL and authoritative external-result checkpoint resumes. */
@Injectable()
export class AgentOsRunContinuationDispatcherService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(
    AgentOsRunContinuationDispatcherService.name,
  );
  private timer: ReturnType<typeof setInterval> | null = null;
  private sweepActive = false;
  private stopping = false;

  constructor(
    private readonly journal: AgentOsRunJournalService,
    private readonly worker: AgentOsWorkerClient,
  ) {}

  onModuleInit(): void {
    if (!backgroundTasksEnabled() || this.stopping || this.timer) return;
    this.timer = setInterval(() => void this.drainOnce(), SWEEP_INTERVAL_MS);
    this.timer.unref();
    void this.drainOnce();
  }

  onApplicationShutdown(): void {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async dispatch(runId: string): Promise<AgentOsWorkerRunResponse | null> {
    if (!backgroundTasksEnabled() || this.stopping) return null;
    const claim = await this.journal.claimRunContinuationDispatch(
      runId,
      CONTINUATION_LEASE_MS,
    );
    // A claim obtained during shutdown remains recoverable after lease expiry.
    if (!backgroundTasksEnabled() || this.stopping) return null;
    if (claim.kind === 'missing') return null;
    if (claim.kind === 'in_flight' || claim.kind === 'already_finished') {
      return this.durableResponse(runId);
    }
    try {
      const response = await this.worker.resumeContinuation({
        ...claim.command,
        continuationExecutionToken: claim.executionToken,
        continuationExecutionAttemptId: claim.executionAttemptId,
        continuationExecutionEpoch: claim.executionEpoch,
      });
      if (response.runId !== runId) {
        throw new Error(
          `Agent OS Worker acknowledged continuation ${response.runId}; expected ${runId}.`,
        );
      }
      await this.journal.completeRunContinuationDispatch(
        runId,
        claim.executionAttemptId,
        claim.executionEpoch,
      );
      return response;
    } catch (error) {
      await this.journal.failRunContinuationDispatch(
        runId,
        claim.executionAttemptId,
        claim.executionEpoch,
        error,
      );
      throw error;
    }
  }

  private async drainOnce(): Promise<void> {
    if (!backgroundTasksEnabled() || this.stopping || this.sweepActive) return;
    this.sweepActive = true;
    try {
      const runIds = await this.journal.listPendingRunContinuations();
      for (
        let offset = 0;
        backgroundTasksEnabled() && !this.stopping && offset < runIds.length;
        offset += DISPATCH_CONCURRENCY
      ) {
        await Promise.all(
          runIds
            .slice(offset, offset + DISPATCH_CONCURRENCY)
            .map(async (runId) => {
              try {
                await this.dispatch(runId);
              } catch (error) {
                this.logger.warn(
                  `Agent OS continuation dispatch deferred run=${runId}: ${journalErrorText(error)}`,
                );
              }
            }),
        );
      }
    } catch (error) {
      this.logger.warn(
        `Agent OS continuation sweep failed: ${journalErrorText(error)}`,
      );
    } finally {
      this.sweepActive = false;
    }
  }

  private async durableResponse(
    runId: string,
  ): Promise<AgentOsWorkerRunResponse | null> {
    const durable = await this.journal.getEventsAfter(runId, 0);
    if (!durable) return null;
    return {
      runId,
      status: durable.status,
      pendingApproval: durable.pendingApproval,
      pendingUserInput: durable.pendingUserInput,
      pendingExternal: durable.pendingExternal,
      assistantText: durable.assistantText ?? undefined,
      events: durable.events,
    };
  }
}
