import { Injectable } from '@nestjs/common';
import {
  FAL_HAPPY_OYSTER_PROVIDER_KEY,
  type CreateWorldRequest,
  type WorldModelCapabilities,
} from '@repo/shared';
import type {
  ProviderWorld,
  WorldModelProvider,
} from '../../world-model-provider';
import { FalHappyOysterClient } from './fal-happy-oyster.client';
import {
  FalBindTravelSchema,
  FalCloseSessionSchema,
  FalHeartbeatSchema,
  FalSessionSchema,
  FalTokenSchema,
  FalTravelArtifactsSchema,
  FalTravelStatusSchema,
  FalWorldSchema,
  type FalWorld,
} from './fal-happy-oyster.schemas';

const ENDPOINT = 'alibaba/happy-oyster';

@Injectable()
export class FalHappyOysterAdapter implements WorldModelProvider {
  readonly key = FAL_HAPPY_OYSTER_PROVIDER_KEY;

  constructor(private readonly client: FalHappyOysterClient) {}

  capabilities(): WorldModelCapabilities {
    return {
      providerKey: this.key,
      displayName: 'HappyOyster',
      perspectives: ['first_person', 'third_person'],
      maxAdventureSeconds: [60, 90, 120],
      supportsRealtimeAudio: true,
      supportsMovementCommands: true,
      available: this.client.available,
    };
  }

  async createWorld(input: CreateWorldRequest): Promise<ProviderWorld> {
    const providerInput = {
      mode: input.mode,
      prompt: input.prompt,
      event_style: input.eventStyle,
      sync: false,
      ...(input.reference.firstFrameUrl
        ? { first_frame_image_url: input.reference.firstFrameUrl }
        : {}),
      image_urls: input.reference.imageUrls,
      perspective: input.perspective,
    };
    const world = await this.client.run(
      `${ENDPOINT}/worlds/create`,
      providerInput,
      FalWorldSchema,
    );
    return mapWorld(world, input.mode);
  }

  async getWorld(providerWorldId: string): Promise<ProviderWorld> {
    const world = await this.client.run(
      `${ENDPOINT}/worlds/build-status`,
      { encrypted_world_id: providerWorldId },
      FalWorldSchema,
    );
    return mapWorld(world, 'adventure');
  }

  async createSession(input: {
    providerWorldId: string;
    tokenSeconds: number;
  }) {
    const session = await this.client.run(
      `${ENDPOINT}/session`,
      {
        session_params: {
          encrypted_world_id: input.providerWorldId,
          token_expire_seconds: input.tokenSeconds,
        },
      },
      FalSessionSchema,
    );
    return {
      providerSessionId: session.session_id,
      heartbeatIntervalSeconds: session.heartbeat_interval_sec,
      sessionTimeoutSeconds: session.session_timeout_sec,
      connection: {
        apiBaseUrl: session.connection.api_base_url,
        ticket: session.connection.ticket,
        token: session.connection.token,
        tokenExpiresIn: session.connection.token_expires_in,
      },
    };
  }

  async heartbeat(providerSessionId: string) {
    const heartbeat = await this.client.run(
      `${ENDPOINT}/session/heartbeat`,
      { session_id: providerSessionId },
      FalHeartbeatSchema,
    );
    return {
      alive: heartbeat.alive,
      heartbeatIntervalSeconds: heartbeat.heartbeat_interval_sec,
    };
  }

  async bindTravel(input: {
    providerSessionId: string;
    providerTravelId: string;
  }) {
    const bound = await this.client.run(
      `${ENDPOINT}/session/bind-travel`,
      {
        session_id: input.providerSessionId,
        encrypted_travel_id: input.providerTravelId,
      },
      FalBindTravelSchema,
    );
    return { providerSessionId: bound.session_id, bound: bound.bound };
  }

  async refreshToken(tokenSeconds: number) {
    const token = await this.client.run(
      `${ENDPOINT}/tokens/issue`,
      { expire_in_seconds: tokenSeconds },
      FalTokenSchema,
    );
    return {
      apiBaseUrl: token.api_base_url,
      token: token.token,
      tokenExpiresIn: token.expires_in,
    };
  }

  async closeSession(input: {
    providerSessionId: string;
    travelCompleted: boolean;
  }) {
    const result = await this.client.run(
      `${ENDPOINT}/session/close`,
      {
        session_id: input.providerSessionId,
        travel_completed: input.travelCompleted,
      },
      FalCloseSessionSchema,
    );
    return { closed: result.closed };
  }

  async syncTravelStatus(input: {
    providerTravelId: string;
    streamStatus?: Parameters<
      WorldModelProvider['syncTravelStatus']
    >[0]['streamStatus'];
    streamStatusChangedAtMs?: number;
  }) {
    const status = await this.client.run(
      `${ENDPOINT}/travels/status`,
      {
        encrypted_travel_id: input.providerTravelId,
        ...(input.streamStatus
          ? { client_stream_status: input.streamStatus }
          : {}),
        ...(input.streamStatusChangedAtMs !== undefined
          ? { client_stream_status_time_ms: input.streamStatusChangedAtMs }
          : {}),
      },
      FalTravelStatusSchema,
    );
    return {
      status: status.status,
      rtcStatus: status.rtc_status ?? null,
      updatedAt: status.update_time ?? null,
      providerData: {
        userInstructions: status.user_instructions ?? [],
        chapters: status.chapters ?? [],
        characterActions: status.character_actions ?? [],
        environmentActions: status.environment_actions ?? [],
      },
    };
  }

  async getTravelArtifacts(providerTravelId: string) {
    const artifacts = await this.client.run(
      `${ENDPOINT}/travels/artifacts`,
      { encrypted_travel_id: providerTravelId },
      FalTravelArtifactsSchema,
    );
    return {
      composeStatus: artifacts.compose_status,
      video: artifacts.video
        ? Object.fromEntries(
            Object.entries(artifacts.video).map(([key, value]) => [
              key,
              {
                url: value.url,
                status: value.status,
                resolution: value.resolution ?? null,
              },
            ]),
          )
        : null,
    };
  }
}

function mapWorld(
  world: FalWorld,
  requestedMode: ProviderWorld['mode'],
): ProviderWorld {
  return {
    providerWorldId: world.encrypted_world_id,
    // `mode` is optional in fal's documented create/build-status responses.
    // The requested mode is authoritative for a response that belongs to this
    // adapter call; the schema above rejects any explicit incompatible mode.
    mode: requestedMode,
    status: world.status,
    name: world.name ?? null,
    firstFrameUrl: world.first_frame ?? null,
    providerData: {
      creationModel: world.creation_model,
      createdAt: world.created_at,
      updatedAt: world.updated_at,
    },
    error:
      world.status === 'failed'
        ? {
            code: world.error_code ?? 'WORLD_BUILD_FAILED',
            message:
              world.error_message ?? 'HappyOyster failed to build the world.',
          }
        : null,
  };
}
