import type {
  CreateWorldRequest,
  WorldModelCapabilities,
  WorldModelProviderKey,
  WorldModelStatus,
  WorldSessionConnection,
  WorldStreamStatus,
  WorldTravelArtifacts,
  WorldTravelStatus,
} from '@repo/shared';

export interface ProviderWorld {
  providerWorldId: string;
  mode: 'adventure';
  status: WorldModelStatus;
  name: string | null;
  firstFrameUrl: string | null;
  providerData: Record<string, unknown>;
  error: { code: string; message: string } | null;
}

export interface ProviderSession {
  providerSessionId: string;
  heartbeatIntervalSeconds: number;
  sessionTimeoutSeconds: number;
  connection: WorldSessionConnection;
}

export interface ProviderHeartbeat {
  alive: boolean;
  heartbeatIntervalSeconds: number;
}

export interface ProviderBoundTravel {
  providerSessionId: string;
  bound: boolean;
}

export interface ProviderTravelStatus {
  status: WorldTravelStatus;
  rtcStatus: string | null;
  updatedAt: string | null;
  providerData: Record<string, unknown>;
}

export interface WorldModelProvider {
  readonly key: WorldModelProviderKey;

  capabilities(): WorldModelCapabilities;
  createWorld(input: CreateWorldRequest): Promise<ProviderWorld>;
  getWorld(providerWorldId: string): Promise<ProviderWorld>;
  createSession(input: {
    providerWorldId: string;
    tokenSeconds: number;
  }): Promise<ProviderSession>;
  heartbeat(providerSessionId: string): Promise<ProviderHeartbeat>;
  bindTravel(input: {
    providerSessionId: string;
    providerTravelId: string;
  }): Promise<ProviderBoundTravel>;
  refreshToken(
    tokenSeconds: number,
  ): Promise<WorldSessionConnectionWithoutTicket>;
  closeSession(input: {
    providerSessionId: string;
    travelCompleted: boolean;
  }): Promise<{ closed: boolean }>;
  syncTravelStatus(input: {
    providerTravelId: string;
    streamStatus?: WorldStreamStatus;
    streamStatusChangedAtMs?: number;
  }): Promise<ProviderTravelStatus>;
  getTravelArtifacts(
    providerTravelId: string,
  ): Promise<Omit<WorldTravelArtifacts, 'travelId'>>;
}

export type WorldSessionConnectionWithoutTicket = Omit<
  WorldSessionConnection,
  'ticket'
>;

export const WORLD_MODEL_PROVIDERS = Symbol('WORLD_MODEL_PROVIDERS');
