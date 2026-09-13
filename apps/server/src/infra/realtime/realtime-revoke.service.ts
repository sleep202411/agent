import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';
import {
  REALTIME_REVOKE_CHANNEL,
  workspaceRevokeChannels,
  storyProjectChannel,
} from './realtime-groups';

/**
 * Publishes access-revocation signals to the realtime plane. Decoupled from the
 * RealtimeModule (which imports WorkspacesModule) to avoid a module cycle — it
 * needs only the global Redis. The gateway (in RealtimeModule) consumes the
 * signal and closes the affected sockets on every pod.
 *
 * Best-effort: a missed signal is bounded by the token-TTL backstop. Call it
 * AFTER the membership/workspace mutation commits — a revocation is a side effect
 * (kick the live socket), not a durable event.
 */
@Injectable()
export class RealtimeRevokeService {
  private readonly logger = new Logger(RealtimeRevokeService.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async revokeStoryProjectAccess(projectId: string): Promise<void> {
    try {
      await this.redis.publish(
        REALTIME_REVOKE_CHANNEL,
        JSON.stringify({ channels: [storyProjectChannel(projectId)] }),
      );
    } catch (error) {
      this.logger.warn(`Story project revocation failed: ${String(error)}`);
    }
  }

  /** Kick `userId` (or everyone, when omitted) from the workspace's channels. */
  async revokeWorkspaceAccess(
    workspaceId: string,
    userId?: string,
  ): Promise<void> {
    const payload = JSON.stringify({
      channels: workspaceRevokeChannels(workspaceId),
      userId,
    });
    try {
      await this.redis.publish(REALTIME_REVOKE_CHANNEL, payload);
    } catch (err) {
      this.logger.warn(
        `revoke publish failed ws=${workspaceId}${
          userId ? ` user=${userId}` : ''
        }: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
