import {
  CONVERSATION_REALTIME_EVENT,
  CREW_CONVERSATION_METADATA_SCHEMA,
  conversationChannel,
  crewConversationRoom,
  type ConversationFrame,
} from '@repo/shared/conversation';
import {
  AblyConversationRealtimeService,
  createConversationAblyRestClient,
  type ConversationAblyRestClient,
} from './conversation-realtime.service';

const USER_ID = 'user-1';
const CONVERSATION_ID = 'conversation-1';
const MESSAGE_ID = 'message-1';

function messageFrame(): ConversationFrame {
  return {
    event: 'message.created',
    data: {
      conversationId: CONVERSATION_ID,
      message: {
        id: MESSAGE_ID,
        body: 'Production-ready message',
      },
      lastMessageAt: '2026-07-29T12:00:00.000Z',
      unreadCount: 1,
    },
  } as ConversationFrame;
}

function fakeRest() {
  const publish = jest.fn().mockResolvedValue(undefined);
  const get = jest.fn().mockReturnValue({ publish });
  const createTokenRequest = jest
    .fn()
    .mockImplementation(
      (params: {
        capability?: Readonly<Record<string, readonly string[]>>;
        clientId?: string;
        ttl?: number;
      }) =>
        Promise.resolve({
          keyName: 'app.key',
          timestamp: 1,
          capability: JSON.stringify(params.capability),
          clientId: params.clientId,
          ttl: params.ttl,
          nonce: 'nonce',
          mac: 'mac',
        }),
    );
  const request = jest.fn().mockResolvedValue({ success: true });
  const rest = {
    channels: { get },
    auth: { createTokenRequest },
    request,
  } as unknown as ConversationAblyRestClient;
  return { rest, publish, get, createTokenRequest, request };
}

describe('AblyConversationRealtimeService', () => {
  const originalTtl = process.env.CONVERSATION_ABLY_TOKEN_TTL_MS;

  beforeEach(() => {
    process.env.CONVERSATION_ABLY_TOKEN_TTL_MS = '900000';
  });

  afterAll(() => {
    if (originalTtl === undefined) {
      delete process.env.CONVERSATION_ABLY_TOKEN_TTL_MS;
    } else {
      process.env.CONVERSATION_ABLY_TOKEN_TTL_MS = originalTtl;
    }
  });

  it('fails boot when the required Ably API key is absent or malformed', () => {
    expect(() => createConversationAblyRestClient({})).toThrow(/ABLY_API_KEY/);
    expect(() =>
      createConversationAblyRestClient({ ABLY_API_KEY: 'not-a-complete-key' }),
    ).toThrow(/ABLY_API_KEY/);
  });

  it('publishes typed private frames with an idempotent message id', async () => {
    const t = fakeRest();
    const service = new AblyConversationRealtimeService(t.rest);
    const frame = messageFrame();

    await service.publishUserFrame(USER_ID, frame, 'message-1:user-1');

    expect(t.get).toHaveBeenCalledWith(conversationChannel(USER_ID));
    expect(t.publish).toHaveBeenCalledWith({
      id: 'message-1:user-1',
      name: CONVERSATION_REALTIME_EVENT,
      data: frame,
    });
  });

  it('publishes one crew signal through the Ably Chat REST API', async () => {
    const t = fakeRest();
    const service = new AblyConversationRealtimeService(t.rest);

    await service.publishCrewMessage(
      CONVERSATION_ID,
      messageFrame(),
      MESSAGE_ID,
    );

    expect(t.request).toHaveBeenCalledWith(
      'POST',
      `/chat/v4/rooms/${encodeURIComponent(
        crewConversationRoom(CONVERSATION_ID),
      )}/messages`,
      4,
      { idempotencyKey: MESSAGE_ID },
      {
        text: 'Production-ready message',
        metadata: {
          schema: CREW_CONVERSATION_METADATA_SCHEMA,
          event: 'message.created',
          conversationId: CONVERSATION_ID,
          messageId: MESSAGE_ID,
        },
      },
    );
  });

  it('issues identity-bound subscribe-only user credentials', async () => {
    const t = fakeRest();
    const service = new AblyConversationRealtimeService(t.rest);

    const grant = await service.issueUserGrant(USER_ID);

    expect(t.createTokenRequest).toHaveBeenCalledWith({
      capability: { [conversationChannel(USER_ID)]: ['subscribe'] },
      clientId: USER_ID,
      ttl: 900000,
    });
    expect(grant).toMatchObject({
      channel: conversationChannel(USER_ID),
      ttlMs: 900000,
      tokenRequest: { clientId: USER_ID, ttl: 900000 },
    });
  });

  it('issues room-scoped chat credentials without direct message publish', async () => {
    const t = fakeRest();
    const service = new AblyConversationRealtimeService(t.rest);

    const grant = await service.issueCrewGrant(CONVERSATION_ID, USER_ID);

    const room = crewConversationRoom(CONVERSATION_ID);
    expect(t.createTokenRequest).toHaveBeenCalledWith({
      capability: {
        [room]: [
          'subscribe',
          'history',
          'presence',
          'annotation-publish',
          'annotation-subscribe',
        ],
      },
      clientId: USER_ID,
      ttl: 900000,
    });
    expect(grant).toMatchObject({
      room,
      channel: conversationChannel(USER_ID),
      tokenRequest: { clientId: USER_ID },
    });

    const capability = JSON.parse(grant.tokenRequest.capability) as Record<
      string,
      string[]
    >;
    expect(capability[room]).not.toContain('publish');
  });

  it('rejects token TTL values outside the security envelope', () => {
    process.env.CONVERSATION_ABLY_TOKEN_TTL_MS = '86400000';
    const t = fakeRest();

    expect(() => new AblyConversationRealtimeService(t.rest)).toThrow(
      'CONVERSATION_ABLY_TOKEN_TTL_MS must be an integer between',
    );
  });
});
