import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaService } from '../infra/db/db.module';
import { MediaUploadService } from './media-upload.service';
const databaseUrl =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.DATABASE_POSTGRES_INTEGRATION === '1'
    ? process.env.DATABASE_URL
    : undefined);
const integration = databaseUrl ? describe : describe.skip;
const applicationName = `media-retry-${randomUUID()}`;
jest.setTimeout(30000);
integration('Generic upload confirmation (owned PostgreSQL)', () => {
  let db: PrismaClient;
  let userId: string;
  const storage = {
    createUploadUrl: jest.fn(({ storageKey }: { storageKey: string }) =>
      Promise.resolve({
        url: 'https://fixture.invalid/write',
        method: 'PUT' as const,
        headers: {},
        storageKey,
        provider: 'azure_blob' as const,
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      }),
    ),
    headObject: jest.fn(() =>
      Promise.resolve({
        exists: true,
        provider: 'azure_blob' as const,
        bucket: 'fixture',
        region: 'fixture',
        sizeBytes: 100,
        contentType: 'image/png',
      }),
    ),
    setCacheControl: jest.fn().mockResolvedValue(undefined),
  };
  const readiness = {
    enqueueAutomaticChecks: jest.fn().mockResolvedValue(undefined),
  };
  const service = (client: unknown = db) =>
    new MediaUploadService(
      client as PrismaService,
      storage as never,
      { resolve: () => 'https://fixture.invalid/asset' } as never,
      {} as never,
      readiness as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  const input = () => ({
    kind: 'news_cover' as const,
    contentType: 'image/png',
    sizeBytes: 100,
    fileName: 'cover.png',
  });
  const confirmInput = (storageKey: string) => ({
    kind: 'news_cover' as const,
    contentType: 'image/png',
    storageKey,
  });
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
  beforeEach(() => {
    jest.clearAllMocks();
    userId = randomUUID();
  });
  afterEach(async () => {
    await db.mediaAsset.deleteMany({ where: { createdByUserId: userId } });
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  const snapshot = async () => ({
    assets: await db.mediaAsset.findMany({
      where: { createdByUserId: userId },
      orderBy: { id: 'asc' },
    }),
    variants: await db.mediaAssetVariant.findMany({
      where: { asset: { createdByUserId: userId } },
      orderBy: { id: 'asc' },
    }),
    placements: await db.mediaObjectPlacement.findMany({
      where: { asset: { createdByUserId: userId } },
      orderBy: { id: 'asc' },
    }),
  });
  it.each(['news_cover', 'ip_banner'] as const)(
    'converges simultaneous %s confirmations onto one asset and placement',
    async (kind) => {
      const upload = await service().createUploadUrl(userId, {
        ...input(),
        kind,
      });
      const request = { ...confirmInput(upload.storageKey), kind };
      let inspectCount = 0;
      let release!: () => void;
      const inspected = new Promise<void>((resolve) => {
        release = resolve;
      });
      storage.headObject.mockImplementation(async () => {
        inspectCount++;
        if (inspectCount === 2) release();
        await inspected;
        return {
          exists: true,
          provider: 'azure_blob',
          bucket: 'fixture',
          region: 'fixture',
          sizeBytes: 100,
          contentType: 'image/png',
        };
      });
      const [first, second] = await Promise.all([
        service().confirmUpload(userId, request),
        service().confirmUpload(userId, request),
      ]);
      expect(first.mediaAssetId).toBe(second.mediaAssetId);
      expect(first.variantId).toBe(second.variantId);
      const after = await snapshot();
      expect(after.assets).toHaveLength(1);
      expect(after.variants).toHaveLength(1);
      expect(after.placements).toHaveLength(1);
      const replay = await service().confirmUpload(userId, request);
      expect(replay.mediaAssetId).toBe(first.mediaAssetId);
    },
  );
});
