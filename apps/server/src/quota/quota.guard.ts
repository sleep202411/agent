/**
 * QuotaGuard — pre-consumes the configured quota before the route
 * handler runs. Rejects with HTTP 429 + a structured payload the
 * frontend renders as the UpgradeDialog.
 *
 * Wired as a regular (non-global) guard via `@UseGuards(QuotaGuard)`
 * + `@RequireQuota({...})` per route. Endpoints without metadata
 * pass through (the guard is a no-op).
 *
 * Refund semantics: this guard only consumes. If the downstream worker
 * permanently fails the job, the worker is responsible for calling
 * QuotaService.refundFor() with the same idempotencyKey it knows
 * about. Phase 5 keeps the worker-side refund wiring as a follow-up
 * — the existing observation ledger already lets us reconcile any
 * unrefunded failures via SUM() over quota_usage_log.
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
import { normalizeTier } from './tiers.config';
import { QUOTA_METADATA_KEY, type QuotaRequirement } from './quota.decorator';
import { randomUUID } from 'crypto';
import type { AuthUser } from '../auth';

interface AuthedRequest extends Request {
  user?: AuthUser;
  /** Set by this guard so QuotaInterceptor can refund-on-error
   *  without re-resolving the idempotency source. */
  __quotaConsumeKey?: string;
}

@Injectable()
export class QuotaGuard implements CanActivate {
  /**
   * Phase 8 observability — every consume/refund already writes a
   * row to `quota_usage_log` for durable audit; this guard's logger
   * additionally emits a structured warn line on rejections so Loki
   * / Kibana / kubectl-logs filters can spot tier-too-tight or
   * VIP3-leak issues without joining tables.
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
    const tier = normalizeTier(user.userLevel);

    // Per-minute rate limit pre-check — applies even to VIP3. A
    // failure here is a different shape from quota_exceeded: it's a
    // "you're going too fast" signal, not "buy a bigger plan".
    if (requirement.rateLimitPerMinute) {
      const rl = await this.quota.checkChatRate(user.userId, tier);
      if (!rl.ok) {
        this.logger.warn(
          `quota.reject userId=${user.userId} tier=${tier} dim=${requirement.dimension} reason=rate_limited limit=${rl.limit}/min resetAt=${rl.resetAt}`,
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
    const idemSource =
      requirement.idempotencyFrom ?? 'header:x-idempotency-key';
    let idem: string | undefined;
    if (idemSource.startsWith('header:')) {
      const headerName = idemSource.slice('header:'.length);
      const raw = req.header(headerName);
      idem = typeof raw === 'string' && raw.length > 0 ? raw : undefined;
    } else if (idemSource.startsWith('body:')) {
      const fieldName = idemSource.slice('body:'.length);
      const body = req.body as Record<string, unknown> | undefined;
      const raw = body ? body[fieldName] : undefined;
      idem = typeof raw === 'string' && raw.length > 0 ? raw : undefined;
    }
    if (!idem) idem = `synth_${randomUUID()}`;
    // Stash on req so QuotaInterceptor can find it on error.
    req.__quotaConsumeKey = idem;

    const result = await this.quota.consume({
      userId: user.userId,
      tier,
      dimension: requirement.dimension,
      cost: requirement.cost,
      idempotencyKey: idem,
      reason:
        requirement.reason ?? `${ctx.getClass().name}.${ctx.getHandler().name}`,
    });

    if (result.ok) return true;

    this.logger.warn(
      `quota.reject userId=${user.userId} tier=${tier} dim=${result.dimension} reason=quota_exceeded used=${result.used} limit=${result.limit} nextTier=${result.nextTier ?? 'none'}`,
    );

    // 429 with structured payload. The UI catches this in its API
    // client interceptor and opens the UpgradeDialog with the next
    // tier's numbers — see apps/web/src/lib/quota/.
    throw new HttpException(
      {
        code: 429,
        error: 'quota_exceeded',
        dimension: result.dimension,
        used: result.used,
        limit: result.limit,
        resetAt: result.resetAt,
        nextTier: result.nextTier,
        nextTierLimit: result.nextTierLimit,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
