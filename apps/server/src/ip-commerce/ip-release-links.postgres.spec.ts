import { buildPrisma, type PrismaService } from '../infra/db/db.module';
import { IpCommerceService } from './ip-commerce.service';
import { IpReleaseLinksService } from './ip-release-links';
const integration =
  process.env.IP_RELEASE_LINKS_POSTGRES_TEST === '1' ? describe : describe.skip;
integration('IP release links (local PostgreSQL)', () => {
  let prisma: ReturnType<typeof buildPrisma>;
  let service: IpReleaseLinksService;
  let ipId: string;
  const user = { userId: 'release-owner' };
  const links = [
    { label: 'Published platform', url: 'https://example.com/release' },
  ];
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.port !== '5433'
    )
      throw new Error('Local PostgreSQL 5433 required');
    prisma = buildPrisma();
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
