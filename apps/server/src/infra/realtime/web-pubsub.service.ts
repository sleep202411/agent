/**
 * WebPubSubService — thin wrapper around Azure Web PubSub's server
 * SDK. Two responsibilities only:
 *
 *   1. Issue short-lived client access tokens (JWT) that the browser
 *      uses to connect directly to Azure.
 *   2. Publish messages to per-user groups so every tab the user has
 *      open gets the same event.
 *
 * Hubs used by this project:
 *   - `entity`  — per-user entity-change broadcasts (this module's
 *                 first consumer; mirrors EntityEventsGateway)
 *   - `chat`    — reserved for chat-events follow-up migration
 *
 * Group naming: `user:{userId}` — entity events are per-user, so one
 * group per user covers all of that user's open tabs / clients. Future
 * resource-scoped events (e.g. per-project chat) will use a different
 * group convention (`chat:{projectId}`) and live in their own hub.
 */
import { Injectable, Logger } from '@nestjs/common';
import { WebPubSubServiceClient } from '@azure/web-pubsub';
import { ASSETS_HUB, assetsUserGroup, type AssetEvent } from '@repo/shared';
import type {
  RealtimeClientAccess,
  RealtimeProvider,
} from './realtime-provider';
import {
  entitlementUserChannel,
  entitlementWorkspaceChannel,
  projectWorkspaceChannel,
  teamWorkspaceChannel,
  walletWorkspaceChannel,
} from './realtime-groups';

const HUB_ENTITY = 'entity';
const TOKEN_TTL_MINUTES = 60;

export type RealtimeHub = 'entity' | 'chat' | 'assets';

@Injectable()
export class WebPubSubService implements RealtimeProvider {
  private readonly logger = new Logger(WebPubSubService.name);
  private readonly clients = new Map<RealtimeHub, WebPubSubServiceClient>();
  private readonly connectionString: string | null;

  constructor() {
    const cs = process.env.AZURE_WEB_PUBSUB_CONNECTION_STRING ?? null;
    if (!cs) {
      this.logger.warn(
        'AZURE_WEB_PUBSUB_CONNECTION_STRING unset — WebPubSubService is a no-op',
      );
    }
    this.connectionString = cs;
  }

  /** Lazily-constructed client per hub. */
  private clientFor(hub: RealtimeHub): WebPubSubServiceClient | null {
    if (!this.connectionString) return null;
    let client = this.clients.get(hub);
    if (!client) {
      client = new WebPubSubServiceClient(this.connectionString, hub);
      this.clients.set(hub, client);
    }
    return client;
  }

  /**
   * Mint a client access URL the browser can connect to directly.
   * The token embeds userId + the groups the client is pre-joined to
   * + the roles it can take (send/join). Auth happens here once; no
   * per-message round trip to our server.
   */
  async issueEntityClientAccess(
    userId: string,
  ): Promise<RealtimeClientAccess | null> {
    const client = this.clientFor(HUB_ENTITY);
    if (!client) return null;
    const group = userGroup(userId);
    const expiresAt = Date.now() + TOKEN_TTL_MINUTES * 60_000;
    const token = await client.getClientAccessToken({
      userId,
      // Pre-join the user's per-user group so the very first message
      // can land before any client-side `joinGroup` round trip.
      groups: [group],
      // Read-only client — the server is the only publisher. No send
      // role granted; clients can't spoof events to other users.
      roles: [`webpubsub.joinLeaveGroup.${group}`],
      expirationTimeInMinutes: TOKEN_TTL_MINUTES,
    });
    return {
      url: token.url,
      accessToken: token.token,
      expiresAt,
      transport: 'web-pubsub',
    };
  }

  /**
   * Publish an entity event to all of the user's open clients. Returns
   * silently if the service isn't configured (dev environments without
   * Azure credentials).
   */
  async publishEntityToUser(userId: string, payload: unknown): Promise<void> {
    const client = this.clientFor(HUB_ENTITY);
    if (!client) return;
    try {
      await client
        .group(userGroup(userId))
        .sendToAll({ event: 'entity_changed', data: payload });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`publishEntityToUser failed userId=${userId}: ${msg}`);
    }
  }

  // ─── Assets hub (Foundry jobs + future asset event kinds) ────────

  /**
   * Mint a client access URL for the assets hub. Workspace-aware
   * clients pre-join `assets-workspace:{workspaceId}` so switching
   * workspace naturally tears down one stream and opens another.
   * Clients without a workspace context keep the per-user group.
   */
  async issueAssetsClientAccess(
    userId: string,
    workspaceId?: string,
  ): Promise<RealtimeClientAccess | null> {
    const client = this.clientFor(ASSETS_HUB);
    if (!client) return null;
    const group = workspaceId
      ? assetsWorkspaceGroup(workspaceId)
      : assetsUserGroup(userId);
    const expiresAt = Date.now() + TOKEN_TTL_MINUTES * 60_000;
    const token = await client.getClientAccessToken({
      userId,
      groups: [group],
      roles: [`webpubsub.joinLeaveGroup.${group}`],
      expirationTimeInMinutes: TOKEN_TTL_MINUTES,
    });
    return {
      url: token.url,
      accessToken: token.token,
      expiresAt,
      transport: 'web-pubsub',
    };
  }

  /**
   * Legacy transport, being retired (P5). It never serves the unified studio
   * socket on prod (both cells are self-hosted), but mirror the self-hosted grant
   * for consistency: the user's asset stream + the active workspace's wallet channel.
   */
  async issueRealtimeClientAccess(
    userId: string,
    workspaceId?: string,
  ): Promise<RealtimeClientAccess | null> {
    const client = this.clientFor(ASSETS_HUB);
    if (!client) return null;
    const groups = [assetsUserGroup(userId), entitlementUserChannel(userId)];
    if (workspaceId) {
      groups.push(
        walletWorkspaceChannel(workspaceId),
        entitlementWorkspaceChannel(workspaceId),
        teamWorkspaceChannel(workspaceId),
        projectWorkspaceChannel(workspaceId),
      );
    }
    const expiresAt = Date.now() + TOKEN_TTL_MINUTES * 60_000;
    const token = await client.getClientAccessToken({
      userId,
      groups,
      roles: groups.map((g) => `webpubsub.joinLeaveGroup.${g}`),
      expirationTimeInMinutes: TOKEN_TTL_MINUTES,
    });
    return {
      url: token.url,
      accessToken: token.token,
      expiresAt,
      transport: 'web-pubsub',
    };
  }

  /**
   * Publish an asset event. Workspace-owned events go to the workspace
   * group; unscoped events go to the user's group.
   */
  async publishAssetEvent(userId: string, event: AssetEvent): Promise<void> {
    const client = this.clientFor(ASSETS_HUB);
    if (!client) return;
    // Generalized events (P3) carry an explicit channel — route by it. Legacy
    // events derive their groups from the event kind.
    const workspaceId =
      event.kind === 'ai_job_update' ? event.job.workspaceId : undefined;
    const groups = event.channel
      ? [event.channel]
      : workspaceId
        ? [assetsWorkspaceGroup(workspaceId), assetsUserGroup(userId)]
        : [assetsUserGroup(userId)];
    try {
      for (const group of groups) {
        await client.group(group).sendToAll(event);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `publishAssetEvent failed groups=${groups.join(',')} userId=${userId} kind=${event.kind}: ${msg}`,
      );
      throw err;
    }
  }
}

function userGroup(userId: string): string {
  return `user:${userId}`;
}

function assetsWorkspaceGroup(workspaceId: string): string {
  return `assets-workspace:${workspaceId}`;
}
