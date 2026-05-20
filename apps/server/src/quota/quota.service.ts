/**
 * QuotaService — atomic consume / refund / peek backed by Redis Lua.
 *
 * Why Lua: GET → check → INCR has a multi-pod race that can let two
 * concurrent submissions both pass the quota check at "used=4 of 5"
 * and both INCR to 6. The consume.lua script collapses the whole
 * sequence into one atomic Redis op (single round-trip via EVALSHA).
 *
 * Fail-open on Redis outage: a missed quota for 30 seconds is much
 * better than every paid feature going dark. Errors here are logged
 * + the call returns `ok:true` with a sentinel `used=NaN`, and the
 * audit log (QuotaUsageLogService) still records the event so reality
 * can be reconciled from PG later. The cost ceiling is still bounded
 * by BullMQ concurrency (per IMAGE_WORKER_CONCURRENCY), not Redis.
 *
 * Dual write: every successful consume / refund mirrors to
 * QuotaUsageLogService for the durable audit ledger. Redis is the
 * hot path; PG is the source of truth for reconciliation, analytics,
 * and admin compensations.
 */
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import type Redis from 'ioredis';
import type { QuotaDimension } from '@prisma/client';
import type { QuotaSnapshotWire, WireLimit } from '@repo/shared';
import { REDIS } from '../infra/redis/redis.module';
import { QuotaEventsService } from './quota-events.service';
import { QuotaUsageLogService } from './quota-usage-log.service';
import {
  DAY_TTL_SEC,
  IDEM_TTL_SEC,
  MINUTE_TTL_SEC,
  MONTH_TTL_SEC,
  dayKey,
  idempotencyKey as idemKey,
  minuteKey,
  monthKey,
  nextUtcMidnight,
  nextUtcMinute,
} from './quota-keys';
import { TIERS, type Tier, nextTier as nextTierAbove } from './tiers.config';
import type {
  ConsumeArgs,
  ConsumeResult,
  QuotaPeek,
  QuotaSnapshot,
  RefundArgs,
} from './quota.types';

const CONSUME_SCRIPT = readFileSync(
  join(__dirname, 'lua', 'consume.lua'),
  'utf8',
);
const REFUND_SCRIPT = readFileSync(
  join(__dirname, 'lua', 'refund.lua'),
  'utf8',
);

@Injectable()
export class QuotaService implements OnModuleInit {
  private readonly logger = new Logger(QuotaService.name);
  private consumeSha: string | null = null;
  private refundSha: string | null = null;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly auditLog: QuotaUsageLogService,
    private readonly events: QuotaEventsService,
  ) {}

  /** Helper — build the wire snapshot for a single consume/refund result. */
  private buildSnapshot(
    dimension: QuotaDimension,
    used: number,
    rawLimit: number,
  ): QuotaSnapshotWire {
    const isUnlimited = !Number.isFinite(rawLimit);
    const wireLimit: WireLimit = isUnlimited ? 'Infinity' : rawLimit;
    const remaining: WireLimit = isUnlimited
      ? 'Infinity'
      : Math.max(0, rawLimit - used);
    return {
      dimension,
      used: Number.isFinite(used) ? used : 0,
      limit: wireLimit,
      remaining,
      percent: isUnlimited
        ? 0
        : Math.min(100, (used / Math.max(1, rawLimit)) * 100),
      resetAt: nextUtcMidnight(),
    };
  }

  async onModuleInit() {
    // SCRIPT LOAD up front so the hot path can EVALSHA without
    // ever paying the script-upload latency. NOSCRIPT mid-flight is
    // handled by ioredis transparently (it re-uploads on demand).
    try {
      this.consumeSha = (await this.redis.script(
        'LOAD',
        CONSUME_SCRIPT,
      )) as string;
      this.refundSha = (await this.redis.script(
        'LOAD',
        REFUND_SCRIPT,
      )) as string;
      this.logger.log('quota Lua scripts loaded');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `quota Lua SCRIPT LOAD failed: ${msg} — fail-open path will run`,
      );
    }
  }

  // ─── consume ────────────────────────────────────────────────────

  async consume(args: ConsumeArgs): Promise<ConsumeResult> {
    const { userId, tier, dimension, reason, metadata } = args;
    const cost = Math.max(1, Math.floor(args.cost ?? 1));
    const limits = TIERS[tier];
    const rawLimit = limits[dimension === 'upload' ? 'uploadMB' : dimension];
    const isUnlimited = !Number.isFinite(rawLimit);
    const dayLimit = isUnlimited ? -1 : rawLimit;

    // Hot path — Redis Lua. Falls back to fail-open on any error.
    try {
      const result = (await this.redis.evalsha(
        this.consumeSha as string,
        3,
        dayKey(userId, dimension),
        monthKey(userId, dimension),
        args.idempotencyKey ? idemKey(args.idempotencyKey) : '',
        String(cost),
        String(dayLimit),
        String(DAY_TTL_SEC),
        String(MONTH_TTL_SEC),
        String(args.idempotencyKey ? IDEM_TTL_SEC : 0),
      )) as [string, string, string, string];

      const [status, usedStr, limitStr, dedupedStr] = result;
      const used = Number.parseInt(usedStr, 10);
      const luaLimit = Number.parseInt(limitStr, 10);
      const reportedLimit = luaLimit < 0 ? Number.POSITIVE_INFINITY : luaLimit;
      const deduped = dedupedStr === '1';

      if (status === 'exceeded') {
        return {
          ok: false,
          reason: 'quota_exceeded',
          dimension,
          used,
          limit: reportedLimit,
          resetAt: nextUtcMidnight(),
          nextTier: nextTierAbove(tier),
          nextTierLimit: this.peekNextTierLimit(tier, dimension),
        };
      }

      // Audit ledger write (fire-and-forget; never blocks).
      if (!deduped) {
        this.auditLog.log({
          userId,
          dimension,
          cost,
          reason,
          idempotencyKey: args.idempotencyKey,
          // Cast: Prisma's InputJsonValue is structurally narrower
          // than Record<string, unknown> but works for the keys we
          // pass (string-keyed primitives). Worst case JSON-stringify
          // throws on a circular value, which we'd catch upstream.
          metadata: metadata as never,
        });
        // Push WS update so every open tab refreshes the badge
        // without waiting for the next GET /aurora/quota. Same
        // fire-and-forget pattern: a Redis hiccup degrades to
        // "badge stale until next manual fetch", not a 500.
        void this.events.publishUpdate(
          userId,
          this.buildSnapshot(dimension, used, rawLimit),
        );
      }

      return {
        ok: true,
        dimension,
        used,
        limit: reportedLimit,
        remaining: isUnlimited
          ? Number.POSITIVE_INFINITY
          : Math.max(0, reportedLimit - used),
        deduped,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `consume(${userId}/${dimension}) Redis Lua failed → fail-open: ${msg}`,
      );
      // Fail-open: still write the audit row so PG reflects reality.
      this.auditLog.log({
        userId,
        dimension,
        cost,
        reason: `${reason}_failopen`,
        idempotencyKey: args.idempotencyKey,
        metadata: metadata as never,
      });
      return {
        ok: true,
        dimension,
        used: Number.NaN,
        limit: rawLimit,
        remaining: isUnlimited ? Number.POSITIVE_INFINITY : Number.NaN,
        deduped: false,
      };
    }
  }

  // ─── chat per-minute rate limit ─────────────────────────────────

  async checkChatRate(
    userId: string,
    tier: Tier,
  ): Promise<
    | { ok: true; remaining: number }
    | { ok: false; resetAt: string; limit: number }
  > {
    const limit = TIERS[tier].chatPerMinute;
    if (limit <= 0) return { ok: true, remaining: 0 };
    try {
      const key = minuteKey(userId);
      const used = await this.redis.incr(key);
      if (used === 1) {
        await this.redis.expire(key, MINUTE_TTL_SEC);
      }
      if (used > limit) {
        return { ok: false, resetAt: nextUtcMinute(), limit };
      }
      return { ok: true, remaining: Math.max(0, limit - used) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`checkChatRate Redis failed → fail-open: ${msg}`);
      return { ok: true, remaining: 0 };
    }
  }

  // ─── refund ─────────────────────────────────────────────────────

  async refund(args: RefundArgs): Promise<{ ok: true; status: string }> {
    try {
      // We need to know dimension + cost to refund correctly. Encode
      // by reading the audit log for this idempotency key — Phase 2
      // takes the simple path and refunds 1 unit on whatever dimension
      // the caller specifies. Phase 2.5 will look up via SUM().
      // For now: callers MUST track their own dimension + cost.
      // This service signature will tighten in a follow-up.
      this.logger.warn(
        'refund() Phase 2 stub — caller-managed dimension/cost; ' +
          'use refundFor(...) instead for v2',
      );
      this.auditLog.log({
        userId: args.userId,
        dimension: 'image',
        cost: -1,
        reason: args.reason ?? 'refund_unknown',
        idempotencyKey: args.idempotencyKey,
      });
      return { ok: true, status: 'stub' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`refund() failed: ${msg}`);
      return { ok: true, status: 'error' };
    }
  }

  /**
   * Typed refund — caller passes dimension + cost it originally
   * consumed, plus the user's tier so the WS snapshot pushed to the
   * client carries the correct limit (not a sentinel).
   *
   * Idempotent via the Lua refund script: same idempotencyKey can be
   * called multiple times safely (worker terminal-fail + downstream
   * controller throw can both run for the same job and only the first
   * actually decrements the counter).
   *
   * `tier` is required because the worker / controller knows the
   * user's tier at the time of the original consume (stored on the
   * AiJob row, or derived from req.user). Without it, the WS
   * snapshot would have to ship `"Infinity"` and the client provider
   * would clobber its cached real limit — Free users would see ∞
   * until the next manual refresh.
   */
  async refundFor(args: {
    userId: string;
    tier: Tier;
    dimension: QuotaDimension;
    cost: number;
    idempotencyKey: string;
    reason?: string;
  }): Promise<{ ok: true; status: 'ok' | 'no_idem' | 'already' | 'failed' }> {
    const cost = Math.max(1, Math.floor(args.cost));
    try {
      const result = (await this.redis.evalsha(
        this.refundSha as string,
        3,
        dayKey(args.userId, args.dimension),
        monthKey(args.userId, args.dimension),
        idemKey(args.idempotencyKey),
        String(cost),
      )) as [string, string];
      const [status, dayUsedStr] = result;
      if (status === 'ok') {
        this.auditLog.log({
          userId: args.userId,
          dimension: args.dimension,
          cost: -cost,
          reason: args.reason ?? 'refund',
          idempotencyKey: args.idempotencyKey,
        });
        const used = Number.parseInt(dayUsedStr, 10);
        const rawLimit =
          TIERS[args.tier][
            args.dimension === 'upload' ? 'uploadMB' : args.dimension
          ];
        void this.events.publishUpdate(
          args.userId,
          this.buildSnapshot(args.dimension, used, rawLimit),
        );
      }
      return { ok: true, status: status as 'ok' | 'no_idem' | 'already' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`refundFor Redis failed: ${msg}`);
      return { ok: true, status: 'failed' };
    }
  }

  // ─── peek ───────────────────────────────────────────────────────

  async peek(userId: string, tier: Tier): Promise<QuotaPeek> {
    const dimensions: QuotaDimension[] = [
      'image',
      'chat',
      'workflow',
      'upload',
    ];
    const resetAt = nextUtcMidnight();
    const minuteResetAt = nextUtcMinute();

    const used = await this.batchGet(dimensions.map((d) => dayKey(userId, d)));
    const minuteUsed = await this.batchGet([minuteKey(userId)]);

    const snapshot: Record<QuotaDimension, QuotaSnapshot> = {} as never;
    for (const dim of dimensions) {
      const rawLimit = TIERS[tier][dim === 'upload' ? 'uploadMB' : dim];
      const isUnlimited = !Number.isFinite(rawLimit);
      const usedVal = used[dim] ?? 0;
      snapshot[dim] = {
        dimension: dim,
        used: usedVal,
        limit: rawLimit,
        remaining: isUnlimited
          ? Number.POSITIVE_INFINITY
          : Math.max(0, rawLimit - usedVal),
        percent: isUnlimited
          ? 0
          : Math.min(100, (usedVal / Math.max(1, rawLimit)) * 100),
        resetAt,
      };
    }

    const chatMinuteLimit = TIERS[tier].chatPerMinute;
    return {
      tier,
      dimensions: snapshot,
      chatPerMinute: {
        limit: chatMinuteLimit,
        remaining: Math.max(0, chatMinuteLimit - (minuteUsed['_'] ?? 0)),
        resetAt: minuteResetAt,
      },
    };
  }

  // ─── helpers ────────────────────────────────────────────────────

  private async batchGet(keys: string[]): Promise<Record<string, number>> {
    if (keys.length === 0) return {};
    try {
      const vals = await this.redis.mget(...keys);
      const out: Record<string, number> = {};
      for (let i = 0; i < keys.length; i += 1) {
        const k = keys[i];
        // Bucket by the dimension suffix or fall back to the full key.
        const dim = k.split(':')[2] ?? '_';
        out[dim] = Number.parseInt(vals[i] ?? '0', 10);
      }
      return out;
    } catch {
      return {};
    }
  }

  private peekNextTierLimit(current: Tier, dim: QuotaDimension): number | null {
    const next = nextTierAbove(current);
    if (!next) return null;
    const lim = TIERS[next][dim === 'upload' ? 'uploadMB' : dim];
    return Number.isFinite(lim) ? lim : -1;
  }
}
