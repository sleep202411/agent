import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaService } from '../infra/db/db.module';
import { AppReleaseService } from './app-release.service';
const applicationName = `admin-regression-${randomUUID()}`;
const databaseUrl =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.DATABASE_POSTGRES_INTEGRATION === '1'
    ? process.env.DATABASE_URL
    : undefined);
const integration = databaseUrl ? describe : describe.skip;
jest.setTimeout(30000);
integration('App release partial updates (owned PostgreSQL)', () => {
  let prisma: PrismaClient;
  let service: AppReleaseService;
  let id: string;
  let base: number;
  const ids: string[] = [];
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !(
        (url.port === '5433' && url.pathname === '/fizzdragon_outbox_test') ||
        (url.port === '55439' && url.pathname === '/task01')
      )
    )
      throw new Error('Owned loopback fixture required');
    prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: databaseUrl,
        options: '-c timezone=UTC',
        application_name: applicationName,
      }),
      transactionOptions: { timeout: 15000 },
    });
    await prisma.$connect();
    service = new AppReleaseService(prisma as PrismaService);
  });
  beforeEach(async () => {
    base = randomInt(100000000, 2000000000);
    const row = await service.create({
      platform: 'android',
      versionCode: base,
      versionName: 'fixture',
      minSupportedCode: base - 10,
      downloadUrl: 'https://fixture.invalid/app',
      active: false,
    });
    id = row.id;
    ids.push(id);
  });
  afterEach(async () => {
    await prisma.appRelease.deleteMany({
      where: { id: { in: ids.splice(0) } },
    });
  });
  afterAll(async () => {
    await prisma?.$disconnect();
  });
  it('rejects invalid partial floors and version reductions without changing the record', async () => {
    await expect(
      service.update(id, { minSupportedCode: base + 1 }),
    ).rejects.toMatchObject({
      response: { code: 'APP_RELEASE_INVALID_VERSION_RANGE' },
    });
    await expect(
      service.update(id, { versionCode: base - 11 }),
    ).rejects.toMatchObject({
      response: { code: 'APP_RELEASE_INVALID_VERSION_RANGE' },
    });
    expect(
      await prisma.appRelease.findUniqueOrThrow({ where: { id } }),
    ).toMatchObject({ versionCode: base, minSupportedCode: base - 10 });
  });
  it('allows explicit floor clearing and coordinated version/floor changes', async () => {
    expect(await service.update(id, { minSupportedCode: null })).toMatchObject({
      minSupportedCode: null,
    });
    expect(
      await service.update(id, {
        versionCode: base - 20,
        minSupportedCode: base - 21,
      }),
    ).toMatchObject({ versionCode: base - 20, minSupportedCode: base - 21 });
  });
  it('evaluates the committed floor after waiting for a competing row update', async () => {
    let release!: () => void;
    let locked!: () => void;
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM app_releases WHERE id = ${id}::uuid FOR UPDATE`;
      locked();
      await gate;
      await tx.appRelease.update({
        where: { id },
        data: { minSupportedCode: base - 1 },
      });
    });
    await ready;
    const pending = service.update(id, { versionCode: base - 5 });
    void pending.catch(() => undefined);
    try {
      const deadline = Date.now() + 5000;
      while (true) {
        const rows = await prisma.$queryRaw<
          Array<{ count: bigint }>
        >`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND application_name=${applicationName} AND wait_event_type = 'Lock' AND query LIKE '%app_releases%'`;
        if (rows[0].count > 0n) break;
        if (Date.now() > deadline)
          throw new Error('Update did not reach its row-lock wait');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } finally {
      release();
    }
    await holder;
    await expect(pending).rejects.toMatchObject({
      response: { code: 'APP_RELEASE_INVALID_VERSION_RANGE' },
    });
    expect(
      await prisma.appRelease.findUniqueOrThrow({ where: { id } }),
    ).toMatchObject({ versionCode: base, minSupportedCode: base - 1 });
  });
  it('preserves missing-record and duplicate-platform-version errors', async () => {
    await expect(
      service.update(randomUUID(), { active: true }),
    ).rejects.toMatchObject({ status: 404 });
    const second = await service.create({
      platform: 'android',
      versionCode: base + 1,
      versionName: 'second',
      downloadUrl: 'https://fixture.invalid/app',
      active: false,
    });
    ids.push(second.id);
    await expect(
      service.update(id, { versionCode: base + 1 }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (await prisma.appRelease.findUniqueOrThrow({ where: { id } }))
        .versionCode,
    ).toBe(base);
  });
});
