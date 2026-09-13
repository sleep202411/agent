/**
 * Fan-out group names + Redis channel convention shared by the self-hosted
 * realtime provider (publisher) and gateway (subscriber). These names are the
 * stable wire contract for channels/grouping (originally chosen to match the
 * now-decommissioned Web PubSub groups, so clients stayed compatible across the
 * cut-over).
 */

/** Redis channel carrying messages for one fan-out group. */
export const REALTIME_GROUP_CHANNEL_PREFIX = 'realtime:group:';
export const REALTIME_GROUP_CHANNEL_PATTERN = 'realtime:group:*';

/** Per-user entity-event group — `user:{userId}`. */
export function entityUserGroup(userId: string): string {
  return `user:${userId}`;
}

/** Per-workspace asset-event group. */
export function assetsWorkspaceGroup(workspaceId: string): string {
  return `assets-workspace:${workspaceId}`;
}

/**
 * Per-workspace compute-wallet channel (P3). Compute credits are workspace-owned
 * (compute credits belong to workspace wallets), so the
 * channel is keyed by the owning workspace id, not the user.
 */
export function walletWorkspaceChannel(workspaceId: string): string {
  return `wallet:workspace:${workspaceId}`;
}

/** Per-user entitlement channel (a user's personal plan). */
export function entitlementUserChannel(userId: string): string {
  return `entitlement:user:${userId}`;
}

/** Per-workspace entitlement channel (a workspace/team plan). */
export function entitlementWorkspaceChannel(workspaceId: string): string {
  return `entitlement:workspace:${workspaceId}`;
}

/** Per-workspace team-membership channel (the member roster). */
export function teamWorkspaceChannel(workspaceId: string): string {
  return `team:workspace:${workspaceId}`;
}

/** Per-workspace project-list channel. */
export function projectWorkspaceChannel(workspaceId: string): string {
  return `project:workspace:${workspaceId}`;
}

/**
 * Story Studio project channel. Story membership can be narrower than the
 * owning workspace, so Agent proposals and execution state must never ride a
 * workspace-wide channel.
 */
export function storyProjectChannel(storyProjectId: string): string {
  return `story:project:${storyProjectId}`;
}

/**
 * Redis channel for cross-pod access revocation. A producer publishes
 * `{channels, userId?}`; every gateway pod closes the live sockets in those
 * channels (filtered to `userId` when present) immediately — so a removed member
 * is kicked now, not when their token happens to expire.
 */
export const REALTIME_REVOKE_CHANNEL = 'realtime:revoke';

/**
 * Every workspace-scoped channel a member holds. Closed for one user on removal,
 * or for everyone on workspace deletion.
 */
export function workspaceRevokeChannels(workspaceId: string): string[] {
  return [
    assetsWorkspaceGroup(workspaceId),
    walletWorkspaceChannel(workspaceId),
    entitlementWorkspaceChannel(workspaceId),
    teamWorkspaceChannel(workspaceId),
    projectWorkspaceChannel(workspaceId),
  ];
}

/** Extract the group name from a `realtime:group:<group>` channel. */
export function groupFromChannel(channel: string): string {
  return channel.slice(REALTIME_GROUP_CHANNEL_PREFIX.length);
}
