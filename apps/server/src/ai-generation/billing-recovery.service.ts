import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { backgroundTasksEnabled } from '../common/background-tasks';
import { PrismaService } from '../infra/db/db.module';
import { AiGenerationRepository } from './repository';
import { AiGenerationBillingWalletService } from './billing-wallet.service';

/** Repair terminal wallet work without ever resubmitting a provider generation. */
@Injectable()
export class AiGenerationBillingRecoveryService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(AiGenerationBillingRecoveryService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private cursor?: string;
  private stopping = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: AiGenerationRepository,
    private readonly wallet: AiGenerationBillingWalletService,
  ) {}

  onApplicationBootstrap() {
    if (!backgroundTasksEnabled()) return;
    const tick = () => {
      if (this.running || this.stopping) return;
      this.running = this.recover()
        .catch((error: unknown) => {
          this.logger.error(
            `Generation billing recovery failed: ${String(error)}`,
          );
        })
        .finally(() => {
          this.running = undefined;
        });
    };
    tick();
    this.timer = setInterval(tick, 30_000);
    this.timer.unref();
  }

  async onApplicationShutdown() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  async recover() {
    if (this.stopping || !backgroundTasksEnabled()) return;
    // Include soft-deleted jobs: hiding a generation must not strand its hold.
    // The existing ledger's source index makes the correlated balance lookup bounded
    // per job. Cursor pagination prevents a permanently broken wallet starving others.
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT j.id FROM ai_jobs j
      WHERE j.status::text IN ('completed', 'failed', 'cancelled', 'expired')
        AND (${this.cursor ?? null}::uuid IS NULL OR j.id > ${this.cursor ?? null}::uuid)
        AND EXISTS (
          SELECT e.account_id FROM wallet_transactions t
          JOIN wallet_ledger_entries e ON e.transaction_id = t.id
          WHERE t.source_type = 'ai_job' AND t.source_id = j.id::text
          GROUP BY e.account_id HAVING SUM(e.held_delta) > 0
        )
      ORDER BY j.id LIMIT 100
    `);
    this.cursor = rows.length === 100 ? rows[rows.length - 1].id : undefined;
    for (const row of rows) {
      if (this.stopping) break;
      try {
        const job = await this.jobs.findById(row.id, { includeDeleted: true });
        if (!job) continue;
        // Terminal outcomes are authoritative; completed output is settled, never refunded.
        // Both wallet methods lock/recheck and are idempotent across replicas and races
        // with the normal completion/failure lifecycle.
        if (job.status === 'completed') await this.wallet.settleForJob(job);
        else if (['failed', 'cancelled', 'expired'].includes(job.status)) {
          await this.wallet.releaseForJob(job, 'ai_job_terminal_recovery');
        }
      } catch (error) {
        this.logger.error(
          `Generation billing recovery failed for ${row.id}: ${String(error)}`,
        );
      }
    }
  }
}
