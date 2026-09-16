import { postgresFixtureUrl } from '../../common/__tests__/postgres-fixture-url';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaService } from '../../infra/db/db.module';
import { AiModelOpsService } from './ai-model-ops.service';
import {
  CreateProviderEndpointSchema,
  CreateProviderBindingSchema,
} from './ai-model-ops.dto';
const databaseUrl =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.DATABASE_POSTGRES_INTEGRATION === '1'
    ? process.env.DATABASE_URL
    : undefined);
const integration = databaseUrl ? describe : describe.skip;
const applicationName = `route-admin-${randomUUID()}`;
jest.setTimeout(30000);
integration(
  'Route configuration administrator writes (owned PostgreSQL)',
  () => {
    let db: PrismaClient;
    let adminId: string;
    let providerId: string;
    let modelId: string;
    let slug: string;
    let endpointId: string;
    let bindingId: string;
    const service = (client: unknown = db) =>
      new AiModelOpsService(client as PrismaService, {} as never);
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
      adminId = randomUUID();
      slug = `fixture-${randomUUID()}`;
      providerId = (
        await db.aiProviderAccount.create({
          data: { provider: `fixture-${randomUUID()}` },
        })
      ).id;
      modelId = (
        await db.aiCanonicalModel.create({
          data: {
            slug: `existing-${randomUUID()}`,
            displayName: 'Fixture',
            family: 'fixture',
            modality: 'image',
          },
        })
      ).id;
      endpointId = (
        await db.aiProviderEndpoint.create({
          data: {
            providerAccountId: providerId,
            provider: 'fixture',
            endpointId: 'first',
            modality: 'image',
          },
        })
      ).id;
      const bound = await db.aiProviderEndpoint.create({
        data: {
          providerAccountId: providerId,
          provider: 'fixture',
          endpointId: 'bound',
          modality: 'image',
        },
      });
      bindingId = (
        await db.aiProviderModelBinding.create({
          data: {
            providerAccountId: providerId,
            providerEndpointId: bound.id,
            canonicalModelId: modelId,
            provider: 'fixture',
            endpointId: bound.endpointId,
            modality: 'image',
          },
        })
      ).id;
    });
    afterEach(async () => {
      await db.aiProviderModelBinding.deleteMany({
        where: { providerAccountId: providerId },
      });
      await db.aiProviderEndpoint.deleteMany({
        where: { providerAccountId: providerId },
      });
      await db.aiCanonicalModel.deleteMany({
        where: { OR: [{ id: modelId }, { slug }] },
      });
      await db.aiProviderAccount.delete({ where: { id: providerId } });
    });
    afterAll(async () => {
      await db?.$disconnect();
    });

    const write = (kind: string, client: unknown = db) => {
      const target = service(client);
      switch (kind) {
        case 'endpoint-create':
          return target.createProviderEndpoint(
            adminId,
            CreateProviderEndpointSchema.parse({
              providerAccountId: providerId,
              endpointId: slug,
              modality: 'image',
            }),
          );
        case 'endpoint-update':
          return target.updateProviderEndpoint(endpointId, adminId, {
            displayName: 'Changed',
          });
        case 'endpoint-archive':
          return target.archiveProviderEndpoint(endpointId, adminId);
        case 'binding-create':
          return target.createProviderBinding(
            adminId,
            CreateProviderBindingSchema.parse({
              providerEndpointId: endpointId,
              canonicalModelId: modelId,
            }),
          );
        default:
          return target.updateProviderBinding(bindingId, adminId, {
            priority: 99,
          });
      }
    };
    const snapshot = async () => ({
      endpoints: await db.aiProviderEndpoint.findMany({
        where: { providerAccountId: providerId },
        orderBy: { id: 'asc' },
      }),
      bindings: await db.aiProviderModelBinding.findMany({
        where: { providerAccountId: providerId },
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
      throw new Error('Expected route administration wait');
    };
    it.each(['endpoint-create', 'binding-create'])(
      'serializes duplicate %s without a second row',
      async (kind) => {
        const result = await Promise.allSettled([write(kind), write(kind)]);
        expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        const rejected = result.find((r) => r.status === 'rejected');
        expect(
          rejected?.status === 'rejected' ? rejected.reason : undefined,
        ).toMatchObject({ status: 400 });
      },
    );
    it('rejects a new binding after endpoint archival', async () => {
      await write('endpoint-archive');
      const before = await snapshot();
      await expect(write('binding-create')).rejects.toMatchObject({
        status: 400,
      });
      expect(await snapshot()).toEqual(before);
    });

    it('allows endpoint archival after route archival while preserving history and preventing stale restoration', async () => {
      const binding = await db.aiProviderModelBinding.findUniqueOrThrow({
        where: { id: bindingId },
      });
      await service().updateProviderBinding(bindingId, adminId, {
        status: 'archived',
      });
      const listed = await service().listProviderEndpoints({
        limit: 100,
        providerAccountId: providerId,
      });
      expect(
        listed.items.find((e) => e.id === binding.providerEndpointId)
          ?.bindingCount,
      ).toBe(0);
      await service().archiveProviderEndpoint(
        binding.providerEndpointId,
        adminId,
      );
      const before = await snapshot();
      expect(before.bindings.some((b) => b.id === bindingId)).toBe(true);
      await expect(
        service().updateProviderBinding(bindingId, adminId, {
          status: 'active',
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(await snapshot()).toEqual(before);
    });
    it('keeps unarchived bindings as endpoint archive blockers', async () => {
      const binding = await db.aiProviderModelBinding.findUniqueOrThrow({
        where: { id: bindingId },
      });
      const before = await snapshot();
      await expect(
        service().archiveProviderEndpoint(binding.providerEndpointId, adminId),
      ).rejects.toMatchObject({ status: 400 });
      expect(await snapshot()).toEqual(before);
    });
    it('restores an archived route when its dependencies remain available', async () => {
      await service().updateProviderBinding(bindingId, adminId, {
        status: 'archived',
      });
      await service().updateProviderBinding(bindingId, adminId, {
        status: 'active',
      });
      expect(
        (
          await db.aiProviderModelBinding.findUniqueOrThrow({
            where: { id: bindingId },
          })
        ).status,
      ).toBe('active');
    });
    it('rejects a canonical model edit after archival during its target wait', async () => {
      let release!: () => void;
      let ready!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const entered = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const holder = db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM ai_canonical_models WHERE id=${modelId}::uuid FOR UPDATE`;
        ready();
        await gate;
        await tx.aiCanonicalModel.update({
          where: { id: modelId },
          data: { archivedAt: new Date() },
        });
      });
      await entered;
      const pending = service().updateCanonicalModel(modelId, adminId, {
        displayName: 'Abandoned',
      });
      void pending.catch(() => undefined);
      try {
        await waitForLock();
      } finally {
        release();
      }
      await holder;
      await expect(pending).rejects.toMatchObject({ status: 404 });
      expect(
        (
          await db.aiCanonicalModel.findUniqueOrThrow({
            where: { id: modelId },
          })
        ).displayName,
      ).toBe('Fixture');
    });
    it.each(['provider', 'endpoint', 'model'])(
      'rejects restoration after %s archival during its dependency wait',
      async (kind) => {
        const binding = await db.aiProviderModelBinding.findUniqueOrThrow({
          where: { id: bindingId },
        });
        await service().updateProviderBinding(bindingId, adminId, {
          status: 'archived',
        });
        let release!: () => void;
        let ready!: () => void;
        const gate = new Promise<void>((r) => {
          release = r;
        });
        const entered = new Promise<void>((r) => {
          ready = r;
        });
        const holder = db.$transaction(async (tx) => {
          if (kind === 'provider')
            await tx.$queryRaw`SELECT id FROM ai_provider_accounts WHERE id=${providerId}::uuid FOR UPDATE`;
          else if (kind === 'endpoint')
            await tx.$queryRaw`SELECT id FROM ai_provider_endpoints WHERE id=${binding.providerEndpointId}::uuid FOR UPDATE`;
          else
            await tx.$queryRaw`SELECT id FROM ai_canonical_models WHERE id=${modelId}::uuid FOR UPDATE`;
          ready();
          await gate;
          if (kind === 'provider')
            await tx.aiProviderAccount.update({
              where: { id: providerId },
              data: { status: 'archived', archivedAt: new Date() },
            });
          else if (kind === 'endpoint')
            await tx.aiProviderEndpoint.update({
              where: { id: binding.providerEndpointId },
              data: { status: 'archived', archivedAt: new Date() },
            });
          else
            await tx.aiCanonicalModel.update({
              where: { id: modelId },
              data: { status: 'archived', archivedAt: new Date() },
            });
        });
        await entered;
        const pending = service().updateProviderBinding(bindingId, adminId, {
          status: 'active',
        });
        void pending.catch(() => undefined);
        try {
          await waitForLock();
        } finally {
          release();
        }
        await holder;
        const before = await snapshot();
        await expect(pending).rejects.toMatchObject({ status: 400 });
        expect(await snapshot()).toEqual(before);
        await expect(
          service().updateProviderBinding(bindingId, adminId, {
            status: 'archived',
          }),
        ).resolves.toHaveProperty('status', 'archived');
      },
    );
  },
);
