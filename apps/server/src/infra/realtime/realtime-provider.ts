import type { AssetEvent } from '@repo/shared';

export const REALTIME_PROVIDER = Symbol('REALTIME_PROVIDER');

export interface RealtimeClientAccess {
  url: string;
  accessToken: string;
  expiresAt: number;
}

export interface RealtimeProvider {
  issueEntityClientAccess(userId: string): Promise<RealtimeClientAccess | null>;
  issueAssetsClientAccess(
    userId: string,
    workspaceId?: string,
  ): Promise<RealtimeClientAccess | null>;
  publishEntityToUser(userId: string, payload: unknown): Promise<void>;
  publishAssetEvent(userId: string, event: AssetEvent): Promise<void>;
}
