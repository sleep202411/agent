/**
 * Quota module — per-user usage ledger + (Phase 2+) enforcement.
 *
 * Phase 1 (this file) exports only QuotaUsageLogService: a fire-and-
 * forget write to `quota_usage_log` from every consumable user action.
 * No counters, no Redis, no guards — we want a week of real data
 * before flipping on hard caps.
 *
 * Later phases will add:
 *  - Phase 2: QuotaService (Redis Lua atomic consume/refund/peek)
 *  - Phase 2: tiers.config.ts (Free/VIP1/VIP2/VIP3 limits)
 *  - Phase 3: QuotaController (GET /aurora/quota) + WS gateway
 *  - Phase 5: QuotaGuard / RequireQuota decorator
 *  - Phase 8: metrics + admin endpoints
 */
import { Global, Module } from '@nestjs/common';
import { QuotaUsageLogService } from './quota-usage-log.service';

@Global()
@Module({
  providers: [QuotaUsageLogService],
  exports: [QuotaUsageLogService],
})
export class QuotaModule {}
