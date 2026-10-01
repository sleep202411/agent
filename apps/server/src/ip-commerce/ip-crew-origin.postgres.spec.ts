import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../infra/db/db.module';
import { CrewAuthorizationService } from '../crews/crew-authorization.service';
import { ConversationsService } from '../conversations/conversations.service';
import { IpCommerceService } from './ip-commerce.service';
import { IpCrewOriginService } from './ip-crew-origin';
import { CrewsService } from '../crews/crews.service';
const databaseUrl =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.IP_ORIGIN_POSTGRES_TEST === '1'
    ? process.env.DATABASE_URL
    : undefined);
const integration = databaseUrl ? describe : describe.skip;
integration('Originating Crew and IP likes (local PostgreSQL)', () => {
  let db: PrismaClient;
  let ips: IpCommerceService;
  let origins: IpCrewOriginService;
  let conversations: ConversationsService;
  let ipId: string;
  let crewId: string;
  let owner: string;
  const crewService = () =>
    new CrewsService(
      db as never,
      conversations,
      new CrewAuthorizationService(db as never),
      {} as never,
      { ensureDefaultAccounts: jest.fn().mockResolvedValue([]) } as never,

      { revoke: jest.fn().mockResolvedValue(undefined) } as never,
    );
  beforeAll(async () => {
    const url = postgresFixtureUrl(databaseUrl!);
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !(
        (url.port === '5433' && url.pathname === '/fizzdragon_outbox_test') ||
        (url.port === '55439' && url.pathname === '/task01')
      )
    )
      throw new Error('Explicitly allowed loopback test database required');
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl }),
      transactionOptions: { timeout: 15000 },
    });
    await db.$connect();
    conversations = new ConversationsService(
      db as never,
      {} as never,
      {} as never,
    );
    ips = new IpCommerceService(
      db as PrismaService,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      conversations,
    );
    origins = new IpCrewOriginService(
      db as PrismaService,
      ips,
      new CrewAuthorizationService(db as PrismaService),
    );
  });
  beforeEach(async () => {
    owner = `origin-owner-${randomUUID()}`;
    crewId = `origin-${randomUUID()}`;
    await db.crew.create({
      data: {
        id: crewId,
        name: 'Origin Crew',
        description: '',
        logo: 'test.png',
        createdByUserId: owner,
        listingStatus: 'listed',
      },
    });
    const member = await db.crewMember.create({
      data: { id: randomUUID(), crewId, userId: owner, joinedVia: 'creation' },
    });
    await db.crewOwnership.create({ data: { crewId, memberId: member.id } });
    const ip = await db.ip.create({
      data: {
        createdById: owner,
        status: 'published',
        listingVisibility: 'public',
        localizations: {
          create: {
            locale: 'en-US',
            title: 'Origin',
            summary: 'Origin',
            status: 'published',
          },
        },
      },
    });
    ipId = ip.id;
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await db.ip.delete({ where: { id: ipId } });
    // Retain Crew conversation fixtures; soft deletion respects the domain's history.
    await db.crew.update({
      where: { id: crewId },
      data: { deletedAt: new Date() },
    });
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  it.each(['en-US', 'zh-CN', 'zh-HK'] as const)(
    'automatically creates one unlisted owned Crew for a new %s IP',
    async (sourceLocale) => {
      const genre = await db.ipTaxonomyTerm.findFirstOrThrow({
        where: { type: 'genre', status: 'active', archivedAt: null },
      });
      const result = await ips.createCreatorIp(
        { userId: owner, levelIds: [13] },
        {
          title: 'Auto Crew IP',
          channelType: 'ip' as const,
          sourceLocale,
          genreCodes: [genre.code],
          tagCodes: [],
        },
      );
      try {
        const linked = await origins.own(result.ip.id, { userId: owner });
        expect(linked.crewId).toBeTruthy();
        expect(linked.crewId).not.toBe(crewId);
        const crew = await db.crew.findUniqueOrThrow({
          where: { id: linked.crewId! },
          include: { ownership: { include: { member: true } } },
        });
        expect(crew.studioWorkspaceId).toBeTruthy();
        expect(
          await db.workspaceMember.findFirst({
            where: {
              workspaceId: crew.studioWorkspaceId!,
              userId: owner,
              role: 'owner',
              status: 'active',
            },
          }),
        ).not.toBeNull();
        expect(crew.productionKind).toBe('series');
        expect(crew.listingStatus).toBe('unlisted');
        expect(crew.listedAt).toBeNull();
        expect(crew.ownership?.member.userId).toBe(owner);
        expect(
          await db.crewTaskWorkflowState.count({ where: { crewId: crew.id } }),
        ).toBeGreaterThan(0);
        expect(
          await db.conversationParticipant.count({
            where: { userId: owner, leftAt: null },
          }),
        ).toBe(1);
        await db.ip.update({
          where: { id: result.ip.id },
          data: {
            status: 'published',
            listingVisibility: 'public',
            localizations: {
              updateMany: { where: {}, data: { status: 'published' } },
            },
          },
        });
        expect((await origins.publicOrigin(result.ip.id)).crew).toBeNull();
        await db.crew.update({
          where: { id: crew.id },
          data: { listingStatus: 'listed', listedAt: new Date() },
        });
        expect((await origins.publicOrigin(result.ip.id)).crew?.id).toBe(
          crew.id,
        );
        expect(
          (await origins.own(result.ip.id, { userId: owner })).crewId,
        ).toBe(crew.id);
      } finally {
        await db.ip.delete({ where: { id: result.ip.id } });
        await db.crew.updateMany({
          where: { createdByUserId: owner },
          data: { deletedAt: new Date() },
        });
      }
    },
  );
  it('creates one project for concurrent retries and rejects changed or deleted requests', async () => {
    const genre = await db.ipTaxonomyTerm.findFirstOrThrow({
      where: { type: 'genre', status: 'active', archivedAt: null },
    });
    const input = {
      title: 'Retry-safe project',
      channelType: 'ip' as const,
      sourceLocale: 'en-US' as const,
      genreCodes: [genre.code],
      tagCodes: [],
      idempotencyKey: randomUUID(),
    };
    const user = { userId: owner, levelIds: [13] };
    const [first, retry] = await Promise.all([
      ips.createCreatorIp(user, input),
      ips.createCreatorIp(user, input),
    ]);
    try {
      expect(retry.ip.id).toBe(first.ip.id);
      expect(await db.crew.count({ where: { createdByUserId: owner } })).toBe(
        2,
      );
      expect(await db.workspace.count({ where: { createdById: owner } })).toBe(
        1,
      );
      await expect(
        ips.createCreatorIp(user, { ...input, title: 'Changed scope' }),
      ).rejects.toThrow('different inputs');
      await db.ip.update({
        where: { id: first.ip.id },
        data: { deletedAt: new Date() },
      });
      await expect(ips.createCreatorIp(user, input)).rejects.toThrow('deleted');
      expect(await db.ip.count({ where: { createdById: owner } })).toBe(2);
    } finally {
      await db.ip.delete({ where: { id: first.ip.id } });
      await db.crew.updateMany({
        where: { createdByUserId: owner },
        data: { deletedAt: new Date() },
      });
    }
  });
  it('scopes creation request keys to their creator', async () => {
    const genre = await db.ipTaxonomyTerm.findFirstOrThrow({
      where: { type: 'genre', status: 'active', archivedAt: null },
    });
    const input = {
      title: 'Separate creators',
      channelType: 'ip' as const,
      sourceLocale: 'en-US' as const,
      genreCodes: [genre.code],
      tagCodes: [],
      idempotencyKey: randomUUID(),
    };
    const [a, b] = await Promise.all([
      ips.createCreatorIp({ userId: owner, levelIds: [] }, input),
      ips.createCreatorIp({ userId: `other-${owner}`, levelIds: [] }, input),
    ]);
    expect(a.ip.id).not.toBe(b.ip.id);
    await db.ip.deleteMany({ where: { id: { in: [a.ip.id, b.ip.id] } } });
  });
  it('uses the selected interactive production type and an authorized existing workspace', async () => {
    const genre = await db.ipTaxonomyTerm.findFirstOrThrow({
      where: { type: 'genre', status: 'active', archivedAt: null },
    });
    const workspace = await db.workspace.create({
      data: {
        name: 'Interactive project',
        ownerUserId: owner,
        createdById: owner,
        members: { create: { userId: owner, role: 'owner' } },
      },
    });
    const result = await ips.createCreatorIp(
      { userId: owner, levelIds: [13] },
      {
        title: 'Interactive IP',
        channelType: 'ip' as const,
        sourceLocale: 'en-US',
        genreCodes: [genre.code],
        tagCodes: [],
        productionKind: 'interactive_film',
        studioWorkspaceId: workspace.id,
      },
    );
    const linked = await origins.own(result.ip.id, { userId: owner });
    const crew = await db.crew.findUniqueOrThrow({
      where: { id: linked.crewId! },
    });
    expect(crew.productionKind).toBe('interactive_film');
    expect(crew.studioWorkspaceId).toBe(workspace.id);
    // Crew creation establishes ownership and the selected workspace; tasks
    // are created only after explicit confirmation in the workbench.
    expect(await db.crewTask.count({ where: { crewId: crew.id } })).toBe(0);
    await db.ip.delete({ where: { id: result.ip.id } });
    await db.crew.update({
      where: { id: crew.id },
      data: { deletedAt: new Date() },
    });
  });
  it('rolls back the IP when its requested workspace is not authorized', async () => {
    const genre = await db.ipTaxonomyTerm.findFirstOrThrow({
      where: { type: 'genre', status: 'active', archivedAt: null },
    });
    const workspace = await db.workspace.create({
      data: { name: 'Private', ownerUserId: 'other', createdById: 'other' },
    });
    const before = await db.ip.count({ where: { createdById: owner } });
    await expect(
      ips.createCreatorIp(
        { userId: owner, levelIds: [13] },
        {
          title: 'Unauthorized setup',
          channelType: 'ip' as const,
          sourceLocale: 'en-US',
          genreCodes: [genre.code],
          tagCodes: [],
          studioWorkspaceId: workspace.id,
        },
      ),
    ).rejects.toThrow('Workspace not found');
    expect(await db.ip.count({ where: { createdById: owner } })).toBe(before);
    await db.workspace.delete({ where: { id: workspace.id } });
  });
  it('keeps uncertified IP creation without granting Crew creation', async () => {
    const genre = await db.ipTaxonomyTerm.findFirstOrThrow({
      where: { type: 'genre', status: 'active', archivedAt: null },
    });
    const result = await ips.createCreatorIp(
      { userId: owner, levelIds: [] },
      {
        title: 'No auto Crew',
        channelType: 'ip' as const,
        sourceLocale: 'en-US',
        genreCodes: [genre.code],
        tagCodes: [],
      },
    );
    try {
      expect(
        (await origins.own(result.ip.id, { userId: owner })).crewId,
      ).toBeNull();
      expect(await db.crew.count({ where: { createdByUserId: owner } })).toBe(
        1,
      );
    } finally {
      await db.ip.delete({ where: { id: result.ip.id } });
    }
  });
  it('rolls back automatic IP, Crew and membership creation when chat fails', async () => {
    jest
      .spyOn(conversations, 'syncCrewParticipant')
      .mockRejectedValueOnce(new Error('chat failed'));
    await expect(
      ips.createCreatorIp(
        { userId: owner, levelIds: [13] },
        {
          title: 'Failing creation',
          channelType: 'ip' as const,
          sourceLocale: 'en-US',
          genreCodes: [],
          tagCodes: [],
        },
      ),
    ).rejects.toThrow('chat failed');
    expect(await db.ip.count({ where: { createdById: owner } })).toBe(1);
    expect(await db.crew.count({ where: { createdByUserId: owner } })).toBe(1);
    expect(await db.crewMember.count({ where: { userId: owner } })).toBe(1);
  });
  it('keeps joined fan communities discoverable across reads without production membership', async () => {
    const fan = `discovery-${randomUUID()}`;
    expect((await crewService().myCrews(fan)).community).toEqual([]);
    await Promise.all([
      crewService().joinFanCommunity(crewId, fan),
      crewService().joinFanCommunity(crewId, fan),
    ]);
    for (let read = 0; read < 2; read++) {
      const result = await crewService().myCrews(fan);
      expect(result.founded).toEqual([]);
      expect(result.joined).toEqual([]);
      expect(result.community.map((crew) => crew.id)).toEqual([crewId]);
    }
    expect(
      (await crewService().myCrews(`other-${randomUUID()}`)).community,
    ).toEqual([]);
    expect(await db.crewMember.count({ where: { crewId, userId: fan } })).toBe(
      0,
    );
    await expect(crewService().conversation(crewId, fan)).rejects.toThrow();
    await db.conversationParticipant.updateMany({
      where: { userId: fan },
      data: { leftAt: new Date() },
    });
    expect((await crewService().myCrews(fan)).community).toEqual([]);
  });
  it('deduplicates production members and hides deleted, moderated or blocked fan Crews', async () => {
    await crewService().joinFanCommunity(crewId, owner);
    expect(
      (await crewService().myCrews(owner)).founded.map((crew) => crew.id),
    ).toEqual([crewId]);
    expect((await crewService().myCrews(owner)).community).toEqual([]);
    const fan = `visibility-${randomUUID()}`;
    await crewService().joinFanCommunity(crewId, fan);
    await db.crew.update({
      where: { id: crewId },
      data: { deletedAt: new Date() },
    });
    expect((await crewService().myCrews(fan)).community).toEqual([]);
    await db.crew.update({ where: { id: crewId }, data: { deletedAt: null } });
    await db.crew.update({
      where: { id: crewId },
      data: { moderationStatus: 'taken_down' },
    });
    expect((await crewService().myCrews(fan)).community).toEqual([]);
    await db.crew.update({
      where: { id: crewId },
      data: { moderationStatus: 'ok' },
    });
    await db.ipUserContentBlock.create({
      data: { userId: fan, targetType: 'crew', targetId: crewId },
    });
    expect((await crewService().myCrews(fan)).community).toEqual([]);
  });
  it('requires authority over both records and rejects a stale change', async () => {
    const foreign = { userId: 'foreign-origin-editor' };
    await db.ipAclGrant.create({
      data: {
        ipId,
        userId: foreign.userId,
        permission: 'edit',
        grantedById: owner,
      },
    });
    await expect(
      origins.save(ipId, foreign, { crewId, expectedVersion: 0 }),
    ).rejects.toMatchObject({ response: { code: 'CREW_MEMBERSHIP_REQUIRED' } });
    expect((await origins.own(ipId, { userId: owner })).crewId).toBeNull();
    const saved = await origins.save(
      ipId,
      { userId: owner },
      { crewId, expectedVersion: 0 },
    );
    expect(saved.crewId).toBe(crewId);
    expect(saved.choices).toEqual([{ id: crewId, name: 'Origin Crew' }]);
    await expect(
      origins.save(
        ipId,
        { userId: owner },
        { crewId: null, expectedVersion: 0 },
      ),
    ).rejects.toThrow('updated elsewhere');
  });
  it('likes and joins once without granting production membership or creating a Crew like', async () => {
    await origins.save(ipId, { userId: owner }, { crewId, expectedVersion: 0 });
    const fan = { userId: `fan-${randomUUID()}` };
    const [a, b] = await Promise.all([
      ips.likeIp(fan, ipId),
      ips.likeIp(fan, ipId),
    ]);
    expect(a.conversationId).toBeTruthy();
    expect(a.conversationId).toBe(b.conversationId);
    expect(a.engagement.likeCount).toBe(1);
    expect(b.engagement.likeCount).toBe(1);
    expect(await db.ipLike.count({ where: { ipId, userId: fan.userId } })).toBe(
      1,
    );
    expect(
      await db.conversationParticipant.count({
        where: {
          conversationId: a.conversationId!,
          userId: fan.userId,
          leftAt: null,
        },
      }),
    ).toBe(1);
    expect(
      await db.crewMember.count({ where: { crewId, userId: fan.userId } }),
    ).toBe(0);
    expect(
      await db.$queryRaw`SELECT user_id FROM crew_likes WHERE crew_id=${crewId} AND user_id=${fan.userId}`,
    ).toEqual([]);
    await ips.unlikeIp(fan, ipId);
    expect(
      await db.conversationParticipant.count({
        where: {
          conversationId: a.conversationId!,
          userId: fan.userId,
          leftAt: null,
        },
      }),
    ).toBe(1);
  });
  it('rolls back a failed fan join and rejects blocked or unavailable Crews', async () => {
    await origins.save(ipId, { userId: owner }, { crewId, expectedVersion: 0 });
    const fan = { userId: `fan-${randomUUID()}` };
    const realConversations = new ConversationsService(
      db as never,
      {} as never,
      {} as never,
    );
    const spy = jest
      .spyOn(conversations, 'joinCrewCommunityConversation')
      .mockImplementationOnce(async (...args) => {
        await realConversations.joinCrewCommunityConversation(...args);
        throw new Error('Community unavailable');
      });
    await expect(ips.likeIp(fan, ipId)).rejects.toThrow(
      'Community unavailable',
    );
    spy.mockRestore();
    expect(
      await db.conversationParticipant.count({ where: { userId: fan.userId } }),
    ).toBe(0);
    expect(await db.ipLike.count({ where: { ipId, userId: fan.userId } })).toBe(
      0,
    );
    await db.ipUserContentBlock.create({
      data: { userId: fan.userId, targetType: 'crew', targetId: crewId },
    });
    await expect(ips.likeIp(fan, ipId)).rejects.toThrow('Crew not found');
    expect((await origins.publicOrigin(ipId, fan)).crew).toBeNull();
    await db.crew.update({
      where: { id: crewId },
      data: { listingStatus: 'unlisted' },
    });
    const privateCrewLike = await ips.likeIp({ userId: 'other' }, ipId);
    expect(privateCrewLike.conversationId).toBeNull();
    expect(
      await db.conversationParticipant.count({ where: { userId: 'other' } }),
    ).toBe(0);
    await expect(
      crewService().joinFanCommunity(crewId, 'other'),
    ).rejects.toThrow('Crew not found');
  });
  it('keeps unlinked IP likes independent and does not backfill prior likes when linking', async () => {
    const fan = { userId: `fan-${randomUUID()}` };
    const result = await ips.likeIp(fan, ipId);
    expect(result.conversationId).toBeNull();
    await origins.save(ipId, { userId: owner }, { crewId, expectedVersion: 0 });
    expect(
      await db.conversationParticipant.count({ where: { userId: fan.userId } }),
    ).toBe(0);
  });
  it('rejects Crew authority withdrawn while waiting for the IP ACL lock', async () => {
    let locked!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const finish = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocker = db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ip:acl:${ipId}`})::bigint)`;
      locked();
      await finish;
      await tx.crewMember.updateMany({
        where: { crewId, userId: owner },
        data: { status: 'removed', removedAt: new Date() },
      });
    });
    await ready;
    const saving = origins
      .save(ipId, { userId: owner }, { crewId, expectedVersion: 0 })
      .then(
        () => null,
        (error: unknown) => error,
      );
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const [row] = await db.$queryRaw<
          { found: boolean }[]
        >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%ip-origin-save%') AS found`;
        if (row.found) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
    } finally {
      release();
      await blocker;
    }
    expect(await saving).toMatchObject({
      response: { code: 'CREW_MEMBERSHIP_REQUIRED' },
    });
    expect(
      await db.$queryRaw`SELECT crew_id FROM ip_crew_origins WHERE ip_id=${ipId}::uuid`,
    ).toEqual([]);
    expect(
      (
        await db.ip.findUnique({
          where: { id: ipId },
          select: { version: true },
        })
      )?.version,
    ).toBe(0);
  });
  it('keeps Agent likes separate from human fan membership', async () => {
    await origins.save(ipId, { userId: owner }, { crewId, expectedVersion: 0 });
    const agentId = `agent-${randomUUID()}`;
    const result = await ips.likeAgentIp(agentId, ipId);
    expect(result.conversationId).toBeNull();
    expect(
      await db.conversationParticipant.count({ where: { userId: agentId } }),
    ).toBe(0);
    expect(
      (
        await db.ipLike.findUnique({
          where: { ipId_userId: { ipId, userId: agentId } },
        })
      )?.actorKind,
    ).toBe('agent');
  });
});
