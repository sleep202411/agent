import { Module } from '@nestjs/common';
import { RealtimeRevokeService } from './realtime-revoke.service';

/**
 * Standalone module for the revocation publisher. It imports nothing (Redis is
 * global), so producer modules (workspaces, sharing) can depend on it without
 * recreating the RealtimeModule <-> WorkspacesModule cycle. The consumer side
 * (the gateway) lives in RealtimeModule and talks to this only over Redis.
 */
@Module({
  providers: [RealtimeRevokeService],
  exports: [RealtimeRevokeService],
})
export class RealtimeRevokeModule {}
