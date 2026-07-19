/**
 * QuotaService — atomic consume / refund / peek backed by Redis Lua.
 *
 * Why Lua: GET → check → INCR has a multi-pod race that can let two
 * concurrent submissions both pass the quota check at "used=4 of 5"
 * and both INCR to 6. The consume.lua script collapses the whole
 * sequence into one atomic Redis op (single round-trip via EVALSHA).
 *
 * Failure policy is explicit at the domain boundary. General callers default
 * to fail-open and preserve the durable audit trail; paid state machines pass
 * `failureMode: 'closed'` and never admit work Redis could not account for.
 * Both policies use the same bounded strict Redis client, so fail-open changes
 * the business decision after an error without introducing an offline queue or
 * a second quota implementation.
 *
 * Dual write: every successful consume / refund mirrors to
 * QuotaUsageLogService for the durable audit ledger. Redis is the
 * hot path; PG is the source of truth for reconciliation, analytics,
 * and admin compensations.
 */
import { createHash } from 'crypto';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import type Redis from 'ioredis';
import type { QuotaDimension } from '@prisma/client';
import type { QuotaSnapshotWire, WireLimit } from '@repo/shared';
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
  utcDayKey,
  utcMonthKey,
} from './quota-keys';
import { QUOTA_STRICT_REDIS } from './quota-strict-redis';
import {
  quotaLimitFor,
  type ConsumeArgs,
  type ConsumeResult,
  type QuotaLimits,
  type QuotaPeek,
  type QuotaFailurePolicy,
  type QuotaPlanProfile,
  type QuotaSnapshot,
  type QuotaWindow,
  type RefundArgs,
} from './quota.types';

const CONSUME_SCRIPT = readFileSync(
  join(__dirname, 'lua', 'consume.lua'),
  'utf8',
);
const REFUND_SCRIPT = readFileSync(
  join(__dirname, 'lua', 'refund.lua'),
  'utf8',
);
const RATE_LIMIT_SCRIPT = readFileSync(
  join(__dirname, 'lua', 'rate-limit.lua'),
  'utf8',
);
const CONSUME_SHA = scriptSha(CONSUME_SCRIPT);
const REFUND_SHA = scriptSha(REFUND_SCRIPT);
const RATE_LIMIT_SHA = scriptSha(RATE_LIMIT_SCRIPT);
const MAX_OPERATION_KEY_BYTES = 512;

@Injectable()
export class QuotaService implements OnModuleInit {
  private readonly logger = new Logger(QuotaService.name);
  constructor(
    @Inject(QUOTA_STRICT_REDIS) private readonly strictRedis: Redis,
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
    // paying the script-upload latency. This is only an optimization:
    // executeScript performs a content-addressed EVAL on NOSCRIPT, so a
    // Redis restart cannot leave quota admission permanently degraded.
    try {
      await Promise.all([
        this.strictRedis.script('LOAD', CONSUME_SCRIPT),
        this.strictRedis.script('LOAD', REFUND_SCRIPT),
        this.strictRedis.script('LOAD', RATE_LIMIT_SCRIPT),
      ]);
      this.logger.log('quota Lua scripts loaded');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `quota Lua SCRIPT LOAD failed: ${msg} — requests will lazy-load after Redis recovers`,
      );
    }
  }

  // ─── consume ────────────────────────────────────────────────────

  async consume(args: ConsumeArgs): Promise<ConsumeResult> {
    const { userId, profile, dimension, reason, metadata } = args;
    assertOperationKey(args.idempotencyKey);
    const scopedIdempotencyKey = args.idempotencyKey
      ? idemKey(userId, dimension, args.idempotencyKey)
      : undefined;
    const cost = Math.max(1, Math.floor(args.cost ?? 1));
    const rawLimit = quotaLimitFor(profile.limits, dimension);
    const isUnlimited = !Number.isFinite(rawLimit);
    const dayLimit = isUnlimited ? -1 : rawLimit;
    const idempotencyTtl = resolveIdempotencyTtl(args);
    const window = resolveQuotaWindow(args.window);

    // Hot path — Redis Lua. The caller's declared policy owns failures.
    try {
      const command = [
        3,
        dayKey(userId, dimension, window.dayBucket),
        monthKey(userId, dimension, window.monthBucket),
        scopedIdempotencyKey ?? '',
        String(cost),
        String(dayLimit),
        String(DAY_TTL_SEC),
        String(MONTH_TTL_SEC),
        String(idempotencyTtl),
      ] as const;
      const result = (await this.executeScript(
        CONSUME_SHA,
        CONSUME_SCRIPT,
        command,
      )) as [string, string, string, string];

      const [status, usedStr, limitStr, dedupedStr] = result;
      const used = Number.parseInt(usedStr, 10);
      const luaLimit = Number.parseInt(limitStr, 10);
      const reportedLimit = luaLimit < 0 ? Number.POSITIVE_INFINITY : luaLimit;
      const deduped = dedupedStr === '1';

      if (status === 'exceeded') {
        const upgrade = profile.upgrade;
        const upgradeLimit = upgrade
          ? quotaLimitFor(upgrade.limits, dimension)
          : null;
        return {
          ok: false,
          reason: 'quota_exceeded',
          dimension,
          used,
          limit: reportedLimit,
          resetAt: nextUtcMidnight(),
          // Upgrade suggestion derives from plan-row rank ordering
          // (EntitlementService.quotaProfileFor), not a tier ladder.
          nextTier: upgrade?.tier ?? null,
          nextPlanKey: upgrade?.planKey ?? null,
          nextTierLimit:
            upgradeLimit === null
              ? null
              : Number.isFinite(upgradeLimit)
                ? upgradeLimit
                : -1,
        };
      }

      // Audit ledger write (fire-and-forget; never blocks).
      if (!deduped) {
        this.auditLog.log({
          userId,
          dimension,
          cost,
          reason,
          idempotencyKey: scopedIdempotencyKey,
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
        if (window.dayBucket === utcDayKey()) {
          void this.events.publishUpdate(
            userId,
            this.buildSnapshot(dimension, used, rawLimit),
          );
        }
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
      if (args.failureMode === 'closed') {
        this.logger.error(
          `consume(${userId}/${dimension}) Redis Lua failed closed: ${msg}`,
        );
        throw err instanceof Error
          ? err
          : new Error('Quota Redis consume failed.');
      }
      this.logger.warn(
        `consume(${userId}/${dimension}) Redis Lua failed → fail-open: ${msg}`,
      );
      // Fail-open: still write the audit row so PG reflects reality.
      this.auditLog.log({
        userId,
        dimension,
        cost,
        reason: `${reason}_failopen`,
        idempotencyKey: scopedIdempotencyKey,
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
    profile: QuotaPlanProfile,
    policy: QuotaFailurePolicy = { failureMode: 'open' },
  ): Promise<
    | { ok: true; remaining: number }
    | { ok: false; resetAt: string; limit: number }
  > {
    const limit = profile.limits.chatPerMinute;
    if (limit <= 0) return { ok: true, remaining: 0 };
    try {
      const key = minuteKey(userId);
      const used = Number(
        await this.executeScript(RATE_LIMIT_SHA, RATE_LIMIT_SCRIPT, [
          1,
          key,
          String(MINUTE_TTL_SEC),
        ]),
      );
      if (!Number.isSafeInteger(used) || used < 1) {
        throw new Error('Invalid quota rate-limit result.');
      }
      if (used > limit) {
        return { ok: false, resetAt: nextUtcMinute(), limit };
      }
      return { ok: true, remaining: Math.max(0, limit - used) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (policy.failureMode === 'closed') {
        this.logger.error(`checkChatRate Redis failed closed: ${msg}`);
        throw err instanceof Error
          ? err
          : new Error('Quota Redis rate admission failed.');
      }
      this.logger.warn(`checkChatRate Redis failed → fail-open: ${msg}`);
      return { ok: true, remaining: 0 };
    }
  }

  // ─── refund ─────────────────────────────────────────────────────

  refund(args: RefundArgs): Promise<{ ok: true; status: string }> {
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
      return Promise.resolve({ ok: true, status: 'stub' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`refund() failed: ${msg}`);
      return Promise.resolve({ ok: true, status: 'error' });
    }
  }

  /**
   * Typed refund — caller passes dimension + cost it originally
   * consumed, plus the subject's resolved limits so the WS snapshot
   * pushed to the client carries the correct limit (not a sentinel).
   *
   * Idempotent via the Lua refund script: same idempotencyKey can be
   * called multiple times safely (worker terminal-fail + downstream
   * controller throw can both run for the same job and only the first
   * actually decrements the counter).
   *
   * `limits` comes from the debit receipt (or a fresh entitlement
   * resolution for background reconcilers). Without it, the WS
   * snapshot would have to ship `"Infinity"` and the client provider
   * would clobber its cached real limit — Free users would see ∞
   * until the next manual refresh; the refund itself never depends on it.
   */
  async refundFor(args: {
    userId: string;
    limits?: QuotaLimits;
    dimension: QuotaDimension;
    cost: number;
    idempotencyKey: string;
    reason?: string;
    /** Exact persisted windows used by the original debit. */
    window?: QuotaWindow;
    /** Permanent attempt fence: even a missing debit writes FINAL_REFUNDED. */
    terminalFence?: boolean;
  }): Promise<{ ok: true; status: 'ok' | 'no_idem' | 'already' | 'failed' }> {
    assertOperationKey(args.idempotencyKey);
    const scopedIdempotencyKey = idemKey(
      args.userId,
      args.dimension,
      args.idempotencyKey,
    );
    const cost = Math.max(1, Math.floor(args.cost));
    const window = resolveQuotaWindow(args.window);
    try {
      const command = [
        3,
        dayKey(args.userId, args.dimension, window.dayBucket),
        monthKey(args.userId, args.dimension, window.monthBucket),
        scopedIdempotencyKey,
        String(cost),
        args.terminalFence ? '1' : '0',
      ] as const;
      const result = (await this.executeScript(
        REFUND_SHA,
        REFUND_SCRIPT,
        command,
      )) as [string, string, string];
      const [status, dayUsedStr, dayExistedStr] = result;
      if (status === 'ok') {
        this.auditLog.log({
          userId: args.userId,
          dimension: args.dimension,
          cost: -cost,
          reason: args.reason ?? 'refund',
          idempotencyKey: scopedIdempotencyKey,
        });
        // Never publish an old-window counter as today's snapshot. An expired
        // day key is intentionally skipped by Lua and likewise emits nothing.
        if (
          args.limits &&
          window.dayBucket === utcDayKey() &&
          dayExistedStr === '1'
        ) {
          const used = Number.parseInt(dayUsedStr, 10);
          const rawLimit = quotaLimitFor(args.limits, args.dimension);
          void this.events.publishUpdate(
            args.userId,
            this.buildSnapshot(args.dimension, used, rawLimit),
          );
        }
      }
      return { ok: true, status: status as 'ok' | 'no_idem' | 'already' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`refundFor Redis failed: ${msg}`);
      return { ok: true, status: 'failed' };
    }
  }

  /**
   * A durable domain keeps its in-flight idempotency key persistent. Once PG
   * has made success/refund terminal, bound the Redis record again so the hot
   * ledger cannot grow forever. Missing keys are already finalized.
   */
  async finalizeIdempotencyFor(args: {
    userId: string;
    dimension: QuotaDimension;
    idempotencyKey: string;
    ttlSeconds?: number;
  }): Promise<{ ok: true; status: 'ok' | 'missing' | 'failed' }> {
    assertOperationKey(args.idempotencyKey);
    const ttlSeconds = args.ttlSeconds ?? IDEM_TTL_SEC;
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1) {
      throw new Error('Invalid quota idempotency finalization TTL.');
    }
    const scopedIdempotencyKey = idemKey(
      args.userId,
      args.dimension,
      args.idempotencyKey,
    );
    try {
      const changed = await this.strictRedis.expire(
        scopedIdempotencyKey,
        ttlSeconds,
      );
      return { ok: true, status: changed === 1 ? 'ok' : 'missing' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`quota idempotency finalization failed: ${message}`);
      return { ok: true, status: 'failed' };
    }
  }

  // ─── peek ───────────────────────────────────────────────────────

  async peek(userId: string, profile: QuotaPlanProfile): Promise<QuotaPeek> {
    const dimensions: QuotaDimension[] = [
      'image',
      'chat',
      'workflow',
      'upload',
    ];
    const resetAt = nextUtcMidnight();
    const minuteResetAt = nextUtcMinute();

    const used = await this.batchGet(dimensions.map((d) => dayKey(userId, d)));
    // Direct GET on the exact minute key. batchGet buckets by the
    // dimension segment ('chat' for the minute key too), which used to
    // make peek read a nonexistent '_' bucket and always report the
    // full per-minute limit as remaining.
    const minuteUsed = await this.getCounter(minuteKey(userId));

    const snapshot: Record<QuotaDimension, QuotaSnapshot> = {} as never;
    for (const dim of dimensions) {
      const rawLimit = quotaLimitFor(profile.limits, dim);
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

    const chatMinuteLimit = profile.limits.chatPerMinute;
    return {
      tier: profile.tier,
      dimensions: snapshot,
      chatPerMinute: {
        limit: chatMinuteLimit,
        remaining: Math.max(0, chatMinuteLimit - minuteUsed),
        resetAt: minuteResetAt,
      },
    };
  }

  // ─── helpers ────────────────────────────────────────────────────

  private async batchGet(keys: string[]): Promise<Record<string, number>> {
    if (keys.length === 0) return {};
    try {
      const vals = await this.strictRedis.mget(...keys);
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

  /** Read a single counter key — observational, degrades to 0 on error. */
  private async getCounter(key: string): Promise<number> {
    try {
      const value = await this.strictRedis.get(key);
      const parsed = Number.parseInt(value ?? '0', 10);
      return Number.isFinite(parsed) ? parsed : 0;
    } catch {
      return 0;
    }
  }

  private async executeScript(
    sha: string,
    script: string,
    command: readonly [number, ...Array<string | number>],
  ): Promise<unknown> {
    try {
      return await this.strictRedis.evalsha(sha, ...command);
    } catch (error) {
      if (!isNoScriptError(error)) throw error;
      // EVAL both executes and repopulates Redis' script cache. The SHA is
      // content-derived, so subsequent calls return to EVALSHA automatically.
      return this.strictRedis.eval(script, ...command);
    }
  }
}

function assertOperationKey(value: string | undefined): void {
  if (value === undefined) return;
  if (
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > MAX_OPERATION_KEY_BYTES ||
    containsControlCharacter(value)
  ) {
    throw new Error('Invalid quota idempotency operation key.');
  }
}

function resolveIdempotencyTtl(args: ConsumeArgs): number {
  if (!args.idempotencyKey) return 0;
  if (args.idempotencyTtlSeconds === 'persistent') return -1;
  const ttl = args.idempotencyTtlSeconds ?? IDEM_TTL_SEC;
  if (!Number.isSafeInteger(ttl) || ttl < 1) {
    throw new Error('Invalid quota idempotency TTL.');
  }
  return ttl;
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
      return true;
    }
  }
  return false;
}

function scriptSha(script: string): string {
  return createHash('sha1').update(script, 'utf8').digest('hex');
}

function isNoScriptError(error: unknown): boolean {
  return (
    error instanceof Error && /(?:^|\s)NOSCRIPT(?:\s|$)/i.test(error.message)
  );
}

function resolveQuotaWindow(window: QuotaWindow | undefined): QuotaWindow {
  if (!window) {
    return { dayBucket: utcDayKey(), monthBucket: utcMonthKey() };
  }
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(window.dayBucket) ||
    !/^\d{4}-\d{2}$/.test(window.monthBucket) ||
    window.dayBucket.slice(0, 7) !== window.monthBucket ||
    new Date(`${window.dayBucket}T00:00:00.000Z`).toISOString().slice(0, 10) !==
      window.dayBucket
  ) {
    throw new Error('Invalid quota UTC window.');
  }
  return window;
}
