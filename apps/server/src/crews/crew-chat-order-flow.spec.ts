/**
 * A crew group chat must not be drivable into the order state machine.
 *
 * This is the load-bearing consequence of the "crew participants get
 * exactly one role, `member`" decision. Every proposal/order gate is
 * role-based, context-based, or both — and `member` is neither `buyer`
 * nor `creator`, so all of them fail closed with no crew-specific
 * branch anywhere in the order flow:
 *
 *   conversations.service.ts  persistProposal   role !== 'creator'
 *   conversations.service.ts  declineProposal   role !== 'buyer'
 *   orders.service.ts         acceptProposal    role !== 'buyer'
 *   orders.service.ts         acceptProposal    contextType !== 'service'
 *   orders.service.ts         acceptProposal    no 'creator' participant
 *
 * These tests exist so that adding a crew role to
 * CONVERSATION_PARTICIPANT_ROLES — or letting a crew conversation
 * borrow `buyer`/`creator` for convenience — trips a red test instead
 * of silently opening a payment path inside a group chat.
 */
import { ConversationsService } from '../conversations/conversations.service';
import { OrdersService } from '../orders/orders.service';

const CREW_ID = 'crew-1';
const CONVERSATION_ID = 'conv-crew-1';
const MEMBER = 'u-member';
const PROPOSAL_ID = 'msg-proposal';

const PROPOSAL_INPUT = {
  packageTier: 'standard' as const,
  price: 5000,
  currency: 'CNY' as const,
  deliveryDays: 7,
  revisions: 2,
  scope: ['storyboard'],
  note: 'Trying to sell inside a crew chat.',
};

/**
 * A crew conversation exactly as the crews module builds it: contextType
 * `crew`, contextId the crew id, every participant role `member`.
 */
function crewConversation(participantRoles: Record<string, string>) {
  const participants = Object.entries(participantRoles).map(
    ([userId, role]) => ({
      conversationId: CONVERSATION_ID,
      userId,
      role,
      leftAt: null,
      lastReadMessageId: null,
      lastReadAt: null,
    }),
  );
  return {
    id: CONVERSATION_ID,
    contextType: 'crew',
    contextId: CREW_ID,
    lookupKey: `crew:${CREW_ID}`,
    participants,
  };
}

function build(
  opts: {
    participantRoles?: Record<string, string>;
    contextType?: string;
  } = {},
) {
  const conv = crewConversation(
    opts.participantRoles ?? { [MEMBER]: 'member' },
  );
  if (opts.contextType) conv.contextType = opts.contextType;

  const messageCreate = jest.fn();
  // `$transaction` hands the callback this same object, so it is
  // assigned after construction — a self-reference inside the literal
  // would widen the whole mock to `any`.
  const prisma: {
    conversation: { findUnique: jest.Mock };
    conversationParticipant: { findUnique: jest.Mock; findMany: jest.Mock };
    message: { findUnique: jest.Mock; create: jest.Mock; count: jest.Mock };
    $transaction: jest.Mock;
  } = {
    conversation: {
      findUnique: jest.fn().mockResolvedValue(conv),
    },
    conversationParticipant: {
      findUnique: jest.fn(
        ({ where }: { where: { conversationId_userId: { userId: string } } }) =>
          Promise.resolve(
            conv.participants.find(
              (p) => p.userId === where.conversationId_userId.userId,
            ) ?? null,
          ),
      ),
      findMany: jest.fn().mockResolvedValue(conv.participants),
    },
    message: {
      findUnique: jest.fn().mockResolvedValue({
        id: PROPOSAL_ID,
        conversationId: CONVERSATION_ID,
        type: 'proposal',
        payload: { kind: 'proposal', proposal: { status: 'open' } },
      }),
      create: messageCreate,
      count: jest.fn().mockResolvedValue(0),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((cb: (client: unknown) => unknown) =>
    cb(prisma),
  );
  const realtime = {
    publishUserFrame: jest.fn().mockResolvedValue(undefined),
    publishCrewMessage: jest.fn().mockResolvedValue(undefined),
  };

  const conversations = new ConversationsService(
    prisma as never,
    realtime as never,
    { send: jest.fn().mockResolvedValue({}) } as never,
  );
  return {
    messageCreate,
    conversations,
    orders: new OrdersService(prisma as never, conversations),
  };
}

describe('crew chat cannot be driven into the order flow', () => {
  it('a crew member cannot post a proposal — role is not creator', async () => {
    const t = build();

    await expect(
      t.conversations.persistProposal(
        CONVERSATION_ID,
        MEMBER,
        PROPOSAL_INPUT as never,
      ),
    ).rejects.toThrow('Only the creator can send a proposal');
    expect(t.messageCreate).not.toHaveBeenCalled();
  });

  it('a crew member cannot decline a proposal — role is not buyer', async () => {
    const t = build();

    await expect(
      t.conversations.declineProposal(CONVERSATION_ID, MEMBER, PROPOSAL_ID),
    ).rejects.toThrow('Only the buyer can decline a proposal');
  });

  it('a crew member cannot accept a proposal into an order — role is not buyer', async () => {
    const t = build();

    await expect(
      t.orders.acceptProposal(MEMBER, CONVERSATION_ID, PROPOSAL_ID),
    ).rejects.toThrow('Only the buyer can accept a proposal');
  });

  it('even a buyer-roled participant cannot accept inside a crew context', async () => {
    // Defense in depth: if a future bug ever wrote `buyer` onto a crew
    // participant, the context gate is still there.
    const t = build({ participantRoles: { [MEMBER]: 'buyer' } });

    await expect(
      t.orders.acceptProposal(MEMBER, CONVERSATION_ID, PROPOSAL_ID),
    ).rejects.toThrow(
      'Conversation is not a service inquiry — cannot accept proposal here',
    );
  });

  it('a service-context thread with only members has no creator to bill', async () => {
    // And if BOTH the role and the context gate were somehow bypassed,
    // the "who is the creator" lookup finds nobody.
    const t = build({
      contextType: 'service',
      participantRoles: { [MEMBER]: 'buyer', 'u-other': 'member' },
    });

    await expect(
      t.orders.acceptProposal(MEMBER, CONVERSATION_ID, PROPOSAL_ID),
    ).rejects.toThrow('Conversation has no creator participant');
  });

  it('proposals stay refused even on a crew thread that has messages', async () => {
    const t = build({
      participantRoles: { [MEMBER]: 'member', 'u-owner': 'member' },
    });

    await expect(
      t.conversations.persistProposal(
        CONVERSATION_ID,
        'u-owner',
        PROPOSAL_INPUT as never,
      ),
    ).rejects.toThrow('Only the creator can send a proposal');
  });
});
