/**
 * Inbox display lookup — `loadCrewCardContexts`.
 *
 * The rows come from `ConversationsService.listInbox`, which already
 * drops crew rows the viewer has lost access to. This is the second
 * layer: the query that turns a crew id into the NAME, LOGO and MEMBER
 * COUNT a row renders. It read `crew.findMany` with no `deletedAt`
 * filter, so a soft-deleted crew came back fully dressed — a named,
 * previewed row whose thread 404s the moment it is clicked.
 *
 * The Prisma double here APPLIES the `where` it is handed. A stub that
 * answers the same rows whatever it is asked would keep passing with
 * the filter deleted, which is the failure mode this file exists to
 * avoid.
 */
import { ConversationsController } from './conversations.controller';

const VIEWER = 'u-viewer';
const LIVE_CREW = 'crew-live';
const DEAD_CREW = 'crew-deleted';
const AT = new Date('2026-07-28T10:00:00.000Z');

function crewRow(id: string) {
  return {
    id: `conv-${id}`,
    contextType: 'crew',
    contextId: id,
    lookupKey: `crew:${id}`,
    lastMessageAt: AT,
    createdAt: AT,
    participants: [
      {
        conversationId: `conv-${id}`,
        userId: VIEWER,
        role: 'member',
        lastReadMessageId: null,
        lastReadAt: null,
        mutedUntil: null,
        joinedAt: AT,
        leftAt: null,
      },
    ],
    _unreadCount: 0,
    _lastMessage: null,
  };
}

function build(items: ReturnType<typeof crewRow>[]) {
  /** Crews as they exist in the database, `deletedAt` and all. */
  const crews = [
    { id: LIVE_CREW, name: 'Night Shift', logo: 'live.png', deletedAt: null },
    {
      id: DEAD_CREW,
      name: 'Disbanded',
      logo: 'dead.png',
      deletedAt: new Date('2026-07-20T00:00:00.000Z'),
    },
  ];

  const prisma = {
    crew: {
      findMany: jest.fn(
        ({
          where,
        }: {
          where: { id: { in: string[] }; deletedAt?: Date | null };
        }) =>
          Promise.resolve(
            crews
              .filter((c) => where.id.in.includes(c.id))
              .filter(
                (c) => !(where.deletedAt === null && c.deletedAt !== null),
              )
              .map((c) => ({ id: c.id, name: c.name, logo: c.logo })),
          ),
      ),
    },
    crewMember: {
      groupBy: jest.fn().mockResolvedValue([
        { crewId: LIVE_CREW, _count: { _all: 4 } },
        { crewId: DEAD_CREW, _count: { _all: 7 } },
      ]),
    },
  };
  const svc = {
    listInbox: jest.fn().mockResolvedValue({ items, nextCursor: null }),
  };
  const realtime = {
    issueUserGrant: jest.fn(),
    issueCrewGrant: jest.fn(),
  };
  return {
    prisma,
    svc,
    realtime,
    controller: new ConversationsController(
      svc as never,
      prisma as never,
      realtime as never,
    ),
  };
}

describe('inbox crew card context', () => {
  it('names and counts a live crew', async () => {
    const t = build([crewRow(LIVE_CREW)]);

    const { items } = await t.controller.listInbox(
      { userId: VIEWER } as never,
      {
        limit: 24,
      } as never,
    );

    expect(items[0]).toMatchObject({
      crewId: LIVE_CREW,
      crewName: 'Night Shift',
      crewLogo: 'live.png',
      memberCount: 4,
    });
  });

  it('refuses to dress a soft-deleted crew, whatever put its row on the page', async () => {
    const t = build([crewRow(DEAD_CREW)]);

    const { items } = await t.controller.listInbox(
      { userId: VIEWER } as never,
      {
        limit: 24,
      } as never,
    );

    // The row still resolves to a usable identity (the mapper's
    // crew-metadata-unavailable branch) — it just cannot advertise a
    // crew that no longer exists.
    expect(items[0].crewId).toBe(DEAD_CREW);
    expect(items[0].crewName).toBeUndefined();
    expect(items[0].crewLogo).toBeUndefined();
    expect(items[0].memberCount).toBeUndefined();
  });

  it('keeps the live crews on a mixed page', async () => {
    const t = build([crewRow(LIVE_CREW), crewRow(DEAD_CREW)]);

    const { items } = await t.controller.listInbox(
      { userId: VIEWER } as never,
      {
        limit: 24,
      } as never,
    );

    expect(items.map((i) => i.crewName)).toEqual(['Night Shift', undefined]);
    // Still one batched query for the page, not one per row.
    expect(t.prisma.crew.findMany).toHaveBeenCalledTimes(1);
  });
});
