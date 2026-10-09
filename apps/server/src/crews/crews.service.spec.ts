/**
 * CrewsService ↔ crew group chat.
 *
 * Two things are under test and neither is about Prisma:
 *   1. The chat sync happens INSIDE the membership transaction. Every
 *      assertion checks the tx client was the one handed to the
 *      conversations service — if the sync ran on the outer client, a
 *      failure would commit the roster change and lose the chat.
 *   2. Ownership transfer maps membership moves — not crew roles — onto
 *      participants. Participant.role is flat `member`; only rows that
 *      actually enter or leave `crew_members` move the chat.
 */
import { CrewsService } from './crews.service';
import * as productionBootstrap from './production/production-bootstrap';

const CREW_ID = 'crew-1';
const CONVERSATION_ID = 'conv-crew-1';
const FOUNDER = 'u-founder';
const FOUNDER_USER = { userId: FOUNDER, levelIds: [13] as number[] };
const SUCCESSOR = 'u-successor';
const OWNER_ACTOR = {
  actor: { type: 'member' as const, userId: FOUNDER },
};

const CREATE_INPUT = {
  name: 'Night Shift',
  description: 'We animate after dark.',
  logo: 'https://cdn.example/logo.png',
  productionTemplateLocale: 'en-US' as const,
  productionKind: 'series' as const,
  genres: ['scifi'],
  styles: ['2d'],
  socialLinks: [],
  showcaseWorks: [],
};

interface SyncCall {
  crewId: string;
  userId: string;
  action: 'join' | 'leave';
  tx: unknown;
}

function build(
  opts: {
    /** Existing active membership rows, keyed by userId. */
    members?: Record<string, { id: string }>;
    ownerUserId?: string;
  } = {},
) {
  const members = opts.members ?? {};
  const ownerUserId = opts.ownerUserId ?? FOUNDER;
  const conversation = { id: CONVERSATION_ID };

  /** Everything toCrewDTO() dereferences. */
  const crewRow = {
    id: CREW_ID,
    name: CREATE_INPUT.name,
    description: CREATE_INPUT.description,
    logo: CREATE_INPUT.logo,
    tagline: null,
    genres: CREATE_INPUT.genres,
    styles: CREATE_INPUT.styles,
    socialLinks: null,
    showcaseWorks: null,
    createdByUserId: ownerUserId,
    listingStatus: 'listed',
    productionKind: 'series',
    studioWorkspaceId: null,
    listedAt: new Date('2026-07-01T00:00:00.000Z'),
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    version: 1,
    deletedAt: null,
    ownership: {
      crewId: CREW_ID,
      memberId: members[ownerUserId]?.id ?? 'm-founder',
      member: { userId: ownerUserId },
    },
  };

  const tx = {
    $queryRaw: jest.fn(),
    crew: {
      findFirst: jest.fn().mockResolvedValue(crewRow),
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        void args;
        return Promise.resolve(crewRow);
      }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue({ version: 2, deletedAt: null }),
      findUniqueOrThrow: jest.fn().mockResolvedValue(crewRow),
    },
    crewMember: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'm-created', ...data }),
      ),
      update: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn(({ where }: { where: { userId: string } }) =>
        Promise.resolve(members[where.userId] ?? null),
      ),
    },
    crewOwnership: {
      create: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue({
        crewId: CREW_ID,
        memberId: members[ownerUserId]?.id ?? 'm-founder',
        member: {
          id: members[ownerUserId]?.id ?? 'm-founder',
          userId: ownerUserId,
          positions: [],
        },
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    crewTaskWorkflowState: {
      createMany: jest.fn().mockResolvedValue({ count: 7 }),
    },
    crewTaskView: { create: jest.fn().mockResolvedValue({}) },
    crewEpisode: { create: jest.fn().mockResolvedValue({}) },
    crewAssetNode: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({}),
    },
    crewTask: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({}),
      createMany: jest.fn().mockResolvedValue({ count: 6 }),
    },
    crewTaskDependency: {
      createMany: jest.fn().mockResolvedValue({ count: 5 }),
    },
    crewTaskTimelineItem: {
      createMany: jest.fn().mockResolvedValue({ count: 6 }),
    },
    crewTaskKindTemplate: {
      count: jest.fn().mockResolvedValue(0),
      createMany: jest.fn().mockResolvedValue({ count: 10 }),
    },
    crewAuthorizationEvent: { create: jest.fn().mockResolvedValue({}) },
    $executeRaw: jest.fn().mockResolvedValue(0),
  };

  const prisma = {
    crew: {
      findFirst: jest.fn().mockResolvedValue({
        ownership: { member: { userId: ownerUserId } },
        deletedAt: null,
      }),
      findUnique: jest.fn().mockResolvedValue({ ...crewRow, version: 2 }),
    },
    crewMember: {
      findFirst: jest.fn(({ where }: { where: { userId: string } }) =>
        Promise.resolve(members[where.userId] ?? null),
      ),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    crewPosition: {
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue([]),
    },
    crewApplication: { count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn((cb: (client: unknown) => unknown) => cb(tx)),
  };

  const syncCalls: SyncCall[] = [];
  const systemCalls: Array<{ kind: string; params: unknown; tx: unknown }> = [];
  const conversations = {
    openCrewConversation: jest.fn().mockResolvedValue(conversation),
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
        _conversationId: string,
        kind: string,
        params: unknown,
        txArg: unknown,
      ) => {
        systemCalls.push({ kind, params, tx: txArg });
        return Promise.resolve({ id: `msg-${systemCalls.length}` });
      },
    ),
    broadcastMessage: jest.fn().mockResolvedValue(undefined),
  };
  const collaboration = {
    transferCrewOwnershipAccess: jest.fn().mockResolvedValue(undefined),
  };
  const authorization = {
    require: jest.fn().mockResolvedValue({
      crewId: CREW_ID,
      memberId: members[ownerUserId]?.id ?? 'm-founder',
      userId: ownerUserId,
      isOwner: true,
      permissions: ['ownership.transfer'],
      policyKeys: [],
    }),
    owner: jest.fn().mockResolvedValue({
      crewId: CREW_ID,
      memberId: members[ownerUserId]?.id ?? 'm-founder',
      userId: ownerUserId,
    }),
  };

  return {
    prisma,
    tx,
    conversations,
    syncCalls,
    systemCalls,
    collaboration,
    service: new CrewsService(
      prisma as never,
      conversations as never,
      authorization as never,
      collaboration as never,
      { ensureDefaultAccounts: jest.fn().mockResolvedValue([]) } as never,

      { revoke: jest.fn().mockResolvedValue(undefined) } as never,
    ),
  };
}

describe('CrewsService.create — the crew chat is born with the crew', () => {
  it('creates the localized production foundation without silently creating tasks', async () => {
    const t = build();

    await t.service.create(FOUNDER_USER, {
      ...CREATE_INPUT,
      productionTemplateLocale: 'zh-CN',
    } as never);

    const create = t.tx.crew.create.mock.calls[0]?.[0] as {
      data: {
        productionPage: { create: { document: unknown } };
        productionActivity: {
          create: { payload: Record<string, unknown> };
        };
      };
    };
    expect(
      JSON.stringify(create.data.productionPage.create.document),
    ).toContain('制作目标');
    expect(create.data.productionActivity.create.payload).toEqual({
      productionTemplateVersion: 4,
      productionTemplateLocale: 'zh-CN',
      productionKind: 'series',
      studioWorkspaceId: null,
    });
    expect(
      JSON.stringify(create.data.productionPage.create.document),
    ).toContain('tableHeader');
    expect(t.tx.crewTaskWorkflowState.createMany).toHaveBeenCalledTimes(1);
    expect(t.tx.crewTaskView.create).toHaveBeenCalledTimes(1);
    const episodeCreateMock = t.tx.crewEpisode.create as jest.MockedFunction<
      (args: {
        data: { crewId: string; number: number; title: string };
      }) => Promise<unknown>
    >;
    const episodeCreate = episodeCreateMock.mock.calls[0]?.[0];
    expect(episodeCreate?.data).toMatchObject({
      crewId: CREW_ID,
      number: 1,
      title: '第 1 集',
    });

    expect(t.tx.crewAssetNode.create).toHaveBeenCalled();
    expect(t.tx.crewTask.create).not.toHaveBeenCalled();
    expect(t.tx.crewTaskKindTemplate.createMany).toHaveBeenCalled();
  });

  it('starts an interactive-film crew without implicit production tasks', async () => {
    const t = build();
    await t.service.create(FOUNDER_USER, {
      ...CREATE_INPUT,
      productionKind: 'interactive_film',
    } as never);
    expect(t.tx.crewTask.create).not.toHaveBeenCalled();
    expect(t.tx.crewTask.createMany).not.toHaveBeenCalled();
    expect(t.tx.crewAssetNode.create).toHaveBeenCalled();
    expect(t.tx.crewTaskKindTemplate.createMany).toHaveBeenCalled();
  });

  it('still imports a canvas explicitly supplied while creating a crew', async () => {
    const seed = jest
      .spyOn(productionBootstrap, 'seedCrewProductionTasks')
      .mockResolvedValueOnce(undefined);
    try {
      const t = build();
      const plotTree = {
        title: 'Imported',
        description: '',
        startNodeId: 'end',
        nodes: [
          {
            id: 'end',
            type: 'ending',
            content: { title: 'End' },
            transitions: [],
          },
        ],
      };
      await t.service.create(FOUNDER_USER, {
        ...CREATE_INPUT,
        productionKind: 'interactive_film',
        plotTree,
      } as never);
      expect(seed).toHaveBeenCalledWith(
        t.tx,
        expect.objectContaining({ plotTree, kind: 'interactive_film' }),
      );
    } finally {
      seed.mockRestore();
    }
  });

  it('opens the crew conversation and joins the founder inside the create tx', async () => {
    const t = build();

    await t.service.create(FOUNDER_USER, CREATE_INPUT as never);

    expect(t.conversations.openCrewConversation).toHaveBeenCalledWith(
      CREW_ID,
      t.tx,
    );
    expect(t.syncCalls).toEqual([
      { crewId: CREW_ID, userId: FOUNDER, action: 'join', tx: t.tx },
    ]);
  });

  it('stays silent — the founder joining their own new empty chat is not an event', async () => {
    const t = build();

    await t.service.create(FOUNDER_USER, CREATE_INPUT as never);

    expect(t.systemCalls).toEqual([]);
  });

  it('rolls the crew back when the chat sync fails', async () => {
    const t = build();
    t.conversations.syncCrewParticipant.mockRejectedValueOnce(
      new Error('redis is on fire'),
    );
    // The real $transaction propagates the rejection and rolls back; the
    // mock just has to let the error escape for that to be provable.
    t.prisma.$transaction.mockImplementationOnce(
      async (cb: (client: unknown) => Promise<unknown>) => cb(t.tx),
    );

    await expect(
      t.service.create(FOUNDER_USER, CREATE_INPUT as never),
    ).rejects.toThrow('redis is on fire');
  });
});

describe('CrewsService.transferOwnership — which branch moves the chat', () => {
  it('moves ownership without mutating the outgoing owner membership', async () => {
    const t = build({
      members: {
        [FOUNDER]: { id: 'm-founder' },
        [SUCCESSOR]: { id: 'm-succ' },
      },
    });

    await t.service.transferOwnership(CREW_ID, SUCCESSOR, OWNER_ACTOR);

    expect(t.tx.crewOwnership.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { crewId: CREW_ID } }),
    );
    expect(t.tx.crewMember.update).not.toHaveBeenCalled();
    expect(t.syncCalls).toEqual([]);
    expect(t.systemCalls).toEqual([]);
  });

  it('removing the outgoing owner takes them out of the chat and announces it', async () => {
    const t = build({
      members: {
        [FOUNDER]: { id: 'm-founder' },
        [SUCCESSOR]: { id: 'm-succ' },
      },
    });

    await t.service.transferOwnership(CREW_ID, SUCCESSOR, {
      ...OWNER_ACTOR,
      removeOldOwner: true,
    });

    expect(t.syncCalls).toEqual([
      { crewId: CREW_ID, userId: FOUNDER, action: 'leave', tx: t.tx },
    ]);
    expect(t.systemCalls).toEqual([
      {
        kind: 'crew.member.left',
        params: { userId: FOUNDER },
        tx: t.tx,
      },
    ]);
  });

  it('promoting an existing member to owner touches nothing — they are already in the chat', async () => {
    const t = build({
      members: {
        [FOUNDER]: { id: 'm-founder' },
        [SUCCESSOR]: { id: 'm-succ' },
      },
    });

    await t.service.transferOwnership(CREW_ID, SUCCESSOR, OWNER_ACTOR);

    expect(t.syncCalls.filter((c) => c.userId === SUCCESSOR)).toEqual([]);
  });

  it('handing the crew to an outsider joins them to the chat', async () => {
    const t = build({ members: { [FOUNDER]: { id: 'm-founder' } } });

    await t.service.transferOwnership(CREW_ID, SUCCESSOR, OWNER_ACTOR);

    expect(t.syncCalls).toEqual([
      { crewId: CREW_ID, userId: SUCCESSOR, action: 'join', tx: t.tx },
    ]);
    expect(t.systemCalls).toEqual([
      {
        kind: 'crew.member.joined',
        params: { userId: SUCCESSOR },
        tx: t.tx,
      },
    ]);
  });

  it('broadcasts only after the transfer transaction has committed', async () => {
    const order: string[] = [];
    const t = build({ members: { [FOUNDER]: { id: 'm-founder' } } });
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

    await t.service.transferOwnership(CREW_ID, SUCCESSOR, OWNER_ACTOR);

    expect(order).toEqual(['commit', 'broadcast']);
  });

  it('moves the collaboration ownership graph inside the crew transaction', async () => {
    const t = build({
      members: {
        [FOUNDER]: { id: 'm-founder' },
        [SUCCESSOR]: { id: 'm-succ' },
      },
    });

    await t.service.transferOwnership(CREW_ID, SUCCESSOR, OWNER_ACTOR);

    expect(t.collaboration.transferCrewOwnershipAccess).toHaveBeenCalledWith(
      CREW_ID,
      FOUNDER,
      SUCCESSOR,
      false,
      t.tx,
    );
  });

  it('revokes the outgoing owner collaboration access when they leave', async () => {
    const t = build({
      members: {
        [FOUNDER]: { id: 'm-founder' },
        [SUCCESSOR]: { id: 'm-succ' },
      },
    });

    await t.service.transferOwnership(CREW_ID, SUCCESSOR, {
      ...OWNER_ACTOR,
      removeOldOwner: true,
    });

    expect(t.collaboration.transferCrewOwnershipAccess).toHaveBeenCalledWith(
      CREW_ID,
      FOUNDER,
      SUCCESSOR,
      true,
      t.tx,
    );
  });
});

describe('Crew create level gate', () => {
  it('allows authenticated creation without producer qualification', async () => {
    const t = build();
    expect(
      t.service.creationEligibility({ userId: FOUNDER, levelIds: [] }),
    ).toEqual({ eligible: true });
    await t.service.create(
      { userId: FOUNDER, levelIds: [] },
      CREATE_INPUT as never,
    );
    expect(t.tx.crew.create).toHaveBeenCalled();
  });
  it('allows creation when level 13 is present', async () => {
    const t = build();
    await t.service.create(FOUNDER_USER, CREATE_INPUT as never);
    expect(t.tx.crew.create).toHaveBeenCalled();
  });
});
