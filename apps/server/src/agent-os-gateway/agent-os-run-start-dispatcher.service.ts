import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { AgentOsRunJournalService } from '../agent-os-journal/agent-os-run-journal.service';
import { backgroundTasksEnabled } from '../common/background-tasks';
import { journalErrorText } from '../agent-os-journal/agent-os-journal.mapper';
import {
  AgentOsWorkerClient,
  type AgentOsWorkerRunResponse,
} from './agent-os-worker.client';

const SWEEP_INTERVAL_MS = 2_000;
// Long enough to cover Worker acceptance and independent heartbeats. A lost
// HTTP response never releases this lease early; PostgreSQL expiry is the
// only authority that permits a later epoch to take over.
const START_LEASE_MS = 90_000;

/**
 * Durable Agent run start dispatcher.
 *
 * Admission stores the complete, validated command in PostgreSQL and commits
 * before this class performs any Worker HTTP. A Nest or Worker crash can
 * therefore only delay a start; it cannot lose it, admit two active runs into
 * one conversation, or hold a database transaction while the Worker calls the
 * journal back through the same connection pool.
 */
@Injectable()
export class AgentOsRunStartDispatcherService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(AgentOsRunStartDispatcherService.name);
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

  /**
   * Try one dispatch immediately. The caller may return a durable `queued`
   * acknowledgement when this throws; the background sweep keeps retrying.
   */
  async dispatch(runId: string): Promise<AgentOsWorkerRunResponse | null> {
    if (!backgroundTasksEnabled() || this.stopping) return null;
    const claim = await this.journal.claimRunStartDispatch(
      runId,
      START_LEASE_MS,
    );
    // A claim obtained during shutdown remains recoverable after lease expiry.
    if (!backgroundTasksEnabled() || this.stopping) return null;
    if (claim.kind === 'missing') return null;
    if (claim.kind === 'in_flight') return this.durableResponse(runId);
    if (claim.kind === 'already_started') {
      return this.durableResponse(runId);
    }

    try {
      const response = await this.worker.startRun({
        ...claim.command,
        startExecutionToken: claim.executionToken,
        startExecutionAttemptId: claim.executionAttemptId,
        startExecutionEpoch: claim.executionEpoch,
      });
      if (response.runId !== runId) {
        throw new Error(
          `Agent OS Worker acknowledged run ${response.runId}; expected ${runId}.`,
        );
      }
      await this.journal.completeRunStartDispatch(
        runId,
        claim.executionAttemptId,
        claim.executionEpoch,
      );
      return response;
    } catch (error) {
      await this.journal.failRunStartDispatch(
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
      const runIds = await this.journal.listPendingRunStarts();
      for (const runId of runIds) {
        if (!backgroundTasksEnabled() || this.stopping) return;
        try {
          await this.dispatch(runId);
        } catch (error) {
          this.logger.warn(
            `Agent OS start dispatch deferred run=${runId}: ${journalErrorText(error)}`,
          );
        }
      }
    } catch (error) {
      this.logger.warn(
        `Agent OS start dispatch sweep failed: ${journalErrorText(error)}`,
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
