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
 * The interceptor requires the guard's debit receipt. A deduplicated request
 * gets a non-debited receipt and therefore cannot refund the original
 * request's charge when its own downstream handler fails.
 */
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { catchError, type Observable, throwError } from 'rxjs';
import type { Request } from 'express';
import { QuotaService } from './quota.service';
import { QUOTA_METADATA_KEY, type QuotaRequirement } from './quota.decorator';
import type { AuthUser } from '../auth';
import type { QuotaDebitReceipt } from './quota.types';

interface QuotaTaggedRequest extends Request {
  user?: AuthUser;
  __quotaConsumeReceipt?: QuotaDebitReceipt;
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
    const receipt = req.__quotaConsumeReceipt;

    return next.handle().pipe(
      catchError((err: unknown) => {
        if (
          userId &&
          receipt?.debited === true &&
          receipt.userId === userId &&
          receipt.dimension === requirement.dimension
        ) {
          void this.quota
            .refundFor({
              userId,
              limits: receipt.profile.limits,
              dimension: receipt.dimension,
              cost: receipt.cost,
              idempotencyKey: receipt.idempotencyKey,
              reason: `${requirement.reason ?? 'downstream'}_failed`,
            })
            .catch((refundErr) => {
              this.logger.warn(
                `auto-refund failed userId=${userId} key=${receipt.idempotencyKey}: ${
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
