/**
 * QuotaInterceptor — refunds the quota that QuotaGuard pre-consumed
 * when the route handler throws.
 *
 *   Guard:        pre-consume(+audit, +WS push)
 *   Route:        runs the actual work
 *   Interceptor:  on success → no-op  /  on throw → refundFor(...)
 *
 * Why this layer instead of try/catch in every controller:
 *
 *   - Centralised: one place owns the consume↔refund symmetry, so a
 *     new endpoint adding `@RequireQuota` automatically gets refund
 *     semantics without remembering a try/catch.
 *   - Idempotent: refundFor() short-circuits when the Lua refund
 *     script sees the key's already been refunded, so a worker that
 *     ALSO calls refund (image jobs do this on terminal failure) is
 *     a no-op the second time round.
 *
 * The interceptor reads the same metadata + same idempotency key as
 * the guard; we stash the resolved key on `req.__quotaConsumeKey` in
 * the guard to avoid recomputing it here.
 */
import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { catchError, type Observable, throwError } from 'rxjs';
import type { Request } from 'express';
import { QuotaService } from './quota.service';
import { normalizeTier } from './tiers.config';
import { QUOTA_METADATA_KEY, type QuotaRequirement } from './quota.decorator';
import type { AuthUser } from '../auth';

interface QuotaTaggedRequest extends Request {
  user?: AuthUser;
  __quotaConsumeKey?: string;
}

@Injectable()
export class QuotaInterceptor implements NestInterceptor {
  private readonly logger = new Logger(QuotaInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly quota: QuotaService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const requirement = this.reflector.get<QuotaRequirement | undefined>(
      QUOTA_METADATA_KEY,
      ctx.getHandler(),
    );
    if (!requirement) return next.handle();

    const req = ctx.switchToHttp().getRequest<QuotaTaggedRequest>();
    const userId = req.user?.userId;
    const tier = normalizeTier(req.user?.userLevel);
    const idem = req.__quotaConsumeKey;

    return next.handle().pipe(
      catchError((err) => {
        // Don't refund on QuotaGuard-thrown 429 (we never consumed).
        const status =
          err instanceof HttpException ? err.getStatus() : undefined;
        if (status === 429) return throwError(() => err);

        if (userId && idem) {
          void this.quota
            .refundFor({
              userId,
              tier,
              dimension: requirement.dimension,
              cost: requirement.cost ?? 1,
              idempotencyKey: idem,
              reason: `${requirement.reason ?? 'downstream'}_failed`,
            })
            .catch((refundErr) => {
              this.logger.warn(
                `auto-refund failed userId=${userId} key=${idem}: ${
                  refundErr instanceof Error
                    ? refundErr.message
                    : String(refundErr)
                }`,
              );
            });
        }
        return throwError(() => err);
      }),
    );
  }
}
