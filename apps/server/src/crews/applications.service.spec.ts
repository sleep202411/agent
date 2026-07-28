/**
 * ApplicationsService ↔ crew group chat.
 *
 * Approval is the moment an applicant becomes a member, so it is also
 * the moment they enter the chat — same transaction, so the roster and
 * the participant list can never disagree. Rejection changes no
 * membership and must therefore leave the chat completely alone: a
 * rejected applicant appearing in (or being announced to) the crew's
 * private thread would be both a bug and a disclosure.
 */
import { ApplicationsService } from './applications.service';

const CREW_ID = 'crew-1';
const CREW_NAME = 'Night Shift';
const CONVERSATION_ID = 'conv-crew-1';
const OWNER = 'u-owner';
const APPLICANT = 'u-applicant';
const APPLICATION_ID = 'app-1';
const POSITION_ID = 'pos-1';

interface SyncCall {
  crewId: string;
  userId: string;
  action: 'join' | 'leave';
  tx: unknown;
}

function build() {
  const applicationRow = {
    id: APPLICATION_ID,
    crewId: CREW_ID,
    positionId: POSITION_ID,
    applicantId: APPLICANT,
    status: 'pending',
    message: null,
    portfolioUrl: null,
    expectedCompensationAmount: null,
    expectedCompensationCurrency: null,
    expectedCompensationPeriod: null,
    availableStartDate: null,
    yearsExperience: null,
    reviewedAt: null,
    reviewerId: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
  };

  const tx = {
    crewApplication: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue(applicationRow),
    },
    crewMember: { create: jest.fn().mockResolvedValue({}) },
    $queryRaw: jest.fn().mockResolvedValue([{ id: POSITION_ID }]),
  };

  const prisma = {
    crewApplication: {
      findUnique: jest.fn().mockResolvedValue({
        ...applicationRow,
        crew: {
          id: CREW_ID,
          founderId: OWNER,
          name: CREW_NAME,
          deletedAt: null,
        },
        position: {
          id: POSITION_ID,
          status: 'open',
          positionType: 'animator',
          targetCount: 2,
          recruitedCount: 0,
        },
      }),
    },
    $transaction: jest.fn((cb: (client: unknown) => unknown) => cb(tx)),
  };

  const notifications = { send: jest.fn().mockResolvedValue({}) };

  const syncCalls: SyncCall[] = [];
  const systemCalls: Array<{
    conversationId: string;
    kind: string;
    params: unknown;
    tx: unknown;
  }> = [];
  const broadcast: string[] = [];
  const conversations = {
    openCrewConversation: jest.fn().mockResolvedValue({ id: CONVERSATION_ID }),
    syncCrewParticipant: jest.fn(
      (
        crewId: string,
        userId: string,
        action: 'join' | 'leave',
        txArg: unknown,
      ) => {
        syncCalls.push({ crewId, userId, action, tx: txArg });
        return Promise.resolve();
      },
    ),
    persistSystem: jest.fn(
      (
        conversationId: string,
        kind: string,
        params: unknown,
        txArg: unknown,
      ) => {
        systemCalls.push({ conversationId, kind, params, tx: txArg });
        return Promise.resolve({ id: `msg-${systemCalls.length}` });
      },
    ),
    broadcastMessage: jest.fn((m: { id: string }) => {
      broadcast.push(m.id);
      return Promise.resolve();
    }),
  };

  return {
    prisma,
    tx,
    conversations,
    syncCalls,
    systemCalls,
    broadcast,
    service: new ApplicationsService(
      prisma as never,
      notifications as never,
      conversations as never,
    ),
  };
}

describe('ApplicationsService.approve — approval is a chat join', () => {
  it('syncs the applicant into the chat inside the approval transaction', async () => {
    const t = build();

    await t.service.approve(APPLICATION_ID, OWNER);

    expect(t.syncCalls).toEqual([
      { crewId: CREW_ID, userId: APPLICANT, action: 'join', tx: t.tx },
    ]);
  });

  it('announces the join with crew.member.joined on the same tx', async () => {
    const t = build();

    await t.service.approve(APPLICATION_ID, OWNER);

    expect(t.systemCalls).toEqual([
      {
        conversationId: CONVERSATION_ID,
        kind: 'crew.member.joined',
        params: { userId: APPLICANT },
        tx: t.tx,
      },
    ]);
  });

  it('rolls the approval back when the chat sync fails', async () => {
    const t = build();
    t.conversations.syncCrewParticipant.mockRejectedValueOnce(
      new Error('participant sync exploded'),
    );

    await expect(t.service.approve(APPLICATION_ID, OWNER)).rejects.toThrow(
      'participant sync exploded',
    );
    expect(t.broadcast).toEqual([]);
  });

  it('broadcasts only after the transaction commits', async () => {
    const order: string[] = [];
    const t = build();
    t.prisma.$transaction.mockImplementationOnce(
      async (cb: (client: unknown) => Promise<unknown>) => {
        const r = await cb(t.tx);
        order.push('commit');
        return r;
      },
    );
    t.conversations.broadcastMessage.mockImplementation(() => {
      order.push('broadcast');
      return Promise.resolve();
    });

    await t.service.approve(APPLICATION_ID, OWNER);

    expect(order).toEqual(['commit', 'broadcast']);
  });
});

describe('ApplicationsService.reject — rejection touches no chat', () => {
  it('never syncs a participant or posts to the crew thread', async () => {
    const t = build();

    await t.service.reject(APPLICATION_ID, OWNER);

    expect(t.syncCalls).toEqual([]);
    expect(t.systemCalls).toEqual([]);
    expect(t.conversations.openCrewConversation).not.toHaveBeenCalled();
  });
});
