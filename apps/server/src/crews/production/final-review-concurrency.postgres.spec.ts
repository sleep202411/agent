import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { ConflictException } from '@nestjs/common';
import { postgresFixtureUrl } from '../../common/__tests__/postgres-fixture-url';
import type { PrismaService } from '../../infra/db/db.module';
import { CrewProductionService } from './production.service';
const databaseUrl = process.env.TASK01_TEST_DATABASE_URL;
const applicationName = `final-review-${randomUUID()}`;
jest.setTimeout(30000);
const integration = databaseUrl ? describe : describe.skip;
integration('Crew final review serializes with task changes', () => {
  let db: PrismaClient;
  let crewId: string;
  let episodeId: string;
  let assetNodeId: string;
  let mediaId: string;
  const userId = 'episode-deletion-fixture';
  const broadcast = jest.fn().mockResolvedValue(undefined);
  const authorization = { require: jest.fn().mockResolvedValue(undefined) };
  const service = (client: unknown = db, assetAccess: unknown = {}) =>
    new CrewProductionService(
      client as PrismaService,
      authorization as never,
      assetAccess as never,
      { broadcastCrewTaskProjectChange: broadcast } as never,
      {} as never,

      { revoke: jest.fn().mockResolvedValue(undefined) } as never,
    );
  beforeAll(async () => {
    const url = postgresFixtureUrl(databaseUrl!);
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      url.port !== '55439' ||
      url.pathname !== '/task01'
    )
      throw new Error('Owned loopback task01 fixture required');
    db = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: databaseUrl,
        application_name: applicationName,
      }),
      transactionOptions: { timeout: 15000 },
    });
    await db.$connect();
  });
  beforeEach(async () => {
    jest.clearAllMocks();
    crewId = randomUUID();
    await db.crew.create({
      data: {
        id: crewId,
        name: 'Episode deletion fixture',
        description: '',
        logo: 'fixture.png',
        createdByUserId: userId,
      },
    });
    episodeId = (
      await db.crewEpisode.create({
        data: {
          crewId,
          number: 1,
          title: 'Final cut',
          createdByUserId: userId,
        },
      })
    ).id;
    mediaId = (
      await db.mediaAsset.create({
        data: {
          kind: 'video',
          status: 'ready',
          storageProvider: 's3_compatible',
          bucket: 'test',
          objectKey: randomUUID(),
          sizeBytes: 60n,
        },
      })
    ).id;
    assetNodeId = (
      await db.crewAssetNode.create({
        data: {
          crewId,
          kind: 'file',
          mediaAssetId: mediaId,
          name: 'final.mp4',
          createdByUserId: userId,
          updatedByUserId: userId,
        },
      })
    ).id;
  });
  afterEach(async () => {
    await db.crewTask.deleteMany({ where: { crewId } });
    await db.crewTaskWorkflowState.deleteMany({ where: { crewId } });
    await db.crewEpisodeDelivery.deleteMany({ where: { crewId } });
    await db.crewEpisode.deleteMany({ where: { crewId } });
    await db.crewAssetNode.deleteMany({ where: { crewId } });
    await db.mediaAsset.delete({ where: { id: mediaId } });
    await db.crew.delete({ where: { id: crewId } });
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  const addDelivery = () =>
    db.crewEpisodeDelivery.create({
      data: {
        crewId,
        episodeId,
        assetNodeId,
        versionNumber: 1,
        submittedByUserId: userId,
      },
    });

  it('waits for a pending task write and refuses approval once unfinished work commits', async () => {
    const delivery = await addDelivery();
    const workflow = await db.crewTaskWorkflowState.create({
      data: {
        crewId,
        name: 'Open',
        color: '#ffffff',
        semantic: 'open',
        createdByUserId: userId,
      },
    });
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const writer = db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:task-writes:${crewId}`}, 0))`;
      await tx.crewTask.create({
        data: {
          crewId,
          episodeId,
          number: 1,
          title: 'Unfinished edit',
          workflowStateId: workflow.id,
          createdByUserId: userId,
        },
      });
      entered();
      await gate;
    });
    await started;
    let settled = false;
    const review = service()
      .reviewDelivery(delivery.id, userId, { decision: 'approve', note: '' })
      .then(
        (value) => {
          settled = true;
          return { value, error: null };
        },
        (error: unknown) => {
          settled = true;
          return { value: null, error };
        },
      );
    try {
      const deadline = Date.now() + 5000;
      while (!settled && Date.now() < deadline) {
        const waiting = await db.$queryRaw<
          { count: number }[]
        >`SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name=${applicationName} AND wait_event_type='Lock'`;
        if (waiting[0].count > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } finally {
      release();
    }
    await writer;
    const result = await review;
    expect(result.error).toBeInstanceOf(ConflictException);
    expect(
      (
        await db.crewEpisodeDelivery.findUniqueOrThrow({
          where: { id: delivery.id },
        })
      ).status,
    ).toBe('submitted');
    expect(
      (await db.crewEpisode.findUniqueOrThrow({ where: { id: episodeId } }))
        .status,
    ).not.toBe('completed');
    expect(broadcast).not.toHaveBeenCalled();
  });
  it('approves a final cut when no unfinished tasks remain', async () => {
    const delivery = await addDelivery();
    await service().reviewDelivery(delivery.id, userId, {
      decision: 'approve',
      note: '',
    });
    expect(
      (await db.crewEpisode.findUniqueOrThrow({ where: { id: episodeId } }))
        .status,
    ).toBe('completed');
  });
});
