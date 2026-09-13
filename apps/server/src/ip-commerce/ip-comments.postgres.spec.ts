import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../infra/db/db.module';
import { IpCommerceService } from './ip-commerce.service';
import { IpCommentsService } from './ip-comments.service';
const databaseUrl =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.IP_COMMENTS_POSTGRES_TEST === '1'
    ? process.env.DATABASE_URL
    : undefined);
const integration = databaseUrl ? describe : describe.skip;
integration('IP public comments (local PostgreSQL)', () => {
  let prisma: PrismaClient;
  let service: IpCommentsService;
  let ipId: string;
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
    service = new IpCommentsService(
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
  });
  afterEach(async () => {
    await prisma.ip.delete({ where: { id: ipId } });
  });
  afterAll(async () => {
    await prisma?.$disconnect();
  });
  it('stores a concurrent response-loss replay once and rejects key reuse by another author or body', async () => {
    const input = { body: 'Hello', requestId: randomUUID() };
    const [a, b] = await Promise.all([
      service.create(ipId, viewer, input),
      service.create(ipId, viewer, input),
    ]);
    expect(a.id).toBe(b.id);
    expect((await service.list(ipId)).items).toHaveLength(1);
    await expect(
      service.create(ipId, { userId: 'other' }, input),
    ).rejects.toThrow('cannot be reused');
    await expect(
      service.create(ipId, viewer, { ...input, body: 'changed' }),
    ).rejects.toThrow('cannot be reused');
  });
  it('does not read or insert when the visibility check rejects', async () => {
    await prisma.ip.update({
      where: { id: ipId },
      data: { listingVisibility: 'private' },
    });
    await expect(service.list(ipId, viewer)).rejects.toMatchObject({
      response: { code: 'IP_NOT_FOUND' },
    });
    await expect(
      service.create(ipId, viewer, { body: 'hidden', requestId: randomUUID() }),
    ).rejects.toMatchObject({ response: { code: 'IP_NOT_FOUND' } });
    const rows = await prisma.$queryRaw<
      unknown[]
    >`SELECT id FROM ip_public_comments WHERE ip_id = ${ipId}::uuid`;
    expect(rows).toHaveLength(0);
  });
  it('restricts author removal, preserves moderation evidence on replay and cannot revive removed comments', async () => {
    const input = { body: 'Remove me', requestId: randomUUID() };
    const row = await service.create(ipId, viewer, input);
    await expect(
      service.remove(ipId, row.id, { userId: 'other' }),
    ).rejects.toThrow('Comment not found');
    await service.moderate(ipId, row.id, 'operator', 'Reported spam');
    await service.moderate(ipId, row.id, 'replacement', 'Second reason');
    await service.remove(ipId, row.id, viewer);
    expect((await service.list(ipId)).items).toHaveLength(0);
    const [stored] = await prisma.$queryRaw<
      { removal_actor: string; removal_reason: string }[]
    >`SELECT removal_actor, removal_reason FROM ip_public_comments WHERE id=${row.id}::uuid`;
    expect(stored).toEqual({
      removal_actor: 'admin:operator',
      removal_reason: 'Reported spam',
    });
    await expect(service.create(ipId, viewer, input)).rejects.toThrow(
      'cannot be reused',
    );
  });
  it('paginates equal-millisecond timestamps without loss and rejects a foreign-IP cursor', async () => {
    for (let i = 0; i < 52; i++)
      await prisma.$executeRaw`INSERT INTO ip_public_comments (id,ip_id,user_id,body,created_at) VALUES (${randomUUID()}::uuid,${ipId}::uuid,${viewer.userId},${String(i)},'2026-09-13 12:00:00.123456+00'::timestamptz)`;
    const first = await service.list(ipId, viewer);
    const second = await service.list(ipId, viewer, first.nextCursor!);
    expect(first.items).toHaveLength(50);
    expect(second.items).toHaveLength(2);
    expect(
      new Set([...first.items, ...second.items].map((x) => x.id)).size,
    ).toBe(52);
    expect(second.nextCursor).toBeNull();
    const other = await prisma.ip.create({
      data: {
        createdById: viewer.userId,
        status: 'published',
        listingVisibility: 'public',
        localizations: {
          create: {
            locale: 'en-US',
            title: 'Other',
            summary: 'Other',
            status: 'published',
          },
        },
      },
    });
    try {
      await expect(
        service.list(other.id, viewer, first.nextCursor!),
      ).rejects.toThrow('Invalid comment cursor');
    } finally {
      await prisma.ip.delete({ where: { id: other.id } });
    }
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
    const posting = service
      .create(ipId, viewer, { body: 'Late comment', requestId: randomUUID() })
      .then(
        () => null,
        (error: unknown) => error,
      );
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const rows = await prisma.$queryRaw<
          { found: boolean }[]
        >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%ip-public-comment-create%') AS found`;
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
    >`SELECT id FROM ip_public_comments WHERE ip_id = ${ipId}::uuid`;
    expect(rows).toHaveLength(0);
  });
  it('respects the current viewer IP block while allowing another public viewer', async () => {
    await prisma.ipUserContentBlock.create({
      data: { userId: viewer.userId, targetType: 'ip', targetId: ipId, ipId },
    });
    await expect(service.list(ipId, viewer)).rejects.toMatchObject({
      response: { code: 'IP_NOT_FOUND' },
    });
    await expect(
      service.create(ipId, viewer, {
        body: 'Blocked',
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ response: { code: 'IP_NOT_FOUND' } });
    expect(
      (await service.list(ipId, { userId: 'another-viewer' })).items,
    ).toHaveLength(0);
  });
});
