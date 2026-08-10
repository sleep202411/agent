/**
 * Quota module — per-user usage ledger + counters + (Phase 5+)
 * enforcement.
 *
 *   - Phase 1:  QuotaUsageLogService (audit ledger, observation only)
 *   - Phase 2:  QuotaService (Redis Lua atomic consume/refund/peek)
 *               + QuotaController (GET /aurora/quota)
 *               + tier config
 *   - Phase 3:  QuotaEventsService (Redis publish helper)
 *               + QuotaEventsGateway (WS push)
 *   - Phase 5:  QuotaGuard / @RequireQuota decorator
 *   - Phase 8:  metrics + admin endpoints
 *
 * @Global so future phases (guards, gateways) inject without
 * touching every consumer's module imports.
 */
import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { WorkspacesModule } from '../workspaces';
import { QuotaController } from './quota.controller';
import { QuotaEventsGateway } from './quota-events.gateway';
import { QuotaEventsService } from './quota-events.service';
import { QuotaGuard } from './quota.guard';
import { QuotaInterceptor } from './quota.interceptor';
import { QuotaService } from './quota.service';
import {
  createStrictQuotaRedis,
  QUOTA_STRICT_REDIS,
  requireQuotaRedisUrl,
  StrictQuotaRedisLifecycle,
} from './quota-strict-redis';
import { QuotaUsageLogService } from './quota-usage-log.service';

/**
 * Quota stays infrastructure: services + types + decorator + guard +
 * interceptor are all exported as building blocks, but **nothing is
 * registered globally**. New modules that want enforcement opt-in
 * with:
 *
 *   @UseGuards(QuotaGuard)
 *   @UseInterceptors(QuotaInterceptor)
 *   @RequireQuota({ dimension: 'image', ... })
 *   submitJob(...)
 *
 * StoryOS / Mastra / chat / workflow are explicitly OUT of scope —
 * if they ever need quota, they wire it in their own controllers,
 * not through a global guard that touches every route.
 *
 * QuotaController still publishes GET /aurora/quota globally — it's
 * a read-only snapshot tied to the authenticated user, no per-route
 * side effects.
 */
@Global()
@Module({
  imports: [AuthModule, WorkspacesModule],
  providers: [
    {
      provide: QUOTA_STRICT_REDIS,
      useFactory: () =>
        createStrictQuotaRedis(requireQuotaRedisUrl(process.env)),
    },
    {
      provide: 'QUOTA_STRICT_REDIS_LIFECYCLE',
      useFactory: (client: import('ioredis').default) =>
        new StrictQuotaRedisLifecycle(client),
      inject: [QUOTA_STRICT_REDIS],
    },
    QuotaUsageLogService,
    QuotaEventsService,
    QuotaEventsGateway,
    QuotaService,
    QuotaGuard,
    QuotaInterceptor,
  ],
  controllers: [QuotaController],
  exports: [
    QuotaUsageLogService,
    QuotaService,
    QuotaEventsService,
    QuotaGuard,
    QuotaInterceptor,
  ],
})
export class QuotaModule {}
