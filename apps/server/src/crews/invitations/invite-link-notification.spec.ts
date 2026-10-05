import { CrewInviteLinksService } from './invite-links.service';
import { joinCrewInTransaction } from './join-crew';

jest.mock('./join-crew', () => ({ joinCrewInTransaction: jest.fn() }));

function harness() {
  const tx = {
    $queryRaw: jest
      .fn()
      .mockResolvedValue([
        { revoked_at: null, expires_at: null, max_uses: null, use_count: 0 },
      ]),
    crewInviteLinkRedemption: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
    },
    crewMember: { findFirst: jest.fn().mockResolvedValue(null) },
    crewInviteLink: { update: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    crew: {
      findFirst: jest.fn().mockResolvedValue({ id: 'crew', name: 'Fixture' }),
    },
    $transaction: jest.fn((callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
  };
  const notifications = { send: jest.fn().mockResolvedValue({}) };
  const conversations = {
    broadcastMessage: jest
      .fn()
      .mockRejectedValue(new Error('Realtime unavailable')),
  };
  jest.mocked(joinCrewInTransaction).mockResolvedValue({
    memberId: 'member',
    systemMessage: { id: 'message' },
  } as never);
  const service = new CrewInviteLinksService(
    prisma as never,
    {} as never,
    conversations as never,
    {} as never,
    notifications as never,
    {} as never,
  );
  const accept = () =>
    service.accept(
      {
        id: 'link',
        crewId: 'crew',
        kind: 'member',
        createdByUserId: 'owner',
        policyKeys: [],
      } as never,
      { userId: 'applicant' },
    );
  return { tx, notifications, conversations, accept };
}

describe('Crew invite acceptance notification durability', () => {
  beforeEach(() => jest.clearAllMocks());
  it('queues the owner alert with membership even when realtime broadcasting fails', async () => {
    const h = harness();
    await expect(h.accept()).rejects.toThrow('Realtime unavailable');
    expect(h.notifications.send).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'owner',
        type: 'crew.invitation.accepted',
        meta: {
          crewId: 'crew',
          crewName: 'Fixture',
          userId: 'applicant',
          inviteLinkId: 'link',
          deeplink: '/crews/crew/workspace?tab=members',
        },
      }),
      h.tx,
    );
    h.tx.crewInviteLinkRedemption.findUnique.mockResolvedValue({
      memberId: 'member',
    });
    h.tx.crewMember.findFirst.mockResolvedValue({ id: 'member' });
    await expect(h.accept()).resolves.toMatchObject({ memberId: 'member' });
    expect(h.notifications.send).toHaveBeenCalledTimes(1);
  });
  it('does not broadcast a successful join if the durable notification write fails', async () => {
    const h = harness();
    h.notifications.send.mockRejectedValue(new Error('Outbox unavailable'));
    await expect(h.accept()).rejects.toThrow('Outbox unavailable');
    expect(h.conversations.broadcastMessage).not.toHaveBeenCalled();
  });
});
