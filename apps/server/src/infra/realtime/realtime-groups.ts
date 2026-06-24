/**
 * Fan-out group names + Redis channel convention shared by the self-hosted
 * realtime provider (publisher) and gateway (subscriber). Group names mirror
 * WebPubSubService exactly so payloads/grouping are identical across transports.
 */

/** Redis channel carrying messages for one fan-out group. */
export const REALTIME_GROUP_CHANNEL_PREFIX = 'realtime:group:';
export const REALTIME_GROUP_CHANNEL_PATTERN = 'realtime:group:*';

/** Per-user entity-event group (matches WebPubSubService `user:{userId}`). */
export function entityUserGroup(userId: string): string {
  return `user:${userId}`;
}

/** Per-workspace asset-event group (matches WebPubSubService). */
export function assetsWorkspaceGroup(workspaceId: string): string {
  return `assets-workspace:${workspaceId}`;
}

/**
 * Per-workspace compute-wallet channel (P3). Compute credits are workspace-owned
 * (the user's personal credits live in their personal workspace's pot), so the
 * channel is keyed by the owning workspace id, not the user.
 */
export function walletWorkspaceChannel(workspaceId: string): string {
  return `wallet:workspace:${workspaceId}`;
}

/** Extract the group name from a `realtime:group:<group>` channel. */
export function groupFromChannel(channel: string): string {
  return channel.slice(REALTIME_GROUP_CHANNEL_PREFIX.length);
}
