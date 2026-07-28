import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../infra/db/db.module';
import { StudioAgentRunTerminalService } from './studio-agent-run-terminal.service';
import { StudioAgentTemporalTransport } from './studio-agent.temporal';

/**
 * The turn a thread thinks is running, checked against the system that runs it.
 *
 * `thread.activeRunId` is a CACHE of a fact Temporal owns. It is written when a
 * run is created and cleared when the workflow reports a terminal — so a
 * workflow that dies without reporting leaves an assertion of liveness that
 * nothing will ever retract. The thread then refuses every later message with
 * `STUDIO_AGENT_RUN_ALREADY_ACTIVE`, permanently, and the creator's only way out
 * is to abandon the conversation.
 *
 * That is not hypothetical: it happened twice in one morning of local work, and
 * the cause both times was a workflow that could not even RUN — a history the
 * worker could no longer replay. Which is exactly why no amount of cleanup
 * INSIDE the workflow can fix this class of bug. The reconciliation has to live
 * outside it and treat Temporal as the authority.
 *
 * ## Why this reconciles instead of removing the cache
 *
 * The obvious "root fix" is to stop caching liveness and let Temporal's own
 * workflow-id conflict be the gate. It does not work here, and the reason is
 * worth writing down so nobody re-derives it: commands reach Temporal through a
 * transactional OUTBOX, deliberately, so that a run row and its workflow can
 * never disagree about whether the turn was accepted. That makes the start
 * ASYNCHRONOUS — Temporal's answer arrives ~250ms after the HTTP request has
 * already been answered. Gating on it would turn today's honest synchronous 409
 * into a 201 that later turns out to be a refusal, which is the same lie in a
 * different costume.
 *
 * So the cache stays, and what gets fixed is the thing that actually hurt: the
 * cache being wrong FOREVER, unnoticed. It is verified at the one moment it
 * would otherwise refuse someone, and corrected in place.
 *
 * ## `absent` is not `dead`
 *
 * A run whose start command has not left the outbox has no execution to find.
 * Reaping on "not found" would kill turns at the moment they are being born.
 * The outbox already records what happened to that command, so the distinction
 * is drawn from a FACT rather than from a grace period someone had to guess:
 *
 *   pending      the start has not gone out yet — the turn is being born, leave it
 *   dispatched   Temporal accepted it, so an absent execution is a gone one
 *   dead_letter  the start will never go out — the workflow does not and will
 *                not exist, which is a silent wedge of its own
 */
@Injectable()
export class StudioAgentRunReaper {
  private readonly logger = new Logger(StudioAgentRunReaper.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly temporal: StudioAgentTemporalTransport,
    private readonly runTerminal: StudioAgentRunTerminalService,
  ) {}

  /**
   * Free a thread whose active run is no longer being executed by anything.
   *
   * Returns the run id it reaped, or null when the thread is genuinely busy —
   * or when the answer could not be established, which is the same outcome for
   * the caller and deliberately so: during a Temporal outage the honest move is
   * to leave the thread alone rather than reap live turns.
   */
  async reconcileThread(threadId: string): Promise<string | null> {
    const thread = await this.prisma.studioAgentThread.findUnique({
      where: { id: threadId },
      select: { activeRunId: true },
    });
    const activeRunId = thread?.activeRunId;
    if (!activeRunId) return null;

    const run = await this.prisma.studioAgentRun.findUnique({
      where: { id: activeRunId },
      select: { id: true, workflowId: true, status: true },
    });
    // A pointer at a run that does not exist is wrong on its face; nothing is
    // executing it, so nothing will ever clear it.
    if (!run) {
      await this.clearDanglingPointer(threadId, activeRunId);
      return activeRunId;
    }

    let liveness: 'open' | 'closed' | 'absent';
    try {
      liveness = await this.temporal.executionLiveness(run.workflowId);
    } catch (error) {
      this.logger.warn(
        `Could not establish liveness for run ${run.id}; leaving the thread as it is: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }

    if (liveness === 'open') return null;
    if (liveness === 'absent' && !(await this.startWasAttempted(run.id))) {
      // Being born. The outbox has not dispatched its start yet.
      return null;
    }

    await this.reap(threadId, run.id, liveness);
    return run.id;
  }

  /**
   * Did the start command for this run already leave the outbox — or fail
   * permanently, which is the same thing for our purposes: either way, no
   * further attempt is coming and an absent execution is an absent one.
   */
  private async startWasAttempted(runId: string): Promise<boolean> {
    const command = await this.prisma.studioAgentCommandOutbox.findUnique({
      where: { idempotencyKey: `run:${runId}:start` },
      select: { status: true },
    });
    // No command row at all means the outbox entry has already been reaped by
    // its own retention, which only happens well after dispatch.
    if (!command) return true;
    return command.status !== 'pending';
  }

  private async reap(
    threadId: string,
    runId: string,
    liveness: 'closed' | 'absent',
  ): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(async (transaction) => {
      const run = await transaction.studioAgentRun.findUnique({
        where: { id: runId },
      });
      // Re-read inside the transaction: the workflow may have reported its own
      // terminal between the describe and here, and its answer is the specific
      // one.
      if (!run) return;
      await this.runTerminal.terminalizeInTransaction(
        transaction,
        run,
        {
          status: 'failed',
          reason: 'The workflow executing this turn is no longer running.',
          error: {
            code: 'runtime.workflow_vanished',
            message:
              liveness === 'closed'
                ? 'The workflow executing this turn closed without reporting an outcome.'
                : 'The workflow executing this turn does not exist.',
            retryable: true,
            details: null,
          },
        },
        now,
      );
    });
    this.logger.warn(
      `Reaped run ${runId} on thread ${threadId}: its workflow is ${liveness}. ` +
        'The thread was refusing new messages and is now free.',
    );
  }

  private async clearDanglingPointer(
    threadId: string,
    activeRunId: string,
  ): Promise<void> {
    await this.prisma.studioAgentThread.updateMany({
      where: { id: threadId, activeRunId },
      data: { activeRunId: null },
    });
    this.logger.warn(
      `Thread ${threadId} pointed at run ${activeRunId}, which does not exist. Pointer cleared.`,
    );
  }
}
