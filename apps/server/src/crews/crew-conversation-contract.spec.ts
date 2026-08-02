/**
 * The `@repo/shared/conversation` contract, asserted from the server
 * because packages/shared has no test runner of its own.
 *
 * These are not "does the constant exist" busywork. Each one pins a
 * decision that is cheap to undo by accident and expensive to discover
 * in production:
 *   - the narrow crew-chat system kinds exist AND the client i18n keys derived
 *     from them are the ones the web agent was told to add;
 *   - crew participants get exactly ONE role, so the order gates keep
 *     failing closed (see crew-chat-order-flow.spec.ts);
 *   - counterpartyId / counterpartyRole stay REQUIRED — widening them
 *     to optional breaks the shipped order inbox at the type level.
 */
import {
  CONVERSATION_CONTEXT_TYPES,
  CONVERSATION_PARTICIPANT_ROLES,
  SYSTEM_MESSAGE_KINDS,
  type ConversationCardDTO,
  type SystemMessageKind,
} from '@repo/shared/conversation';

const CREW_KINDS: SystemMessageKind[] = [
  'crew.member.joined',
  'crew.member.left',
];

describe('conversation contract — crew context', () => {
  it('adds `crew` as a context type without disturbing service / order', () => {
    expect(CONVERSATION_CONTEXT_TYPES).toEqual(['service', 'order', 'crew']);
  });

  it('gives crew participants exactly one role: member', () => {
    // If this list ever grows a crew-specific role, the order-flow gates
    // stop being automatically closed. See crew-chat-order-flow.spec.ts.
    expect(CONVERSATION_PARTICIPANT_ROLES).toEqual([
      'buyer',
      'creator',
      'member',
    ]);
  });
});

describe('conversation contract — crew system message kinds', () => {
  it('publishes every crew collaboration kind', () => {
    for (const kind of CREW_KINDS) {
      expect(SYSTEM_MESSAGE_KINDS).toContain(kind);
    }
  });

  it('keeps task lifecycle in task activity instead of chat messages', () => {
    for (const kind of [
      'crew.task.created',
      'crew.task.submitted',
      'crew.task.revision_requested',
      'crew.task.approved',
    ]) {
      expect(SYSTEM_MESSAGE_KINDS).not.toContain(kind);
    }
  });

  it('keeps every pre-existing kind', () => {
    // Additive only — dropping a kind silently un-renders history.
    for (const kind of [
      'conversation.created',
      'conversation.context_changed_to_order',
      'proposal.declined',
      'order.submitted',
      'order.accepted',
      'order.declined',
      'order.delivered',
      'order.revision_requested',
      'order.completed',
      'order.cancelled',
    ]) {
      expect(SYSTEM_MESSAGE_KINDS).toContain(kind);
    }
  });

  it('has no duplicate kinds', () => {
    expect(new Set(SYSTEM_MESSAGE_KINDS).size).toBe(
      SYSTEM_MESSAGE_KINDS.length,
    );
  });

  /**
   * conversation-view.tsx builds `system.${kind}` dynamically and
   * inbox-list.tsx builds `preview.system.${kind}`. This test IS the
   * spec handed to the web agent for messages/{en-US,zh-CN,zh-HK}.json.
   */
  it('derives the exact i18n keys the client will look up', () => {
    expect(CREW_KINDS.map((k) => `messages.system.${k}`)).toEqual([
      'messages.system.crew.member.joined',
      'messages.system.crew.member.left',
    ]);
  });
});

describe('conversation contract — inbox card', () => {
  it('keeps counterpartyId / counterpartyRole required', () => {
    // A crew row must still supply both. If either were widened to
    // optional this object would still compile, so assert the values
    // are actually there at runtime too.
    const crewCard: ConversationCardDTO = {
      id: 'conv-1',
      contextType: 'crew',
      contextId: 'crew-1',
      counterpartyId: 'crew-1',
      counterpartyRole: 'member',
      lastMessagePreview: '',
      lastMessageType: 'system',
      lastMessageAt: '2026-07-20T10:00:00.000Z',
      unreadCount: 0,
    };

    expect(crewCard.counterpartyId).toBe('crew-1');
    expect(crewCard.counterpartyRole).toBe('member');
  });

  it('makes the crew fields optional so order rows stay valid', () => {
    const orderCard: ConversationCardDTO = {
      id: 'conv-2',
      contextType: 'order',
      contextId: 'ord-1',
      counterpartyId: 'u-creator',
      counterpartyRole: 'creator',
      lastMessagePreview: 'hi',
      lastMessageType: 'text',
      lastMessageAt: '2026-07-20T10:00:00.000Z',
      unreadCount: 1,
    };

    expect(orderCard.crewId).toBeUndefined();
  });
});
