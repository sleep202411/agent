/**
 * QuotaGuard — pre-consumes the configured quota before the route
 * handler runs. Rejects with HTTP 429 + a structured payload the
 * frontend renders as the UpgradeDialog.
 *
 * Wired as a regular (non-global) guard via `@UseGuards(QuotaGuard)`
 * + `@RequireQuota({...})` per route. Endpoints without metadata
 * pass through (the guard is a no-op).
 *
 * Refund semantics: this guard issues a request-local debit receipt after a
 * successful consume. QuotaInterceptor may refund only when that receipt says
 * this request actually incremented Redis; a dedup retry never owns the prior
 * request's debit.
 */
import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { QuotaService } from './quota.service';
import { EntitlementService } from '../entitlements';
import { QUOTA_METADATA_KEY, type QuotaRequirement } from './quota.decorator';
import { randomUUID } from 'crypto';
import type { AuthUser } from '../auth';
import type { QuotaDebitReceipt } from './quota.types';

const MAX_IDEMPOTENCY_KEY_BYTES = 200;
const SAFE_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9:_./-]+$/;

interface AuthedRequest extends Request {
  user?: AuthUser;
  /** A receipt exists only after QuotaService accepted this request. */
  __quotaConsumeReceipt?: QuotaDebitReceipt;
}

@Injectable()
export class QuotaGuard implements CanActivate {
  /**
   * Phase 8 observability — every consume/refund already writes a
   * row to `quota_usage_log` for durable audit; this guard's logger
   * additionally emits a structured warn line on rejections so Loki
   * / Kibana / kubectl-logs filters can spot tier-too-tight or
   * top-tier leakage issues without joining tables.
   *
   * Grep recipe:  `quota.reject` (one line per 429).
   *
   * Prometheus metrics (counter per dim/tier/outcome) deliberately
   * deferred — no prom-client / metrics route in the server yet,
   * and standing that infra up is an independent project.
   */
  private readonly logger = new Logger(QuotaGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly quota: QuotaService,
    private readonly entitlements: EntitlementService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const requirement = this.reflector.get<QuotaRequirement | undefined>(
      QUOTA_METADATA_KEY,
      ctx.getHandler(),
    );
    if (!requirement) return true;

    const user = req.user;
    if (!user?.userId) {
      // Should never happen — AuthGuard runs first. Defensive.
      return true;
    }
    const profile = await this.entitlements.quotaProfileForUser(user);

    const idem = resolveIdempotencyKey(req, requirement);

    // Per-minute rate limit pre-check — applies even to unlimited-cap
    // plans. A failure here is a different shape from quota_exceeded:
    // it's a "you're going too fast" signal, not "buy a bigger plan".
    if (requirement.rateLimitPerMinute) {
      const rl = await this.quota.checkChatRate(user.userId, profile);
      if (!rl.ok) {
        this.logger.warn(
          `quota.reject userId=${user.userId} tier=${profile.tier} dim=${requirement.dimension} reason=rate_limited limit=${rl.limit}/min resetAt=${rl.resetAt}`,
        );
        throw new HttpException(
          {
            code: 429,
            error: 'rate_limited',
            dimension: requirement.dimension,
            limit: rl.limit,
            resetAt: rl.resetAt,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    // Idempotency key — accept a client-supplied UUID via header by
    // default, OR pull from a body field when the decorator opts in
    // (ai-generation does this so retry-with-same-jobId only consumes
    // once). When neither source has a value we synthesise a UUID so
    // the QuotaInterceptor still has a key to refund against on
    // downstream failure. The cost of the synthesised key is that
    // double-clicks count twice — acceptable since the frontend
    // QuotaBlocker disables the button after the first click.
    const cost = Math.max(1, Math.floor(requirement.cost ?? 1));
    const result = await this.quota.consume({
      userId: user.userId,
      profile,
      dimension: requirement.dimension,
      cost: requirement.cost,
      idempotencyKey: idem,
      reason:
        requirement.reason ?? `${ctx.getClass().name}.${ctx.getHandler().name}`,
    });

    if (result.ok) {
      req.__quotaConsumeReceipt = {
        userId: user.userId,
        profile: {
          planKey: profile.planKey,
          tier: profile.tier,
          limits: profile.limits,
        },
        dimension: requirement.dimension,
        cost,
        idempotencyKey: idem,
        // QuotaService reports NaN only on its explicit Redis fail-open path;
        // no Redis debit exists to refund in that case.
        debited: !result.deduped && Number.isFinite(result.used),
      };
      return true;
    }

    this.logger.warn(
      `quota.reject userId=${user.userId} tier=${profile.tier} dim=${result.dimension} reason=quota_exceeded used=${result.used} limit=${result.limit} nextPlan=${result.nextPlanKey ?? 'none'}`,
    );

    // 429 with structured payload. The UI catches this in its API
    // client interceptor and opens the UpgradeDialog with the next
    // plan's numbers — see apps/web/src/lib/quota/.
    throw new HttpException(
      {
        code: 429,
        error: 'quota_exceeded',
        dimension: result.dimension,
        used: result.used,
        limit: result.limit,
        resetAt: result.resetAt,
        nextTier: result.nextTier,
        nextPlanKey: result.nextPlanKey,
        nextTierLimit: result.nextTierLimit,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

function resolveIdempotencyKey(
  req: AuthedRequest,
  requirement: QuotaRequirement,
): string {
  const source = requirement.idempotencyFrom ?? 'header:x-idempotency-key';
  let raw: unknown;
  if (source.startsWith('header:')) {
    raw = req.header(source.slice('header:'.length));
  } else {
    const body = req.body as Record<string, unknown> | undefined;
    raw = body?.[source.slice('body:'.length)];
  }
  if (raw === undefined || raw === null || raw === '') {
    return `synth_${randomUUID()}`;
  }
  if (typeof raw !== 'string') {
    throw invalidIdempotencyKey();
  }
  const normalized = raw.trim();
  if (
    normalized.length === 0 ||
    Buffer.byteLength(normalized, 'utf8') > MAX_IDEMPOTENCY_KEY_BYTES ||
    !SAFE_IDEMPOTENCY_KEY_PATTERN.test(normalized)
  ) {
    throw invalidIdempotencyKey();
  }
  return normalized;
}

function invalidIdempotencyKey(): HttpException {
  return new HttpException(
    {
      code: 400,
      error: 'invalid_idempotency_key',
    },
    HttpStatus.BAD_REQUEST,
  );
}
