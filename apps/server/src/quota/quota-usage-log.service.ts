/**
 * QuotaUsageLogService — Phase 1 observation埋点.
 *
 * Writes one row to `quota_usage_log` per consumable user action.
 * Designed to be:
 *
 *   - Fire-and-forget: callers don't await; a DB hiccup never blocks
 *     the user action. Errors are logged + counted, never thrown.
 *   - Cheap: a single INSERT, no transaction, no read.
 *   - Symmetric: same shape for consume (cost > 0) and refund
 *     (cost < 0); reconcile via SUM() later.
 *
 * Phase 2 wires in Redis-backed counters (the hot path) and uses this
 * service in parallel as the durable audit ledger. Phase 5 turns on
 * hard enforcement via QuotaGuard. The shape of this service is
 * forward-compatible — calls written today don't need to change.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, QuotaDimension } from '@prisma/client';
import { newShortId } from '../common/id';
import { PrismaService } from '../infra/db/db.module';

export interface QuotaLogEvent {
  userId: string;
  dimension: QuotaDimension;
  /**
   * Signed cost. Positive = consume, negative = refund. Defaults to
   * +1 — most consumable actions are "one unit" (one image generate,
   * one chat message). Pass an explicit larger value for bulk
   * operations (e.g. upload counted in MB) or a negative value to
   * refund a previously-consumed unit.
   */
  cost?: number;
  /** Short label — `submit_message_to_agent`, `ai_job_create`, ... */
  reason: string;
  /** Optional dedup key to reconcile consume↔refund pairs later. */
  idempotencyKey?: string;
  /** Loose forensic metadata bag — kept opaque to this service. */
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class QuotaUsageLogService {
  private readonly logger = new Logger(QuotaUsageLogService.name);
  /** Drop chain after this many consecutive write failures so a Redis-
   *  saturated PG can't keep us spinning. Resets on the first success. */
  private consecutiveFailures = 0;
  private static readonly FAILURE_BUDGET = 32;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record a usage event. Caller must not await — failures here must
   * never block the user action being measured. Returns void; for
   * tests, exceptions are swallowed and counted internally.
   */
  log(event: QuotaLogEvent): void {
    if (this.consecutiveFailures > QuotaUsageLogService.FAILURE_BUDGET) {
      // Circuit-broken: DB is unhappy. Drop until next success and
      // let an external alert pick this up rather than continue to
      // hammer the connection pool from every controller.
      return;
    }
    const row = {
      id: newShortId(),
      userId: event.userId,
      dimension: event.dimension,
      cost: event.cost ?? 1,
      reason: event.reason.slice(0, 64),
      idempotencyKey: event.idempotencyKey ?? null,
      metadata: event.metadata ?? undefined,
    };
    // Fire-and-forget — `void` discards the promise so neither
    // unhandled-rejection nor caller awaiting can stall the request.
    void this.prisma.quotaUsageLog
      .create({ data: row })
      .then(() => {
        if (this.consecutiveFailures > 0) {
          this.logger.log(
            `quota_usage_log recovered after ${this.consecutiveFailures} failures`,
          );
        }
        this.consecutiveFailures = 0;
      })
      .catch((err: unknown) => {
        this.consecutiveFailures += 1;
        const msg = err instanceof Error ? err.message : String(err);
        // Avoid log spam — sample after the first few failures.
        if (this.consecutiveFailures <= 4) {
          this.logger.warn(
            `quota_usage_log write failed (${this.consecutiveFailures}): ${msg}`,
          );
        }
      });
  }
}
