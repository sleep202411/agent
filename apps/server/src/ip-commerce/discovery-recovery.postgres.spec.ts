import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaService } from '../infra/db/db.module';
import type { AuthUser } from '../auth';
import { IpCommerceService } from './ip-commerce.service';
import { CreateAdminIpDiscoverySchema } from './dto';
const databaseUrl =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.DATABASE_POSTGRES_INTEGRATION === '1'
    ? process.env.DATABASE_URL
    : undefined);
const integration = databaseUrl ? describe : describe.skip;
const applicationName = `discovery-admin-${randomUUID()}`;
jest.setTimeout(30000);
integration('Discovery administrator writes (owned PostgreSQL)', () => {
  let db: PrismaClient;
  let actor: AuthUser;
  let ipId: string;
  let recId: string;
  let otherId: string;
  let imageId: string | undefined;
  const service = (client: unknown = db) =>
    new IpCommerceService(
      client as PrismaService,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      url.port !== '55439' ||
      url.pathname !== '/task01'
    )
      throw new Error('Owned task01 fixture required');
    db = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: databaseUrl,
        options: '-c timezone=UTC',
        application_name: applicationName,
      }),
      transactionOptions: { timeout: 15000 },
    });
    await db.$connect();
  });
  beforeEach(async () => {
    imageId = undefined;
    actor = { userId: randomUUID() } as AuthUser;
    ipId = (await db.ip.create({ data: { createdById: actor.userId } })).id;
    recId = (
      await db.ipDiscoveryRecommendation.create({
        data: {
          ipId,
          placementKey: 'ip_plaza_hero',
          createdById: actor.userId,
          sortOrder: 42,
          localizations: { create: { locale: 'en-US', title: 'Original' } },
        },
      })
    ).id;
    otherId = (
      await db.ipDiscoveryRecommendation.create({
        data: {
          ipId,
          placementKey: 'ip_plaza_list_pinned',
          createdById: actor.userId,
        },
      })
    ).id;
  });
  afterEach(async () => {
    await db.ipDiscoveryRecommendation.deleteMany({ where: { ipId } });
    await db.ip.delete({ where: { id: ipId } });
    if (imageId) await db.mediaAsset.delete({ where: { id: imageId } });
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  const write = (kind: string, client: unknown = db) =>
    kind === 'create'
      ? service(client).createAdminDiscovery(
          actor,
          CreateAdminIpDiscoverySchema.parse({
            ipId,
            placementKey: 'ip_plaza_hero',
            localizations: [{ locale: 'en-US', title: 'New' }],
          }),
        )
      : kind === 'delete'
        ? service(client).deleteAdminDiscovery(actor, recId)
        : kind === 'update'
          ? service(client).updateAdminDiscovery(actor, recId, {
              status: 'archived',
              localizations: [{ locale: 'en-US', title: 'Changed' }],
            })
          : service(client).reorderAdminDiscovery(actor, {
              placementKey: 'ip_plaza_hero',
              orderedIds: [recId],
            });
  const snapshot = async () => ({
    recs: await db.ipDiscoveryRecommendation.findMany({
      where: { ipId },
      include: { localizations: true },
      orderBy: { id: 'asc' },
    }),
  });
  const waitForLock = async () => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const [row] = await db.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*) FROM pg_stat_activity WHERE application_name=${applicationName} AND wait_event_type='Lock'`;
      if (Number(row.count)) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('Expected discovery write wait');
  };
  it('rejects duplicate, missing and mismatched order entries without partial writes', async () => {
    const before = await snapshot();
    for (const orderedIds of [
      [recId, recId],
      [recId, randomUUID()],
      [recId, otherId],
      [],
    ])
      await expect(
        service().reorderAdminDiscovery(actor, {
          placementKey: 'ip_plaza_hero',
          orderedIds,
        }),
      ).rejects.toMatchObject({ status: 400 });
    expect(await snapshot()).toEqual(before);
  });
  it('persists authorized translated edits and increments order version', async () => {
    await write('create');
    await write('update');
    await write('reorder');
    const rec = await db.ipDiscoveryRecommendation.findUniqueOrThrow({
      where: { id: recId },
      include: { localizations: true },
    });
    expect(rec).toMatchObject({
      status: 'archived',
      sortOrder: 0,
      version: 2,
      updatedById: actor.userId,
    });
    expect(rec.localizations[0].title).toBe('Changed');
  });
  it('uses the newly paused state when removing a hero image after a row wait', async () => {
    imageId = (
      await db.mediaAsset.create({
        data: {
          kind: 'image',
          status: 'ready',
          storageProvider: 'external_url',
          externalUrl: 'https://fixture.invalid/image.png',
        },
      })
    ).id;
    await db.ip.update({
      where: { id: ipId },
      data: {
        status: 'published',
        listingVisibility: 'public',
        publishedAt: new Date(),
      },
    });
    await db.ipDiscoveryRecommendation.update({
      where: { id: recId },
      data: { status: 'enabled', imageAssetId: imageId },
    });
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const acquired = new Promise<void>((r) => {
      ready = r;
    });
    const holder = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ip_discovery_recommendations WHERE id=${recId}::uuid FOR UPDATE`;
      ready();
      await gate;
      await tx.ipDiscoveryRecommendation.update({
        where: { id: recId },
        data: { status: 'paused' },
      });
    });
    await acquired;
    const pending = service().updateAdminDiscovery(actor, recId, {
      imageAssetId: null,
    });
    void pending.catch(() => undefined);
    try {
      await waitForLock();
    } finally {
      release();
    }
    await holder;
    await pending;
    expect(
      await db.ipDiscoveryRecommendation.findUniqueOrThrow({
        where: { id: recId },
      }),
    ).toMatchObject({ status: 'paused', imageAssetId: null });
  });
  it('preserves a concurrent pause when an unrelated edit waits for the row', async () => {
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const acquired = new Promise<void>((r) => {
      ready = r;
    });
    const holder = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ip_discovery_recommendations WHERE id=${recId}::uuid FOR UPDATE`;
      ready();
      await gate;
      await tx.ipDiscoveryRecommendation.update({
        where: { id: recId },
        data: { status: 'paused' },
      });
    });
    await acquired;
    const pending = service().updateAdminDiscovery(actor, recId, {
      sortOrder: 4,
    });
    void pending.catch(() => undefined);
    try {
      await waitForLock();
    } finally {
      release();
    }
    await holder;
    await pending;
    expect(
      (
        await db.ipDiscoveryRecommendation.findUniqueOrThrow({
          where: { id: recId },
        })
      ).status,
    ).toBe('paused');
  });
  it('deletes the selected recommendation and rejects repeated deletion', async () => {
    const result = await service().deleteAdminDiscovery(actor, recId);
    expect(result).toMatchObject({
      deleted: true,
      id: recId,
      deletedById: actor.userId,
    });
    expect(
      await db.ipDiscoveryRecommendation.findUnique({ where: { id: recId } }),
    ).toBeNull();
    await expect(
      service().deleteAdminDiscovery(actor, recId),
    ).rejects.toMatchObject({ status: 404 });
  });
});
