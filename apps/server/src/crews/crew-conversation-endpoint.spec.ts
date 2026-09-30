/**
 * `GET /aurora/crews/:id/conversation` — the crew workspace's chat panel
 * resolves its thread here (apps/web .../_hooks/use-crew-conversation.ts).
 *
 * Three separable claims, and the route's existence is the first of them:
 * a controller that never declared the path is indistinguishable, from the
 * browser, from a controller whose handler throws — both are a chat tab
 * that never loads. So the route table is asserted directly, not inferred
 * from a service call.
 *
 * Then the gate (outsiders get 404, never 403; a soft-deleted crew is a
 * 404 for its owner; ownership never bypasses canonical membership), and
 * then the resolve (a crew created before crew
 * chat existed has no `crew:<id>` row, and must still get one).
 *
 * Every Prisma mock here HONOURS its `where` clause. A mock that answers
 * `null` no matter what is asked keeps passing when the filter it is
 * standing in for is deleted, which makes it worse than no test.
 */
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { NotFoundException, RequestMethod } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../auth/auth.decorator';
import { CrewsController } from './crews.controller';
import { CrewsService } from './crews.service';

const CREW_ID = 'crew-1';
const CONVERSATION_ID = 'conv-crew-1';
const FOUNDER = 'u-founder';
const MEMBER = 'u-member';
const OTHER_MEMBER = 'u-member-2';
const OUTSIDER = 'u-outsider';

const AT = new Date('2026-07-28T10:00:00.000Z');

interface World {
  /** `null` = the crew has no conversation row yet (predates crew chat). */
  conversationId: string | null;
  /** Active `conversation_participants` rows (leftAt IS NULL). */
  participants: Set<string>;
  /** Active `crew_members` rows, including the owner membership. */
  crewMembers: Set<string>;
  crewDeletedAt: Date | null;
  ownerUserId: string;
}

function build(over: Partial<World> = {}) {
  const world: World = {
    conversationId: CONVERSATION_ID,
    participants: new Set([FOUNDER, MEMBER, OTHER_MEMBER]),
    crewMembers: new Set([FOUNDER, MEMBER, OTHER_MEMBER]),
    crewDeletedAt: null,
    ownerUserId: FOUNDER,
    ...over,
  };

  /** Matches `where: { id, deletedAt: null }` the way Postgres would. */
  const crewFor = (where: { id: string; deletedAt?: Date | null }) => {
    if (where.id !== CREW_ID) return null;
    if (where.deletedAt === null && world.crewDeletedAt !== null) return null;
    return {
      id: CREW_ID,
      ownership: { member: { userId: world.ownerUserId } },
    };
  };

  const delegates = {
    crew: {
      findFirst: jest.fn(
        ({ where }: { where: { id: string; deletedAt?: Date | null } }) =>
          Promise.resolve(crewFor(where)),
      ),
      findUnique: jest.fn(),
    },
    crewMember: {
      findFirst: jest.fn(
        ({ where }: { where: { userId: string; status?: string } }) =>
          Promise.resolve(
            world.crewMembers.has(where.userId)
              ? { id: `cm-${where.userId}` }
              : null,
          ),
      ),
      findMany: jest.fn(() =>
        Promise.resolve([...world.crewMembers].map((userId) => ({ userId }))),
      ),
    },
    conversation: {
      findUnique: jest.fn(
        ({
          where,
          select,
        }: {
          where: { lookupKey?: string };
          select?: { participants?: { where: { userId: string } } };
        }) => {
          if (where.lookupKey !== `crew:${CREW_ID}`)
            return Promise.resolve(null);
          if (world.conversationId === null) return Promise.resolve(null);
          const viewerId = select?.participants?.where.userId;
          return Promise.resolve({
            id: world.conversationId,
            participants:
              viewerId !== undefined && world.participants.has(viewerId)
                ? [{ userId: viewerId }]
                : [],
          });
        },
      ),
    },
  };
  const tx = { ...delegates };
  const prisma = {
    ...delegates,
    $transaction: jest.fn((cb: (client: unknown) => unknown) => cb(tx)),
  };

  const joined: string[] = [];
  const conversations = {
    openCrewConversation: jest.fn(() => {
      world.conversationId ??= CONVERSATION_ID;
      return Promise.resolve({ id: world.conversationId });
    }),
    syncCrewParticipant: jest.fn(
      (_crewId: string, userId: string, action: 'join' | 'leave') => {
        if (action === 'join') {
          joined.push(userId);
          world.participants.add(userId);
        }
        return Promise.resolve();
      },
    ),
    detail: jest.fn((conversationId: string) =>
      Promise.resolve({
        id: conversationId,
        contextType: 'crew',
        contextId: CREW_ID,
        lookupKey: `crew:${CREW_ID}`,
        lastMessageAt: AT,
        createdAt: AT,
        participants: [...world.participants].map((userId) => ({
          conversationId,
          userId,
          role: 'member',
          lastReadMessageId: null,
          lastReadAt: null,
          mutedUntil: null,
          joinedAt: AT,
          leftAt: null,
        })),
        _unreadCount: 3,
        _lastMessage: null,
      }),
    ),
  };

  const service = new CrewsService(
    prisma as never,
    conversations as never,
    {
      resolve: jest.fn((_: string, userId: string) => {
        if (world.crewDeletedAt || !world.crewMembers.has(userId)) {
          return Promise.resolve(null);
        }
        return Promise.resolve({ userId, permissions: ['members.view'] });
      }),
    } as never,
    {
      transferCrewOwnershipAccess: jest.fn().mockResolvedValue(undefined),
    } as never,
    { ensureDefaultAccounts: jest.fn().mockResolvedValue([]) } as never,

    { revoke: jest.fn().mockResolvedValue(undefined) } as never,
  );
  return { world, prisma, delegates, conversations, joined, service };
}

/** Every `@Get`/`@Post`/… handler declared on a controller class. */
function routeTable(controller: new (...args: never[]) => unknown) {
  const proto = controller.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(proto)
    .filter((key) => key !== 'constructor')
    .flatMap((key) => {
      const handler = proto[key];
      if (typeof handler !== 'function') return [];
      const path = Reflect.getMetadata(PATH_METADATA, handler) as
        | string
        | undefined;
      if (path === undefined) return [];
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as number;
      return [{ key, path, method }];
    });
}

describe('CrewsController route table', () => {
  it('serves GET :id/conversation — the path the crew chat hook calls', () => {
    // `use-crew-conversation.ts` fetches
    // `/aurora/crews/{crewId}/conversation`. Nest's `:id` cannot span a
    // slash, so nothing else in this controller can answer it.
    expect(routeTable(CrewsController)).toEqual(
      expect.arrayContaining([
        {
          key: 'conversation',
          path: ':id/conversation',
          method: RequestMethod.GET,
        },
      ]),
    );
  });

  it('keeps it authenticated — a crew page is public, its chat is not', () => {
    const handler = (
      CrewsController.prototype as unknown as Record<string, unknown>
    ).conversation as object;
    // `@Public()` is what opts a route out of the global auth guard.
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBeUndefined();
    // …and the sibling detail route still is public, so this is a real
    // difference and not a decorator that stopped working.
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        (CrewsController.prototype as unknown as Record<string, unknown>)
          .detail as object,
      ),
    ).toBe(true);
  });

  it('rejects a malformed crew id before touching the service', () => {
    const svc = { conversation: jest.fn() };
    const controller = new CrewsController(
      svc as never,
      {} as never,
      {} as never,
    );

    expect(() =>
      controller.conversation('../../etc', { userId: MEMBER } as never),
    ).toThrow(/Invalid id/);
    expect(svc.conversation).not.toHaveBeenCalled();
  });

  it('passes the caller through as the viewer', () => {
    const svc = { conversation: jest.fn().mockResolvedValue({}) };
    const controller = new CrewsController(
      svc as never,
      {} as never,
      {} as never,
    );

    void controller.conversation(CREW_ID, { userId: MEMBER } as never);

    expect(svc.conversation).toHaveBeenCalledWith(CREW_ID, MEMBER);
  });
});

describe('CrewsService.conversation — the gate', () => {
  it('404s an outsider instead of 403 — the thread must not be probeable', async () => {
    const t = build();

    // Not 403: `assertParticipant` and the crew gate inside
    // ConversationsService both refuse to confirm a thread exists, and
    // this is the front door to them. The crew authorization resolver
    // returns null here so the route preserves the non-probeable 404.
    const err: unknown = await t.service
      .conversation(CREW_ID, OUTSIDER)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NotFoundException);
    expect((err as NotFoundException).getStatus()).toBe(404);
    expect(t.conversations.detail).not.toHaveBeenCalled();
  });

  it('404s the owner once the crew is soft-deleted', async () => {
    const t = build({ crewDeletedAt: AT });

    await expect(t.service.conversation(CREW_ID, FOUNDER)).rejects.toThrow(
      NotFoundException,
    );
    expect(t.conversations.detail).not.toHaveBeenCalled();
  });

  it('404s an unknown crew id', async () => {
    const t = build();

    await expect(t.service.conversation('crew-nope', FOUNDER)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('revokes owner chat access when the canonical membership is absent', async () => {
    const t = build({ crewMembers: new Set([MEMBER]) });

    await expect(t.service.conversation(CREW_ID, FOUNDER)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('admits an ordinary active member', async () => {
    const t = build();

    await expect(
      t.service.conversation(CREW_ID, MEMBER),
    ).resolves.toMatchObject({ id: CONVERSATION_ID });
  });
});

describe('CrewsService.conversation — resolving the thread', () => {
  it('opens the chat for a crew founded before crew chat existed', async () => {
    const t = build({ conversationId: null, participants: new Set() });

    await expect(
      t.service.conversation(CREW_ID, FOUNDER),
    ).resolves.toMatchObject({ id: CONVERSATION_ID, contextType: 'crew' });
    expect(t.conversations.openCrewConversation).toHaveBeenCalledWith(
      CREW_ID,
      expect.anything(),
    );
  });

  it('projects the WHOLE active roster on that first open, owner included', async () => {
    const t = build({ conversationId: null, participants: new Set() });

    await t.service.conversation(CREW_ID, MEMBER);

    // Not just the caller: a chat only the opener can be broadcast to is
    // not the crew's chat.
    expect([...t.joined].sort()).toEqual(
      [FOUNDER, MEMBER, OTHER_MEMBER].sort(),
    );
  });

  it('opens and projects inside ONE transaction', async () => {
    const t = build({ conversationId: null, participants: new Set() });

    await t.service.conversation(CREW_ID, FOUNDER);

    expect(t.prisma.$transaction).toHaveBeenCalledTimes(1);
    // Every sync rides the same tx client the open ran on — a partial
    // projection must roll back with the conversation that owns it.
    const txClient = (
      t.conversations.openCrewConversation.mock.calls as unknown[][]
    )[0][1];
    for (const call of t.conversations.syncCrewParticipant.mock
      .calls as unknown[][]) {
      expect(call[3]).toBe(txClient);
    }
  });

  it('heals a member whose participant row was never projected', async () => {
    // Conversation exists, but this member is missing from it — a sync
    // that was dropped, or a crew that grew before the chat did.
    const t = build({ participants: new Set([FOUNDER]) });

    await t.service.conversation(CREW_ID, MEMBER);

    expect(t.joined).toContain(MEMBER);
  });

  it('writes nothing when the caller is already an active participant', async () => {
    const t = build();

    await t.service.conversation(CREW_ID, MEMBER);

    expect(t.prisma.$transaction).not.toHaveBeenCalled();
    expect(t.conversations.openCrewConversation).not.toHaveBeenCalled();
    expect(t.conversations.syncCrewParticipant).not.toHaveBeenCalled();
  });

  it('returns the same ConversationDTO shape /aurora/conversations/:id serves', async () => {
    const t = build();

    const dto = await t.service.conversation(CREW_ID, MEMBER);

    expect(dto).toMatchObject({
      id: CONVERSATION_ID,
      contextType: 'crew',
      contextId: CREW_ID,
      lastMessage: null,
      lastMessageAt: AT.toISOString(),
      unreadCount: 3,
      createdAt: AT.toISOString(),
    });
    expect(dto.participants).toEqual(
      expect.arrayContaining([
        { userId: MEMBER, role: 'member', lastReadMessageId: null },
      ]),
    );
  });

  it('re-reads through the conversations service so its own crew gate runs last', async () => {
    const t = build();

    await t.service.conversation(CREW_ID, MEMBER);

    expect(t.conversations.detail).toHaveBeenCalledWith(
      CONVERSATION_ID,
      MEMBER,
    );
  });
});
