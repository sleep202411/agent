import type { AssetEvent } from '@repo/shared';

export const REALTIME_PROVIDER = Symbol('REALTIME_PROVIDER');

/** Which client SDK/transport the `url` + `accessToken` are meant for. */
export type RealtimeTransport = 'web-pubsub' | 'self-hosted';

export interface RealtimeClientAccess {
  /**
   * For `web-pubsub`: an absolute Azure client URL. For `self-hosted`: the WS
   * endpoint, either absolute (ws/wss) or a same-origin path the client prefixes
   * with its own origin. `accessToken` is passed as the `?token=` query param.
   */
  url: string;
  accessToken: string;
  expiresAt: number;
  /** Lets the client pick the matching transport adapter. */
  transport: RealtimeTransport;
}

export interface RealtimeProvider {
  issueEntityClientAccess(userId: string): Promise<RealtimeClientAccess | null>;
  issueAssetsClientAccess(
    userId: string,
    workspaceId?: string,
  ): Promise<RealtimeClientAccess | null>;
  /**
   * Unified realtime-plane grant (P3): the user's own asset stream plus, when a
   * workspace is in context, that workspace's channels (wallet, …). This is the
   * grant the studio's single multiplexed socket uses; `issueAssetsClientAccess`
   * stays for the legacy per-hub clients (apps/web).
   */
  issueRealtimeClientAccess(
    userId: string,
    workspaceId?: string,
  ): Promise<RealtimeClientAccess | null>;
  publishEntityToUser(userId: string, payload: unknown): Promise<void>;
  publishAssetEvent(userId: string, event: AssetEvent): Promise<void>;
}
