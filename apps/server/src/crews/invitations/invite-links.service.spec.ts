import {
  CrewInviteLinksService,
  crewInviteLinkState,
} from './invite-links.service';

const NOW = new Date('2026-08-24T12:00:00.000Z');

function link(over: Partial<Parameters<typeof crewInviteLinkState>[0]> = {}) {
  return {
    revokedAt: null,
    expiresAt: null,
    maxUses: null,
    useCount: 0,
    ...over,
  };
}

describe('crewInviteLinkState', () => {
  it('treats an unbounded link as active — no expiry and no cap is a real choice', () => {
    expect(crewInviteLinkState(link(), NOW)).toBe('active');
  });

  it('reports revoked ahead of every other reason', () => {
    // A revoked link that is also expired and exhausted must still read as
    // revoked: that is the state the crew acted on and expects to see.
    expect(
      crewInviteLinkState(
        link({
          revokedAt: new Date('2026-08-01T00:00:00.000Z'),
          expiresAt: new Date('2026-08-02T00:00:00.000Z'),
          maxUses: 1,
          useCount: 5,
        }),
        NOW,
      ),
    ).toBe('revoked');
  });

  it('expires exactly at the boundary, not a tick later', () => {
    expect(crewInviteLinkState(link({ expiresAt: NOW }), NOW)).toBe('expired');
    expect(
      crewInviteLinkState(
        link({ expiresAt: new Date(NOW.getTime() + 1) }),
        NOW,
      ),
    ).toBe('active');
  });

  it('exhausts on reaching the cap, and never on an unlimited link', () => {
    expect(crewInviteLinkState(link({ maxUses: 3, useCount: 2 }), NOW)).toBe(
      'active',
    );
    expect(crewInviteLinkState(link({ maxUses: 3, useCount: 3 }), NOW)).toBe(
      'exhausted',
    );
    // A cap that was somehow overshot still reads as closed, not active.
    expect(crewInviteLinkState(link({ maxUses: 3, useCount: 9 }), NOW)).toBe(
      'exhausted',
    );
    expect(
      crewInviteLinkState(link({ maxUses: null, useCount: 9_999 }), NOW),
    ).toBe('active');
  });
});

describe('community invitation replay', () => {
  function harness(active: boolean) {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          kind: 'community',
          revoked_at: new Date(),
          expires_at: null,
          max_uses: 1,
          use_count: 1,
        },
      ]),
      crewInviteLinkRedemption: {
        findUnique: jest.fn().mockResolvedValue({ id: 'redemption' }),
        create: jest.fn(),
      },
      crewInviteLink: { update: jest.fn() },
      conversationParticipant: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            active ? { conversationId: 'community-chat' } : null,
          ),
      },
    };
    const prisma = {
      crew: {
        findFirst: jest.fn().mockResolvedValue({ id: 'crew', name: 'Crew' }),
      },
      $transaction: jest.fn(async (fn: (db: typeof tx) => Promise<unknown>) =>
        fn(tx),
      ),
    };
    const conversations = {
      joinCrewCommunityConversation: jest
        .fn()
        .mockResolvedValue({ id: 'community-chat' }),
    };
    const service = new CrewInviteLinksService(
      prisma as never,
      {} as never,
      conversations as never,
      {} as never,
      {} as never,
    );
    return { service, conversations, tx };
  }

  it('returns an existing active membership without rejoining through a revoked link', async () => {
    const h = harness(true);
    await expect(
      h.service.accept(
        { id: 'link', kind: 'community', crewId: 'crew' } as never,
        { userId: 'user' } as never,
      ),
    ).resolves.toMatchObject({ conversationId: 'community-chat' });
    expect(
      h.conversations.joinCrewCommunityConversation,
    ).not.toHaveBeenCalled();
    expect(h.tx.conversationParticipant.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user',
        leftAt: null,
        conversation: {
          contextType: 'crew',
          contextId: 'crew',
          crewChannel: 'community',
        },
      },
      select: { conversationId: true },
    });
  });

  it.each(['revoked', 'expired', 'exhausted'])(
    'does not restore departed access through an %s link',
    async (state) => {
      const h = harness(false);
      h.tx.$queryRaw.mockResolvedValue([
        {
          kind: 'community',
          revoked_at: state === 'revoked' ? new Date() : null,
          expires_at: state === 'expired' ? new Date(0) : null,
          max_uses: state === 'exhausted' ? 1 : null,
          use_count: 1,
        },
      ]);
      await expect(
        h.service.accept(
          { id: 'link', kind: 'community', crewId: 'crew' } as never,
          { userId: 'user' } as never,
        ),
      ).rejects.toMatchObject({
        response: { code: 'CREW_COMMUNITY_INVITE_LINK_NOT_ACTIVE' },
      });
      expect(
        h.conversations.joinCrewCommunityConversation,
      ).not.toHaveBeenCalled();
    },
  );
  it('allows re-entry through a still-valid link without consuming another use', async () => {
    const h = harness(false);
    h.tx.$queryRaw.mockResolvedValue([
      {
        kind: 'community',
        revoked_at: null,
        expires_at: null,
        max_uses: null,
        use_count: 1,
      },
    ]);
    await expect(
      h.service.accept(
        { id: 'link', kind: 'community', crewId: 'crew' } as never,
        { userId: 'user' } as never,
      ),
    ).resolves.toMatchObject({ conversationId: 'community-chat' });
    expect(h.conversations.joinCrewCommunityConversation).toHaveBeenCalledTimes(
      1,
    );
    expect(h.tx.crewInviteLinkRedemption.create).not.toHaveBeenCalled();
    expect(h.tx.crewInviteLink.update).not.toHaveBeenCalled();
  });
});
