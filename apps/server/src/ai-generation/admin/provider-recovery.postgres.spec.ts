import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaService } from '../../infra/db/db.module';
import { AiModelOpsService } from './ai-model-ops.service';
import { CreateProviderEndpointSchema } from './ai-model-ops.dto';

const databaseUrl =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.DATABASE_POSTGRES_INTEGRATION === '1'
    ? process.env.DATABASE_URL
    : undefined);
const integration = databaseUrl ? describe : describe.skip;
const applicationName = `provider-recovery-${randomUUID()}`;
jest.setTimeout(30000);

integration('Provider configuration recovery (owned PostgreSQL)', () => {
  let db: PrismaClient;
  let providerId: string;
  let endpointId: string;
  const adminId = randomUUID();
  const service = () => new AiModelOpsService(db as PrismaService, {} as never);
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      url.port !== '55439' ||
      url.pathname !== '/task01' ||
      url.search
    )
      throw new Error('Owned task01 fixture required');
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
    providerId = (
      await db.aiProviderAccount.create({
        data: { provider: `fixture-${randomUUID()}` },
      })
    ).id;
    endpointId = (
      await db.aiProviderEndpoint.create({
        data: {
          providerAccountId: providerId,
          provider: 'fixture',
          endpointId: 'original',
          modality: 'image',
        },
      })
    ).id;
  });
  afterEach(async () => {
    await db.aiProviderEndpoint.deleteMany({
      where: { providerAccountId: providerId },
    });
    await db.aiProviderAccount.delete({ where: { id: providerId } });
  });
  afterAll(async () => {
    await db?.$disconnect();
  });

  const create = () =>
    service().createProviderEndpoint(
      adminId,
      CreateProviderEndpointSchema.parse({
        providerAccountId: providerId,
        endpointId: 'new',
        modality: 'image',
      }),
    );

  it('serializes duplicate endpoint creates with the existing conflict response', async () => {
    const results = await Promise.allSettled([create(), create()]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(
      rejected?.status === 'rejected' ? rejected.reason : null,
    ).toMatchObject({ status: 400 });
    expect(
      await db.aiProviderEndpoint.count({
        where: { providerAccountId: providerId, endpointId: 'new' },
      }),
    ).toBe(1);
  });

  it.each(['provider-update', 'endpoint-update', 'endpoint-create'] as const)(
    'rejects %s after archival during its lock wait',
    async (kind) => {
      let release!: () => void;
      let ready!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const entered = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const holder = db.$transaction(async (tx) => {
        if (kind === 'endpoint-update') {
          await tx.$queryRaw`SELECT id FROM ai_provider_endpoints WHERE id=${endpointId}::uuid FOR UPDATE`;
        } else {
          await tx.$queryRaw`SELECT id FROM ai_provider_accounts WHERE id=${providerId}::uuid FOR UPDATE`;
        }
        ready();
        await gate;
        if (kind === 'endpoint-update') {
          await tx.aiProviderEndpoint.update({
            where: { id: endpointId },
            data: { archivedAt: new Date() },
          });
        } else {
          await tx.aiProviderAccount.update({
            where: { id: providerId },
            data: { archivedAt: new Date() },
          });
        }
      });
      await entered;
      const pending =
        kind === 'endpoint-create'
          ? create()
          : kind === 'endpoint-update'
            ? service().updateProviderEndpoint(endpointId, adminId, {
                displayName: 'Abandoned',
              })
            : service().updateProviderAccount(providerId, adminId, {
                quotaPolicy: { changed: true },
              });
      void pending.catch(() => undefined);
      try {
        const deadline = Date.now() + 5000;
        let waiting = false;
        while (Date.now() < deadline) {
          const [row] = await db.$queryRaw<
            { count: bigint }[]
          >`SELECT count(*) FROM pg_stat_activity WHERE application_name=${applicationName} AND wait_event_type='Lock'`;
          if (Number(row.count)) {
            waiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waiting).toBe(true);
      } finally {
        release();
      }
      await holder;
      await expect(pending).rejects.toMatchObject({ status: 404 });
      expect(
        await db.aiProviderEndpoint.count({
          where: { providerAccountId: providerId },
        }),
      ).toBe(1);
      expect(
        (
          await db.aiProviderEndpoint.findUniqueOrThrow({
            where: { id: endpointId },
          })
        ).displayName,
      ).toBeNull();
      expect(
        (
          await db.aiProviderAccount.findUniqueOrThrow({
            where: { id: providerId },
          })
        ).quotaPolicy,
      ).toEqual({});
    },
  );
});
