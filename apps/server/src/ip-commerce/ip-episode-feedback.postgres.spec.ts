import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../infra/db/db.module';
import { IpCommerceService } from './ip-commerce.service';
import { IpEpisodeFeedbackService } from './ip-episode-feedback';
import { readIpProductionEvidence } from './ip-production-evidence';
import { IpProductionPublicController } from './ip-production-public';
const databaseUrl =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.IP_FEEDBACK_POSTGRES_TEST === '1'
    ? process.env.DATABASE_URL
    : undefined);
const integration = databaseUrl ? describe : describe.skip;
integration('IP episode feedback (local PostgreSQL)', () => {
  let prisma: PrismaClient;
  let service: IpEpisodeFeedbackService;
  let publicStage: IpProductionPublicController;
  let ipId: string;
  let episodeId: string;
  const viewer = { userId: 'comment-test-viewer', nickName: 'Viewer' };

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !(
        (url.port === '5433' && url.pathname === '/fizzdragon_outbox_test') ||
        (url.port === '55439' && url.pathname === '/task01')
      )
    )
      throw new Error('Explicitly allowed loopback test database required');
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl }),
      transactionOptions: { timeout: 15000 },
    });
    await prisma.$connect();
    service = new IpEpisodeFeedbackService(
      prisma as PrismaService,
      new IpCommerceService(
        prisma as PrismaService,
        undefined as never,
        undefined as never,
        undefined as never,
        undefined as never,
        undefined as never,
        undefined as never,
      ),
    );
    publicStage = new IpProductionPublicController(
      prisma as PrismaService,
      new IpCommerceService(
        prisma as PrismaService,
        undefined as never,
        undefined as never,
        undefined as never,
        undefined as never,
        undefined as never,
        undefined as never,
      ),
    );
  });
  beforeEach(async () => {
    const ip = await prisma.ip.create({
      data: {
        createdById: viewer.userId,
        status: 'published',
        listingVisibility: 'public',
        localizations: {
          create: {
            locale: 'en-US',
            title: 'Test',
            summary: 'Test',
            status: 'published',
          },
        },
      },
    });
    ipId = ip.id;
    episodeId = (
      await prisma.ipEpisode.create({
        data: {
          ipId,
          episodeNo: 1,
          localizations: {
            create: { locale: 'en-US', title: 'Episode', status: 'published' },
          },
          status: 'published',
          createdById: viewer.userId,
        },
      })
    ).id;
  });
  afterEach(async () => {
    await prisma.ip.delete({ where: { id: ipId } });
  });
  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('shows the public production stage without audit metadata and rejects private IPs', async () => {
    expect(await publicStage.read({ ipId }, viewer)).toEqual({
      code: 200,
      data: { stage: 'testing' },
    });
    await prisma.$executeRaw`INSERT INTO ip_production_stages(ip_id,stage,version) VALUES (${ipId}::uuid,'production',1)`;
    expect(await publicStage.read({ ipId })).toEqual({
      code: 200,
      data: { stage: 'production' },
    });
    await prisma.ip.update({
      where: { id: ipId },
      data: { listingVisibility: 'private' },
    });
    await expect(publicStage.read({ ipId }, viewer)).rejects.toThrow();
  });

  it('collects human likes and canonical published testing-episode feedback without inferring promotion', async () => {
    await prisma.ipLike.createMany({
      data: [
        { ipId, userId: 'human-evidence' },
        { ipId, userId: 'agent-evidence', actorKind: 'agent' },
        { ipId, userId: 'removed-evidence', status: 'removed' },
        { ipId, userId: 'removed-time-evidence', removedAt: new Date() },
      ],
    });
    await service.vote(ipId, episodeId, viewer, 1);
    await service.vote(ipId, episodeId, { userId: 'other-evidence' }, -1);
    const fourth = await prisma.ipEpisode.create({
      data: {
        ipId,
        episodeNo: 4,
        createdById: viewer.userId,
        status: 'published',
        localizations: {
          create: { locale: 'en-US', title: 'Fourth', status: 'published' },
        },
      },
    });
    await prisma.$executeRaw`INSERT INTO ip_episode_feedback(episode_id,user_id,value) VALUES (${fourth.id}::uuid, ${viewer.userId}, 1)`;
    expect(
      await readIpProductionEvidence(prisma as PrismaService, ipId),
    ).toEqual({
      ipId,
      publicationStatus: 'published',
      humanIpLikes: '1',
      episodes: [{ episodeId, episodeNo: 1, likes: '1', dislikes: '1' }],
    });
    await prisma.ipEpisodeLocalization.updateMany({
      where: { episodeId },
      data: { archivedAt: new Date() },
    });
    expect(
      (await readIpProductionEvidence(prisma as PrismaService, ipId)).episodes,
    ).toEqual([]);
    await prisma.ip.update({
      where: { id: ipId },
      data: { deletedAt: new Date() },
    });
    await expect(
      readIpProductionEvidence(prisma as PrismaService, ipId),
    ).rejects.toThrow('IP not found');
  });

  it('records repeated votes once, changes preference and clears only the caller vote', async () => {
    await Promise.all([
      service.vote(ipId, episodeId, viewer, 1),
      service.vote(ipId, episodeId, viewer, 1),
    ]);
    expect(await service.read(ipId, episodeId, viewer)).toEqual({
      likes: 1,
      dislikes: 0,
      mine: 1,
    });
    await service.vote(ipId, episodeId, { userId: 'another' }, -1);
    expect(await service.vote(ipId, episodeId, viewer, -1)).toEqual({
      likes: 0,
      dislikes: 2,
      mine: -1,
    });
    expect(await service.vote(ipId, episodeId, viewer, null)).toEqual({
      likes: 0,
      dislikes: 1,
      mine: null,
    });
    expect((await service.read(ipId, episodeId)).mine).toBeNull();
  });
  it('rejects other IPs, unpublished and later episodes without feedback', async () => {
    await expect(
      service.vote(randomUUID(), episodeId, viewer, 1),
    ).rejects.toThrow();
    await prisma.ipEpisode.update({
      where: { id: episodeId },
      data: { status: 'draft' },
    });
    await expect(service.vote(ipId, episodeId, viewer, 1)).rejects.toThrow();
    await prisma.ipEpisode.update({
      where: { id: episodeId },
      data: { status: 'published', episodeNo: 4 },
    });
    await expect(service.vote(ipId, episodeId, viewer, 1)).rejects.toThrow();
    const rows =
      await prisma.$queryRaw`SELECT * FROM ip_episode_feedback WHERE episode_id=${episodeId}::uuid`;
    expect(rows).toEqual([]);
  });
  it('rejects publication withdrawn during the IP row-lock wait', async () => {
    let locked!: () => void;
    let release!: () => void;
    const acquired = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const finish = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocker = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ips WHERE id = ${ipId}::uuid FOR UPDATE`;
      locked();
      await finish;
      await tx.ip.update({
        where: { id: ipId },
        data: { listingVisibility: 'private' },
      });
    });
    await acquired;
    const posting = service.vote(ipId, episodeId, viewer, 1).then(
      () => null,
      (error: unknown) => error,
    );
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const rows = await prisma.$queryRaw<
          { found: boolean }[]
        >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%episode-feedback%') AS found`;
        if (rows[0].found) {
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
    expect(await posting).toMatchObject({ response: { code: 'IP_NOT_FOUND' } });
    const rows = await prisma.$queryRaw<
      unknown[]
    >`SELECT episode_id FROM ip_episode_feedback WHERE episode_id = ${episodeId}::uuid`;
    expect(rows).toHaveLength(0);
  });
});
