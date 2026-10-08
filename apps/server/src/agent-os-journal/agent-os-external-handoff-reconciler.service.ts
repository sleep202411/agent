import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import { backgroundTasksEnabled } from '../common/background-tasks';
import { journalErrorText } from './agent-os-journal.mapper';
import { AgentOsRunJournalService } from './agent-os-run-journal.service';

const SWEEP_INTERVAL_MS = 5_000;
const RECOVERY_GRACE_MS = 30_000;
const BATCH_SIZE = 25;

/**
 * Repairs a Worker crash between domain job creation and RunPaused journaling.
 *
 * Normal Worker handoff persistence is immediate. The grace window prevents a
 * healthy Worker and the reconciler from competing for the same suffix, while
 * the immutable registration guarantees an actually crashed process cannot
 * strand the conversation forever.
 */
@Injectable()
export class AgentOsExternalHandoffReconcilerService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(
    AgentOsExternalHandoffReconcilerService.name,
  );
  private timer: ReturnType<typeof setInterval> | null = null;
  private draining = false;
  private stopped = false;
  // Advance past failures; wrap to retry them and newly eligible lower IDs.
  private recoveryCursor?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: AgentOsRunJournalService,
  ) {}

  onApplicationBootstrap(): void {
    if (!backgroundTasksEnabled() || this.stopped || this.timer) return;
    this.timer = setInterval(() => void this.drainOnce(), SWEEP_INTERVAL_MS);
    this.timer.unref();
    queueMicrotask(() => void this.drainOnce());
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async drainOnce(): Promise<void> {
    if (!backgroundTasksEnabled() || this.stopped || this.draining) return;
    this.draining = true;
    try {
      const candidates = await this.prisma.$queryRaw<
        Array<{ externalJobId: string }>
      >(Prisma.sql`
        SELECT registration."external_job_id" AS "externalJobId"
        FROM "agent_os_external_handoff_registrations" AS registration
        INNER JOIN "agent_os_runs" AS run
          ON run."id" = registration."source_agent_run_id"
        WHERE run."status" = 'running'
          ${this.recoveryCursor ? Prisma.sql`AND registration."external_job_id" > ${this.recoveryCursor}::uuid` : Prisma.empty}
          AND registration."created_at" <= NOW() - (${RECOVERY_GRACE_MS} * INTERVAL '1 millisecond')
          AND run."updated_at" <= NOW() - (${RECOVERY_GRACE_MS} * INTERVAL '1 millisecond')
          AND (run."start_execution_lease_expires_at" IS NULL OR run."start_execution_lease_expires_at" <= NOW())
          AND (run."continuation_execution_lease_expires_at" IS NULL OR run."continuation_execution_lease_expires_at" <= NOW())
          AND NOT EXISTS (
            SELECT 1 FROM "agent_os_run_events" AS resolved
            WHERE resolved."run_id" = run."id"
              AND resolved."type" = 'RunResumed'
              AND resolved."data"->>'externalJobId' = registration."external_job_id"::text
              AND resolved."data"->>'reason' LIKE 'external_job_%'
          )
        ORDER BY registration."external_job_id" ASC
        LIMIT ${BATCH_SIZE}
      `);
      for (const candidate of candidates) {
        if (!backgroundTasksEnabled() || this.stopped) break;
        try {
          await this.journal.reconcileExternalHandoff(candidate.externalJobId);
        } catch (error) {
          this.logger.warn(
            `Agent OS external handoff recovery failed job=${candidate.externalJobId}: ${journalErrorText(error)}`,
          );
        }
        this.recoveryCursor = candidate.externalJobId;
      }
      if (candidates.length < BATCH_SIZE) this.recoveryCursor = undefined;
    } catch (error) {
      this.logger.warn(
        `Agent OS external handoff recovery sweep failed: ${journalErrorText(error)}`,
      );
    } finally {
      this.draining = false;
    }
  }
}
