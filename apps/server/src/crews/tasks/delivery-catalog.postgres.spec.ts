import { postgresFixtureUrl } from '../../common/__tests__/postgres-fixture-url';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../../infra/db/db.module';
import type { AdminActor } from '../../admin-auth';
import {
  CrewDeliveryCatalogService,
  SaveDeliveryCategory,
} from './delivery-catalog';
const databaseUrl =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.DATABASE_POSTGRES_INTEGRATION === '1'
    ? process.env.DATABASE_URL
    : undefined);
const suite = databaseUrl ? describe : describe.skip;
suite('delivery catalog on local PostgreSQL', () => {
  let db: PrismaClient,
    service: CrewDeliveryCatalogService,
    actor: AdminActor,
    roleId: string,
    id: string;
  const definition = {
    name: 'Animation delivery',
    description: 'Configured by engineering fixture',
    status: 'active' as const,
    prices: [
      { currency: 'USD' as const, amountMinor: '5000', unit: 'approved task' },
    ],
    fields: [
      {
        key: 'output',
        label: 'Output',
        instructions: 'Accepted file',
        type: 'attachment' as const,
        required: true,
      },
    ],
  };
  const input = {
    expectedVersion: 0,
    reason: 'Configure fixture category',
    definition,
  };
  beforeAll(async () => {
    const url = postgresFixtureUrl(databaseUrl!);
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !(
        (url.port === '5433' && url.pathname === '/fizzdragon_outbox_test') ||
        (url.port === '55439' && url.pathname === '/task01') ||
        (url.port === '55441' && url.pathname === '/audit_migrations_20261005')
      )
    )
      throw new Error('Explicitly allowed loopback test database required');
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl }),
      transactionOptions: { timeout: 15000 },
    });
    await db.$connect();
    service = new CrewDeliveryCatalogService(db as PrismaService);
  });
  beforeEach(async () => {
    id = randomUUID();
    actor = {
      id: randomUUID(),
      sessionId: randomUUID(),
      siteScope: 'all',
    } as AdminActor;
    const permission = await db.adminPermission.upsert({
      where: { key: 'crew.manage' },
      create: { key: 'crew.manage', description: 'Publish' },
      update: {},
    });
    const role = await db.adminRole.create({
      data: {
        key: randomUUID(),
        name: 'Stage test',
        permissions: { create: { permissionId: permission.id } },
      },
    });
    roleId = role.id;
    const user = await db.adminUser.create({
      data: {
        email: `${randomUUID()}@example.test`,
        displayName: 'Stage test',
        id: actor.id,
        passwordHash: 'local-test-hash',
        status: 'active',
        roles: { create: { roleId } },
      },
    });
    const session = await db.adminSession.create({
      data: {
        id: actor.sessionId,
        userId: user.id,
        tokenHash: randomUUID(),
        expiresAt: new Date('2100-01-01T00:00:00Z'),
      },
    });
    actor = {
      id: user.id,
      sessionId: session.id,
      siteScope: 'all',
    } as AdminActor;
  });
  afterEach(async () => {
    await db.$executeRaw`DELETE FROM crew_delivery_catalog_revisions WHERE category_id=${id}::uuid`;
    await db.adminAuditLog.deleteMany({ where: { resourceId: id } });
    await db.adminUser.deleteMany({ where: { id: actor.id } });
    await db.adminRole.deleteMany({ where: { id: roleId } });
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  it('preserves revisions, replays a lost response and archives without losing its price/form', async () => {
    const first = await service.save(actor, id, input);
    expect(await service.save(actor, id, input)).toEqual(first);
    expect(await db.adminAuditLog.count({ where: { resourceId: id } })).toBe(1);
    await expect(
      service.save(actor, id, { ...input, reason: 'Changed retry' }),
    ).rejects.toThrow('Refresh');
    const next = await service.save(actor, id, {
      expectedVersion: 1,
      reason: 'Archive category',
      definition: { ...definition, status: 'archived' },
    });
    expect(next.version).toBe(2);
    const rows = await db.$queryRaw<
      Array<{ version: number }>
    >`SELECT version FROM crew_delivery_catalog_revisions WHERE category_id=${id}::uuid ORDER BY version`;
    expect(rows.map((row) => row.version)).toEqual([1, 2]);
    expect(
      (await service.list({ limit: 100 }, true)).items.find(
        (item) => item.id === id,
      ),
    ).toBeUndefined();
    expect(
      (await service.list({ limit: 100 })).items.find((item) => item.id === id)
        ?.definition.prices,
    ).toEqual(definition.prices);
  });
  it('allows only one concurrent revision', async () => {
    const results = await Promise.allSettled([
      service.save(actor, id, input),
      service.save(actor, id, { ...input, reason: 'Other editor payload' }),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(await db.adminAuditLog.count({ where: { resourceId: id } })).toBe(1);
  });
  it('rejects permission revoked during the category lock wait', async () => {
    let unlock!: () => void, ready!: (pid: number) => void;
    const release = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const entered = new Promise<number>((resolve) => {
      ready = resolve;
    });
    const holder = db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:delivery-catalog:${id}`},0))`;
        const [row] = await tx.$queryRaw<
          Array<{ pid: number }>
        >`SELECT pg_backend_pid() AS pid`;
        ready(row.pid);
        await release;
      },
      { timeout: 15000 },
    );
    let result: Promise<unknown> | undefined;
    try {
      const pid = await entered;
      result = service.save(actor, id, input).then(
        (value) => ({ value }),
        (error) => ({ error: error as unknown }),
      );
      let waiting = false;
      for (let i = 0; i < 200; i++) {
        const [row] = await db.$queryRaw<
          Array<{ waiting: boolean }>
        >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${pid}=ANY(pg_blocking_pids(pid))) AS waiting`;
        if (row.waiting) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      await db.adminUserRole.deleteMany({ where: { userId: actor.id } });
      unlock();
      await holder;
      expect(await result).toMatchObject({ error: { status: 403 } });
      expect(await db.adminAuditLog.count({ where: { resourceId: id } })).toBe(
        0,
      );
      const rows = await db.$queryRaw<
        Array<{ version: number }>
      >`SELECT version FROM crew_delivery_catalog_revisions WHERE category_id=${id}::uuid`;
      expect(rows).toEqual([]);
    } finally {
      unlock();
      await holder;
      await result;
    }
  });

  it('rejects an expired administrator without category or audit writes', async () => {
    await db.adminSession.update({
      where: { id: actor.sessionId },
      data: { expiresAt: new Date(0) },
    });
    await expect(service.save(actor, id, input)).rejects.toThrow('permission');
    expect(await db.adminAuditLog.count({ where: { resourceId: id } })).toBe(0);
    const rows = await db.$queryRaw<
      Array<{ version: number }>
    >`SELECT version FROM crew_delivery_catalog_revisions WHERE category_id=${id}::uuid`;
    expect(rows).toEqual([]);
  });
});

describe('delivery catalog contract', () => {
  const definition = {
    name: 'Edit',
    description: '',
    status: 'active',
    prices: [],
    fields: [
      {
        key: 'file',
        label: 'File',
        instructions: '',
        type: 'attachment',
        required: true,
      },
    ],
  };
  it('requires a real form and unique fields/currencies with explicit minor-unit prices', () => {
    const parse = (d: unknown) =>
      SaveDeliveryCategory.safeParse({
        expectedVersion: 0,
        reason: 'Configure',
        definition: d,
      }).success;
    expect(parse(definition)).toBe(true);
    expect(parse({ ...definition, fields: [] })).toBe(false);
    expect(
      parse({
        ...definition,
        fields: [...definition.fields, ...definition.fields],
      }),
    ).toBe(false);
    expect(
      parse({
        ...definition,
        prices: [{ currency: 'USD', amountMinor: '1.25', unit: 'task' }],
      }),
    ).toBe(false);
    expect(
      parse({
        ...definition,
        prices: [
          { currency: 'USD', amountMinor: '100', unit: 'task' },
          { currency: 'USD', amountMinor: '200', unit: 'task' },
        ],
      }),
    ).toBe(false);
    expect(parse({ ...definition, formula: 'execute()' })).toBe(false);
  });
});
