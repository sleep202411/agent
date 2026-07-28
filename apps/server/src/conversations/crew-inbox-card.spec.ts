/**
 * Inbox row projection for crew conversations.
 *
 * A crew chat is N-party, so "the other participant" is not a thing.
 * The pre-crew mapper searched for `userId !== viewerId` and fell back
 * to `participants[0]`, which in a founder-only crew resolves to the
 * VIEWER — the inbox would render you as your own counterparty. These
 * tests pin the crew branch and, just as importantly, pin that the
 * shipped service/order projection did not move.
 */
import { toConversationCardDTO, type CrewCardContext } from './mappers';

const VIEWER = 'u-viewer';
const OTHER = 'u-other';
const CREW_ID = 'crew-1';

const LAST_MESSAGE_AT = new Date('2026-07-20T10:00:00.000Z');

function participant(userId: string, role: string) {
  return {
    conversationId: 'conv-1',
    userId,
    role,
    lastReadMessageId: null,
    lastReadAt: null,
    mutedUntil: null,
    joinedAt: LAST_MESSAGE_AT,
    leftAt: null,
  };
}

function conversation(
  contextType: string,
  contextId: string,
  participants: ReturnType<typeof participant>[],
) {
  return {
    id: 'conv-1',
    contextType,
    contextId,
    lookupKey: `${contextType}:${contextId}`,
    lastMessageAt: LAST_MESSAGE_AT,
    createdAt: LAST_MESSAGE_AT,
    participants,
    _unreadCount: 4,
    _lastMessage: null,
  };
}

const CREW_CONTEXT: CrewCardContext = {
  name: 'Night Shift',
  logo: 'https://cdn.example/night-shift.png',
  memberCount: 12,
};

describe('toConversationCardDTO — crew rows project the crew', () => {
  it('never makes a solo founder their own counterparty', () => {
    // The exact shape the old fallback broke on: one participant, the
    // viewer.
    const conv = conversation('crew', CREW_ID, [participant(VIEWER, 'member')]);

    const card = toConversationCardDTO(conv as never, VIEWER, CREW_CONTEXT);

    expect(card.counterpartyId).not.toBe(VIEWER);
    expect(card.counterpartyId).toBe(CREW_ID);
    expect(card.counterpartyRole).toBe('member');
  });

  it('does not pick an arbitrary other member as the counterparty', () => {
    const conv = conversation('crew', CREW_ID, [
      participant(VIEWER, 'member'),
      participant(OTHER, 'member'),
      participant('u-third', 'member'),
    ]);

    const card = toConversationCardDTO(conv as never, VIEWER, CREW_CONTEXT);

    expect(card.counterpartyId).toBe(CREW_ID);
  });

  it('carries crew id, name, logo and member count', () => {
    const conv = conversation('crew', CREW_ID, [participant(VIEWER, 'member')]);

    const card = toConversationCardDTO(conv as never, VIEWER, CREW_CONTEXT);

    expect(card).toMatchObject({
      contextType: 'crew',
      crewId: CREW_ID,
      crewName: 'Night Shift',
      crewLogo: 'https://cdn.example/night-shift.png',
      memberCount: 12,
    });
  });

  it('still resolves a usable identity when crew metadata is unavailable', () => {
    const conv = conversation('crew', CREW_ID, [participant(VIEWER, 'member')]);

    const card = toConversationCardDTO(conv as never, VIEWER);

    expect(card.counterpartyId).toBe(CREW_ID);
    expect(card.crewId).toBe(CREW_ID);
    expect(card.crewName).toBeUndefined();
    expect(card.memberCount).toBeUndefined();
  });

  it('keeps the viewer’s unread count', () => {
    const conv = conversation('crew', CREW_ID, [participant(VIEWER, 'member')]);

    expect(
      toConversationCardDTO(conv as never, VIEWER, CREW_CONTEXT).unreadCount,
    ).toBe(4);
  });

  it('zeroes unread for a departed member who is no longer a participant', () => {
    const conv = conversation('crew', CREW_ID, [participant(OTHER, 'member')]);

    expect(
      toConversationCardDTO(conv as never, VIEWER, CREW_CONTEXT).unreadCount,
    ).toBe(0);
  });
});

describe('toConversationCardDTO — service / order projection is unchanged', () => {
  it('still resolves the human counterparty on a service row', () => {
    const conv = conversation('service', 'svc-1', [
      participant(VIEWER, 'buyer'),
      participant(OTHER, 'creator'),
    ]);

    const card = toConversationCardDTO(conv as never, VIEWER);

    expect(card).toMatchObject({
      contextType: 'service',
      counterpartyId: OTHER,
      counterpartyRole: 'creator',
    });
  });

  it('leaves the crew fields undefined on an order row', () => {
    const conv = conversation('order', 'ord-1', [
      participant(VIEWER, 'buyer'),
      participant(OTHER, 'creator'),
    ]);

    const card = toConversationCardDTO(conv as never, VIEWER);

    expect(card.crewId).toBeUndefined();
    expect(card.crewName).toBeUndefined();
    expect(card.crewLogo).toBeUndefined();
    expect(card.memberCount).toBeUndefined();
  });

  it('ignores crew metadata handed to a non-crew row', () => {
    const conv = conversation('service', 'svc-1', [
      participant(VIEWER, 'buyer'),
      participant(OTHER, 'creator'),
    ]);

    const card = toConversationCardDTO(conv as never, VIEWER, CREW_CONTEXT);

    expect(card.counterpartyId).toBe(OTHER);
    expect(card.crewName).toBeUndefined();
  });
});
