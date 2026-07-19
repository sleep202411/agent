/**
 * SelfHostedRealtimeService — a `RealtimeProvider` that needs no managed cloud
 * service. It is the region-portable alternative to Azure Web PubSub (which does
 * not serve the CN cell), so realtime job/asset/entity pushes work identically
 * on Alibaba and Azure.
 *
 * Shape: negotiate mints a short-lived signed token authorizing a set of fan-out
 * groups; the browser connects to the in-cluster {@link RealtimeGateway}
 * (`/ws/realtime`) with it; publishes go to Redis channels (`realtime:group:*`)
 * that every gateway pod pattern-subscribes to, so delivery is multi-pod without
 * sticky routing. Group naming + payloads match the original Web PubSub wire
 * contract (now decommissioned), so clients stayed compatible across the
 * cut-over.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { assetsUserGroup, type AssetEvent } from '@repo/shared';
import { REDIS } from '../redis/redis.module';
import type {
  RealtimeClientAccess,
  RealtimeProvider,
} from './realtime-provider';
import {
  REALTIME_GROUP_CHANNEL_PREFIX,
  assetsWorkspaceGroup,
  entitlementUserChannel,
  entitlementWorkspaceChannel,
  entityUserGroup,
  projectWorkspaceChannel,
  storyProjectChannel,
  teamWorkspaceChannel,
  walletWorkspaceChannel,
} from './realtime-groups';
import { signRealtimeToken } from './realtime-transport-token';

const TOKEN_TTL_MS = 60 * 60_000;
/** Same-origin default; clients build the ws URL from their own origin. */
const DEFAULT_WS_PATH = '/aurora/ws/realtime';

@Injectable()
export class SelfHostedRealtimeService implements RealtimeProvider {
  private readonly logger = new Logger(SelfHostedRealtimeService.name);
  private readonly secret = process.env.REALTIME_WS_SECRET?.trim() || null;
  private readonly publicUrl =
    process.env.REALTIME_WS_PUBLIC_URL?.trim() || DEFAULT_WS_PATH;

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async issueEntityClientAccess(
    userId: string,
  ): Promise<RealtimeClientAccess | null> {
    return this.issue(userId, [entityUserGroup(userId)]);
  }

  async issueAssetsClientAccess(
    userId: string,
    workspaceId?: string,
  ): Promise<RealtimeClientAccess | null> {
    const group = workspaceId
      ? assetsWorkspaceGroup(workspaceId)
      : assetsUserGroup(userId);
    return this.issue(userId, [group]);
  }

  async issueRealtimeClientAccess(
    userId: string,
    workspaceId?: string,
    storyProjectId?: string,
  ): Promise<RealtimeClientAccess | null> {
    // Always the user's own asset stream (jobs + media — the superset); plus the
    // active workspace's channels (wallet, …) when a workspace is in context.
    const groups = [assetsUserGroup(userId), entitlementUserChannel(userId)];
    if (workspaceId) {
      groups.push(
        walletWorkspaceChannel(workspaceId),
        entitlementWorkspaceChannel(workspaceId),
        teamWorkspaceChannel(workspaceId),
        projectWorkspaceChannel(workspaceId),
      );
    }
    if (storyProjectId) groups.push(storyProjectChannel(storyProjectId));
    return this.issue(userId, groups);
  }

  async publishEntityToUser(userId: string, payload: unknown): Promise<void> {
    await this.publishToGroups([entityUserGroup(userId)], {
      event: 'entity_changed',
      data: payload,
    });
  }

  async publishAssetEvent(userId: string, event: AssetEvent): Promise<void> {
    // Generalized events (P3) carry an explicit channel — the channel IS the
    // fan-out group the client's token grants, so route straight to it. Legacy
    // ai_job/media events have no channel and keep the kind-derived routing.
    if (event.channel) {
      await this.publishToGroups([event.channel], event);
      return;
    }
    const workspaceId =
      event.kind === 'ai_job_update' ? event.job.workspaceId : undefined;
    // Send to both the workspace and the user group so a workspace-scoped client
    // and a per-user client (a different tab) each receive it exactly once.
    const groups = workspaceId
      ? [assetsWorkspaceGroup(workspaceId), assetsUserGroup(userId)]
      : [assetsUserGroup(userId)];
    await this.publishToGroups(groups, event);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  private async issue(
    userId: string,
    groups: string[],
  ): Promise<RealtimeClientAccess> {
    const secret = this.requireSecret();
    const expiresAt = Date.now() + TOKEN_TTL_MS;
    const accessToken = signRealtimeToken(secret, {
      userId,
      groups,
      exp: expiresAt,
    });
    return {
      url: this.publicUrl,
      accessToken,
      expiresAt,
      transport: 'self-hosted',
    };
  }

  private async publishToGroups(
    groups: string[],
    payload: unknown,
  ): Promise<void> {
    const message = JSON.stringify(payload);
    try {
      await Promise.all(
        groups.map((group) =>
          this.redis.publish(
            `${REALTIME_GROUP_CHANNEL_PREFIX}${group}`,
            message,
          ),
        ),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`publish failed groups=${groups.join(',')}: ${msg}`);
      throw err;
    }
  }

  private requireSecret(): string {
    if (!this.secret) {
      throw new Error(
        'REALTIME_WS_SECRET is required when REALTIME_TRANSPORT=self-hosted',
      );
    }
    return this.secret;
  }
}
