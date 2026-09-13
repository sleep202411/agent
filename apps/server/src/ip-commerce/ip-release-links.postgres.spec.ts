import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaService } from '../infra/db/db.module';
import { IpCommerceService } from './ip-commerce.service';
import { IpReleaseLinksService } from './ip-release-links';
const databaseUrl =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.IP_RELEASE_LINKS_POSTGRES_TEST === '1'
    ? process.env.DATABASE_URL
    : undefined);
const integration = databaseUrl ? describe : describe.skip;
integration('IP release links (local PostgreSQL)', () => {
  let prisma: PrismaClient;
  let service: IpReleaseLinksService;
  let ipId: string;
  const user = { userId: 'release-owner' };
  const links = [
    { label: 'Published platform', url: 'https://example.com/release' },
  ];
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
    service = new IpReleaseLinksService(
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
        createdById: user.userId,
        status: 'published',
        listingVisibility: 'public',
        localizations: {
          create: {
            locale: 'en-US',
            title: 'Release',
            summary: 'Release',
            status: 'published',
          },
        },
      },
    });
    ipId = ip.id;
  });
  afterEach(async () => {
    await prisma.ip.delete({ where: { id: ipId } });
  });
  afterAll(async () => {
    await prisma?.$disconnect();
  });
  it('allows the owner to save, detects conflicting saves and respects public visibility', async () => {
    const initial = await service.ownList(ipId, user);
    expect(initial.links).toEqual([]);
    const results = await Promise.allSettled([
      service.save(ipId, user, { links, expectedVersion: initial.version }),
      service.save(ipId, user, { links: [], expectedVersion: initial.version }),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const current = await service.ownList(ipId, user);
    expect(current.version).toBe(initial.version + 1);
    expect((await service.publicList(ipId)).links).toEqual(current.links);
    await prisma.ip.update({
      where: { id: ipId },
      data: { listingVisibility: 'private' },
    });
    await expect(service.publicList(ipId)).rejects.toMatchObject({
      response: { code: 'IP_NOT_FOUND' },
    });
  });
  it('rejects a foreign creator and a revoked editor without changing saved links', async () => {
    await expect(
      service.save(ipId, { userId: 'foreign' }, { links, expectedVersion: 0 }),
    ).rejects.toMatchObject({ response: { code: 'IP_NOT_FOUND' } });
    const grant = await prisma.ipAclGrant.create({
      data: {
        ipId,
        userId: 'editor',
        permission: 'edit',
        grantedById: user.userId,
      },
    });
    const saved = await service.save(
      ipId,
      { userId: 'editor' },
      { links, expectedVersion: 0 },
    );
    await prisma.ipAclGrant.update({
      where: { id: grant.id },
      data: { revokedAt: new Date() },
    });
    await expect(
      service.save(
        ipId,
        { userId: 'editor' },
        { links: [], expectedVersion: saved.version },
      ),
    ).rejects.toMatchObject({ response: { code: 'IP_NOT_FOUND' } });
    expect((await service.ownList(ipId, user)).links).toEqual(links);
  });
});
