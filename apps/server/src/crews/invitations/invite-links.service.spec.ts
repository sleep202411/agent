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

describe('invite link audit atomicity', () => {
  it.each(['create', 'revoke'] as const)(
    'rolls back %s when the audit write fails',
    async (action) => {
      const initial = {
        id: 'link',
        crewId: 'crew',
        kind: 'member',
        policyKeys: [],
        maxUses: null,
        useCount: 0,
        expiresAt: null,
        createdAt: new Date(),
        createdByUserId: 'owner',
        revokedAt: null,
      };
      let saved: unknown = action === 'create' ? null : initial;
      const db = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: 'link' }]),
        crew: { findFirst: jest.fn().mockResolvedValue({ id: 'crew' }) },
        crewInviteLink: {
          create: jest.fn(() => {
            saved = initial;
            return Promise.resolve(initial);
          }),
          findFirst: jest.fn(() => Promise.resolve(saved)),
          update: jest.fn(() => {
            saved = { ...initial, revokedAt: new Date() };
            return Promise.resolve(saved);
          }),
        },
        crewAuthorizationEvent: {
          create: jest.fn().mockRejectedValue(new Error('audit unavailable')),
        },
      };
      const prisma = {
        ...db,
        $transaction: async (fn: (tx: typeof db) => Promise<unknown>) => {
          const before = saved;
          try {
            return await fn(db);
          } catch (error) {
            saved = before;
            throw error;
          }
        },
      };
      const service = new CrewInviteLinksService(
        prisma as never,
        {
          require: jest.fn().mockResolvedValue({ memberId: 'owner-member' }),
        } as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );
      const request =
        action === 'create'
          ? service.create('crew', 'owner', {
              kind: 'member',
              policyKeys: [],
            } as never)
          : service.revoke('crew', 'owner', 'link');
      await expect(request).rejects.toThrow('audit unavailable');
      expect(saved).toBe(action === 'create' ? null : initial);
    },
  );
});

describe('invite link revocation serialization', () => {
  it.each(['already revoked', 'permission removed'])(
    'rejects a waiting request after %s',
    async (reason) => {
      let acquired = false;
      const tx = {
        $queryRaw: jest.fn(() => {
          acquired = true;
          return Promise.resolve(
            reason === 'already revoked' ? [] : [{ id: 'link' }],
          );
        }),
        crewInviteLink: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: 'link', kind: 'member', useCount: 1 }),
          update: jest.fn(),
        },
        crewAuthorizationEvent: { create: jest.fn() },
      };
      const authorization = {
        require: jest.fn(() => {
          if (acquired && reason === 'permission removed')
            return Promise.reject(new Error('permission removed'));
          return Promise.resolve({ memberId: 'actor' });
        }),
      };
      const service = new CrewInviteLinksService(
        { $transaction: (fn: (db: typeof tx) => unknown) => fn(tx) } as never,
        authorization as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );
      await expect(service.revoke('crew', 'actor', 'link')).rejects.toThrow();
      expect(tx.crewInviteLink.update).not.toHaveBeenCalled();
      expect(tx.crewAuthorizationEvent.create).not.toHaveBeenCalled();
    },
  );
});

it('lists both community and member links without returning their bearer secrets', async () => {
  const rows = ['member', 'community'].map((kind) => ({
    id: kind,
    kind,
    crewId: 'crew',
    policyKeys: [],
    revokedAt: null,
    expiresAt: null,
    maxUses: null,
    useCount: 0,
    createdAt: new Date(),
    createdByUserId: 'owner',
    tokenHash: 'secret-hash',
  }));
  const prisma = {
    crewInviteLink: {
      findMany: jest.fn(({ where }: { where: { kind?: string } }) =>
        Promise.resolve(
          rows.filter((row) => !where.kind || row.kind === where.kind),
        ),
      ),
    },
  };
  const authorization = { require: jest.fn().mockResolvedValue({}) };
  const service = new CrewInviteLinksService(
    prisma as never,
    authorization as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const result = await service.list('crew', 'owner');
  expect(result.map((link) => link.kind)).toEqual(['member', 'community']);
  expect(
    result.every((link) => !('tokenHash' in link) && !('token' in link)),
  ).toBe(true);
  expect(authorization.require).toHaveBeenCalledWith(
    'crew',
    'owner',
    'members.invite',
  );
});
