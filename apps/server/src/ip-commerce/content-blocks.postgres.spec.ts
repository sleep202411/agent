import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { IpCommerceService } from './ip-commerce.service';
const url = process.env.TASK01_TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  'Content block recovery (owned PostgreSQL)',
  () => {
    let db: PrismaClient, service: IpCommerceService;
    const alice = { userId: `block-alice-${randomUUID()}` },
      bob = { userId: `block-bob-${randomUUID()}` };
    const ipIds: string[] = [];
    beforeAll(async () => {
      const target = postgresFixtureUrl(url!);
      if (
        target.hostname !== '127.0.0.1' ||
        target.port !== '55439' ||
        target.pathname !== '/task01'
      )
        throw Error('Owned database required');
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url }),
      });
      await db.$connect();
      service = new IpCommerceService(
        db as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );
    });
    afterEach(async () => {
      await db.ipUserContentBlock.deleteMany({
        where: { userId: { in: [alice.userId, bob.userId] } },
      });
      await db.ip.deleteMany({ where: { id: { in: ipIds.splice(0) } } });
    });
    afterAll(async () => db?.$disconnect());
    it('keeps private titles hidden while allowing own blocks to be removed', async () => {
      for (const status of ['published', 'draft'] as const) {
        const ip = await db.ip.create({
          data: {
            createdById: 'fixture',
            status,
            listingVisibility: 'public',
            sourceLocale: 'en-US',
            localizations: {
              create: {
                locale: 'en-US',
                title: status === 'published' ? 'Public film' : 'Private draft',
                summary: 'Fixture',
                status: 'published',
              },
            },
          },
        });
        ipIds.push(ip.id);
        await db.ipUserContentBlock.create({
          data: {
            userId: alice.userId,
            targetType: 'ip',
            targetId: ip.id,
            ipId: ip.id,
          },
        });
      }
      const page = await service.listMyContentBlocks(alice, {
        limit: 20,
        locale: 'en-US',
      });
      expect(page.items.map((row) => row.title)).toEqual(
        expect.arrayContaining(['Public film', null]),
      );
      expect(JSON.stringify(page)).not.toContain('Private draft');
      await service.removeMyContentBlock(alice, page.items[0].id);
      expect(
        (await service.listMyContentBlocks(alice, { limit: 20 })).items,
      ).toHaveLength(1);
    });
    it('paginates own records and rejects foreign cursors and removals', async () => {
      const a = await db.ipUserContentBlock.create({
        data: { userId: alice.userId, targetType: 'creator', targetId: 'one' },
      });
      const b = await db.ipUserContentBlock.create({
        data: { userId: alice.userId, targetType: 'creator', targetId: 'two' },
      });
      const other = await db.ipUserContentBlock.create({
        data: { userId: bob.userId, targetType: 'creator', targetId: 'other' },
      });
      const first = await service.listMyContentBlocks(alice, { limit: 1 });
      expect(first.nextCursor).toBe(first.items[0].id);
      await service.removeMyContentBlock(alice, first.items[0].id);
      const next = await service.listMyContentBlocks(alice, {
        limit: 1,
        cursor: first.nextCursor!,
      });
      expect(
        new Set([...first.items, ...next.items].map((row) => row.id)),
      ).toEqual(new Set([a.id, b.id]));
      await expect(
        service.listMyContentBlocks(alice, { limit: 20, cursor: other.id }),
      ).rejects.toMatchObject({ status: 400 });
      expect(await service.removeMyContentBlock(alice, other.id)).toEqual({
        removed: false,
      });
      expect(
        (
          await db.ipUserContentBlock.findUniqueOrThrow({
            where: { id: other.id },
          })
        ).unblockedAt,
      ).toBeNull();
    });
    it.each(['ip', 'creator', 'crew'] as const)(
      'removes a %s block idempotently without removing a newer block',
      async (targetType) => {
        const data = {
          userId: alice.userId,
          targetType,
          targetId: randomUUID(),
        };
        const old = await db.ipUserContentBlock.create({ data });
        expect(await service.removeMyContentBlock(alice, old.id)).toEqual({
          removed: true,
        });
        const current = await db.ipUserContentBlock.create({ data });
        expect(await service.removeMyContentBlock(alice, old.id)).toEqual({
          removed: false,
        });
        expect(
          (
            await db.ipUserContentBlock.findUniqueOrThrow({
              where: { id: current.id },
            })
          ).unblockedAt,
        ).toBeNull();
      },
    );
  },
);
