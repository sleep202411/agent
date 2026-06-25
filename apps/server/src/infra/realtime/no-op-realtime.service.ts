import { Injectable } from '@nestjs/common';
import type {
  RealtimeClientAccess,
  RealtimeProvider,
} from './realtime-provider';

/**
 * A realtime provider that does nothing — selected when no transport is
 * configured (e.g. local dev without REALTIME_WS_SECRET). negotiate returns null
 * (the controller answers 503 `realtime_unconfigured`, so clients degrade to
 * polling) and publishes are dropped. Replaces the old Web PubSub no-op fallback
 * after that transport was decommissioned (P5); prod cells run self-hosted, so
 * this is never selected there.
 */
@Injectable()
export class NoOpRealtimeService implements RealtimeProvider {
  issueEntityClientAccess(): Promise<RealtimeClientAccess | null> {
    return Promise.resolve(null);
  }

  issueAssetsClientAccess(): Promise<RealtimeClientAccess | null> {
    return Promise.resolve(null);
  }

  issueRealtimeClientAccess(): Promise<RealtimeClientAccess | null> {
    return Promise.resolve(null);
  }

  publishEntityToUser(): Promise<void> {
    return Promise.resolve();
  }

  publishAssetEvent(): Promise<void> {
    return Promise.resolve();
  }
}
