import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaService } from '../infra/db/db.module';
import { CertificatesService } from './certificates.service';
const databaseUrl =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.DATABASE_POSTGRES_INTEGRATION === '1'
    ? process.env.DATABASE_URL
    : undefined);
const integration = databaseUrl ? describe : describe.skip;
const applicationName = `certificate-recovery-${randomUUID()}`;
jest.setTimeout(30000);
integration('Certificate update recovery (owned PostgreSQL)', () => {
  let db: PrismaClient;
  let assetId: string;
  let certId: string;
  const service = () =>
    new CertificatesService(
      db as PrismaService,
      { resolvePublicUrl: () => null } as never,
      {} as never,
    );
  const input = () => ({
    userId: 'fixture-user',
    title: 'Fixture',
    issuer: 'Fixture',
    imageAssetId: assetId,
    certNo: `FD-TEST-2026-${randomUUID().slice(0, 6).toUpperCase()}`,
  });
  beforeAll(async () => {
    const url = postgresFixtureUrl(databaseUrl!);
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
    assetId = (
      await db.mediaAsset.create({
        data: {
          kind: 'image',
          status: 'ready',
          storageProvider: 'external_url',
          externalUrl: 'https://fixture.invalid/image.png',
        },
      })
    ).id;
    certId = (await service().createAdmin(input())).id;
  });
  afterEach(async () => {
    await db.userCertificate.deleteMany({ where: { imageAssetId: assetId } });
    await db.mediaAsset.delete({ where: { id: assetId } });
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  const waitForLock = async (count = 1) => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const [row] = await db.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*) FROM pg_stat_activity WHERE application_name=${applicationName} AND wait_event_type='Lock'`;
      if (Number(row.count) >= count) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('Expected event write wait');
  };

  it('preserves the first revocation timestamp across a lock wait', async () => {
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const entered = new Promise<void>((r) => {
      ready = r;
    });
    const revokedAt = new Date('2026-01-01T00:00:00Z');
    const holder = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM user_certificates WHERE id=${certId}::uuid FOR UPDATE`;
      ready();
      await gate;
      await tx.userCertificate.update({
        where: { id: certId },
        data: { revokedAt, revokedReason: 'First' },
      });
    });
    await entered;
    const pending = service().revokeAdmin(certId, 'Second');
    void pending.catch(() => undefined);
    try {
      await waitForLock();
    } finally {
      release();
    }
    await holder;
    await pending;
    expect(
      await db.userCertificate.findUniqueOrThrow({ where: { id: certId } }),
    ).toMatchObject({ revokedAt, revokedReason: 'Second' });
    expect((await service().restoreAdmin(certId)).revokedAt).toBeNull();
  });
  it.each(['create', 'update'] as const)(
    'rejects %s when its image is deleted while waiting',
    async (kind) => {
      let release!: () => void;
      let ready!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const entered = new Promise<void>((r) => {
        ready = r;
      });
      const holder = db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM media_assets WHERE id=${assetId}::uuid FOR UPDATE`;
        ready();
        await gate;
        await tx.mediaAsset.update({
          where: { id: assetId },
          data: { status: 'deleted', deletedAt: new Date() },
        });
      });
      await entered;
      const pending =
        kind === 'create'
          ? service().createAdmin(input())
          : service().updateAdmin(certId, {
              imageAssetId: assetId,
              title: 'Changed',
            });
      void pending.catch(() => undefined);
      try {
        await waitForLock();
      } finally {
        release();
      }
      await holder;
      await expect(pending).rejects.toMatchObject({
        response: { code: 'CERT_IMAGE_ASSET_NOT_FOUND' },
      });
      expect(
        await db.userCertificate.count({ where: { imageAssetId: assetId } }),
      ).toBe(1);
      expect(
        await db.userCertificate.findUniqueOrThrow({ where: { id: certId } }),
      ).toMatchObject({ title: 'Fixture' });
    },
  );
  it('retains shared certificate images and the existing final-reference cleanup', async () => {
    const original = await db.userCertificate.findUniqueOrThrow({
      where: { id: certId },
    });
    await expect(
      service().createAdmin({ ...input(), certNo: original.certNo }),
    ).rejects.toMatchObject({ status: 409 });
    const second = await service().createAdmin(input());
    await service().deleteAdmin(certId);
    expect(
      await db.mediaAsset.findUniqueOrThrow({ where: { id: assetId } }),
    ).toMatchObject({ status: 'ready', deletedAt: null });
    await service().deleteAdmin(second.id);
    expect(
      await db.mediaAsset.findUniqueOrThrow({ where: { id: assetId } }),
    ).toMatchObject({ status: 'deleted' });
  });
  it('preserves a shared image when a concurrent issuance wins its image lock first', async () => {
    let release!: () => void;
    let admitted!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const ready = new Promise<void>((r) => {
      admitted = r;
    });
    const holder = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM media_assets WHERE id=${assetId}::uuid FOR UPDATE`;
      admitted();
      await gate;
    });
    await ready;
    const creation = service().createAdmin(input());
    void creation.catch(() => undefined);
    let deletion: Promise<{ id: string }> | undefined;
    try {
      await waitForLock();
      deletion = service().deleteAdmin(certId);
      void deletion.catch(() => undefined);
      await waitForLock(2);
    } finally {
      release();
    }
    await holder;
    await creation;
    await deletion;
    expect(
      await db.userCertificate.count({ where: { imageAssetId: assetId } }),
    ).toBe(1);
    expect(
      (await db.mediaAsset.findUniqueOrThrow({ where: { id: assetId } }))
        .status,
    ).toBe('ready');
  });
});
