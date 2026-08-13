/**
 * `@RequireQuota({ dimension, cost? })` — controller-route metadata
 * read by QuotaGuard. Centralises the contract so guard + controller
 * + audit log all agree on what was consumed.
 *
 *   @Post('jobs')
 *   @RequireQuota({ dimension: 'image' })
 *   async submitJob(...) { ... }
 *
 * Phase 5 stays simple: one consume per request, no idempotency
 * extraction yet. Workers that need to refund on downstream failure
 * call QuotaService.refundFor() directly with their own keys.
 */
import { SetMetadata } from '@nestjs/common';
import type { QuotaDimension } from '@prisma/client';

export const QUOTA_METADATA_KEY = 'quota:requirements';

export interface QuotaRequirement {
  dimension: QuotaDimension;
  /** Default 1. */
  cost?: number;
  /** Override the audit-log `reason` label. */
  reason?: string;
  /**
   * Run the per-minute rate-limit check (e.g. for chat — 60/min even
   * on the highest paid plan to prevent script abuse). Failure returns HTTP 429 with
   * `error: 'rate_limited'` rather than `quota_exceeded`, so the
   * UI can render "slow down" toast instead of the upgrade dialog.
   */
  rateLimitPerMinute?: boolean;
  /**
   * Where to pull the idempotency key from. Defaults to
   * `header:x-idempotency-key`. Pass `body:<field>` to extract from a
   * request-body field instead — required when the downstream domain
   * dedupes by a different shape than the HTTP retry layer (e.g.
   * ai-generation reads `body.idempotencyKey`, so the same submit
   * being retried produces the same DB job AND the same quota
   * consume, not two charges for one job).
   */
  idempotencyFrom?: `header:${string}` | `body:${string}`;
}

export const RequireQuota = (req: QuotaRequirement) =>
  SetMetadata(QUOTA_METADATA_KEY, req);
