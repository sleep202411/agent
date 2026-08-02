import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  type Provider,
} from '@nestjs/common';
import type {
  ConversationAblyTokenRequestDTO,
  ConversationFrame,
  ConversationRealtimeGrantDTO,
  CrewConversationRealtimeGrantDTO,
} from '@repo/shared/conversation';
import {
  CONVERSATION_REALTIME_EVENT,
  CREW_CONVERSATION_METADATA_SCHEMA,
  conversationChannel,
  crewConversationRoom,
} from '@repo/shared/conversation';
import * as Ably from 'ably';
import {
  ABLY_REST_CLIENT,
  createAblyRestClient,
  type AblyRestClient,
} from '../infra/realtime/ably-token-credentials';

const DEFAULT_TOKEN_TTL_MS = 15 * 60 * 1000;
const MIN_TOKEN_TTL_MS = 10 * 60 * 1000;
const MAX_TOKEN_TTL_MS = 60 * 60 * 1000;
const CHAT_API_VERSION = 4;

export interface ConversationRealtimePublisher {
  publishUserFrame(
    userId: string,
    frame: ConversationFrame,
    idempotencyKey: string,
  ): Promise<void>;
  publishCrewMessage(
    conversationId: string,
    frame: ConversationFrame,
    idempotencyKey: string,
  ): Promise<void>;
  issueUserGrant(userId: string): Promise<ConversationRealtimeGrantDTO>;
  issueCrewGrant(
    conversationId: string,
    userId: string,
  ): Promise<CrewConversationRealtimeGrantDTO>;
}

export const CONVERSATION_REALTIME = Symbol('CONVERSATION_REALTIME');
export const CONVERSATION_ABLY_REST = Symbol('CONVERSATION_ABLY_REST');

export type ConversationAblyRestClient = AblyRestClient;

function tokenTtlMs(env: NodeJS.ProcessEnv): number {
  const raw = env.CONVERSATION_ABLY_TOKEN_TTL_MS?.trim();
  if (!raw) return DEFAULT_TOKEN_TTL_MS;
  const value = Number(raw);
  if (
    !Number.isSafeInteger(value) ||
    value < MIN_TOKEN_TTL_MS ||
    value > MAX_TOKEN_TTL_MS
  ) {
    throw new Error(
      `CONVERSATION_ABLY_TOKEN_TTL_MS must be an integer between ${MIN_TOKEN_TTL_MS} and ${MAX_TOKEN_TTL_MS}.`,
    );
  }
  return value;
}

function publicTokenRequest(
  request: Ably.TokenRequest,
): ConversationAblyTokenRequestDTO {
  return {
    keyName: request.keyName,
    ...(request.ttl == null ? {} : { ttl: request.ttl }),
    timestamp: request.timestamp,
    capability: request.capability,
    ...(request.clientId == null ? {} : { clientId: request.clientId }),
    nonce: request.nonce,
    mac: request.mac,
  };
}

export function createConversationAblyRestClient(
  env: NodeJS.ProcessEnv = process.env,
): Ably.Rest {
  return createAblyRestClient(env);
}

/**
 * The single Conversations transport owner.
 *
 * Postgres remains authoritative. This service only publishes committed facts
 * and signs least-privilege browser credentials. It owns no socket and uses
 * Ably REST for both Pub/Sub frames and Chat REST messages, so Nest replicas
 * consume zero realtime connection slots.
 */
@Injectable()
export class AblyConversationRealtimeService
  implements ConversationRealtimePublisher, OnModuleDestroy
{
  private readonly logger = new Logger(AblyConversationRealtimeService.name);
  private readonly ttlMs: number;

  constructor(
    @Inject(CONVERSATION_ABLY_REST)
    private readonly rest: ConversationAblyRestClient,
  ) {
    this.ttlMs = tokenTtlMs(process.env);
  }

  async publishUserFrame(
    userId: string,
    frame: ConversationFrame,
    idempotencyKey: string,
  ): Promise<void> {
    await this.rest.channels.get(conversationChannel(userId)).publish({
      id: idempotencyKey,
      name: CONVERSATION_REALTIME_EVENT,
      data: frame,
    });
  }

  async publishCrewMessage(
    conversationId: string,
    frame: ConversationFrame,
    idempotencyKey: string,
  ): Promise<void> {
    const room = crewConversationRoom(conversationId);
    const response = await this.rest.request(
      'POST',
      `/chat/v4/rooms/${encodeURIComponent(room)}/messages`,
      CHAT_API_VERSION,
      { idempotencyKey },
      {
        text:
          frame.event === 'message.created'
            ? frame.data.message.body.slice(0, 4_000)
            : '',
        metadata: {
          schema: CREW_CONVERSATION_METADATA_SCHEMA,
          event: frame.event,
          conversationId,
          messageId:
            frame.event === 'message.created'
              ? frame.data.message.id
              : undefined,
        },
      },
    );
    if (!response.success) {
      throw new Ably.ErrorInfo(
        response.errorMessage,
        response.errorCode,
        response.statusCode,
      );
    }
  }

  async issueUserGrant(userId: string): Promise<ConversationRealtimeGrantDTO> {
    const channel = conversationChannel(userId);
    const tokenRequest = await this.rest.auth.createTokenRequest({
      capability: { [channel]: ['subscribe'] },
      clientId: userId,
      ttl: this.ttlMs,
    });
    return {
      channel,
      ttlMs: this.ttlMs,
      tokenRequest: publicTokenRequest(tokenRequest),
    };
  }

  async issueCrewGrant(
    conversationId: string,
    userId: string,
  ): Promise<CrewConversationRealtimeGrantDTO> {
    const room = crewConversationRoom(conversationId);
    const tokenRequest = await this.rest.auth.createTokenRequest({
      capability: {
        [room]: [
          'subscribe',
          'history',
          'presence',
          'annotation-publish',
          'annotation-subscribe',
        ],
      },
      clientId: userId,
      ttl: this.ttlMs,
    });
    return {
      channel: conversationChannel(userId),
      room,
      ttlMs: this.ttlMs,
      tokenRequest: publicTokenRequest(tokenRequest),
    };
  }

  onModuleDestroy(): void {
    // Ably.Rest owns no realtime socket. Keep this lifecycle hook explicit so
    // a future transport change cannot silently add a process-wide connection.
    this.logger.debug('conversation Ably REST client released');
  }
}

export const conversationAblyRestProvider: Provider = {
  provide: CONVERSATION_ABLY_REST,
  useExisting: ABLY_REST_CLIENT,
};

export const conversationRealtimeProvider: Provider = {
  provide: CONVERSATION_REALTIME,
  useClass: AblyConversationRealtimeService,
};
