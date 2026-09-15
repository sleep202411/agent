import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaClient, type CreatorService, type Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { workspaceTestDatabase } from '../crews/production/__tests__/workspace-test-database';
import { CreatorServicesService } from './creator-services.service';
import { CreateServiceSchema } from './dto';
const url = workspaceTestDatabase(process.env);
const applicationName = `service-write-${randomUUID()}`;
jest.setTimeout(15000);
(url ? describe : describe.skip)(
  'Creator-service writes (owned PostgreSQL)',
  () => {
    let db: PrismaClient,
      svc: CreatorServicesService,
      owner: string,
      id: string;
    beforeAll(() => {
      db = new PrismaClient({
        adapter: new PrismaPg({
          connectionString: url,
          application_name: applicationName,
        }),
        transactionOptions: { timeout: 10000 },
      });
      svc = new CreatorServicesService(db as never);
    });
    beforeEach(async () => {
      owner = randomUUID();
      const service = await svc.create(
        owner,
        CreateServiceSchema.parse({
          title: 'Fixture',
          summary: 'Concurrent service writes',
          category: 'other',
          packages: [
            {
              tier: 'basic',
              title: 'Basic',
              description: 'Fixture',
              currency: 'CNY',
              price: 10,
              deliveryDays: 1,
            },
          ],
          requirementQuestions: [{ prompt: 'Brief' }],
        }),
      );
      id = service.id;
    });
    afterEach(async () => {
      jest.restoreAllMocks();
      await db.creatorService.deleteMany({ where: { creatorId: owner } });
    });
    afterAll(async () => {
      await db.$disconnect();
    });
    async function competing<T, U>(
      firstAction: () => Promise<T>,
      secondAction: () => Promise<U>,
    ) {
      let admitted!: () => void, release!: () => void;
      const firstAdmitted = new Promise<void>((resolve) => {
        admitted = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const target = svc as unknown as {
        requireOwned: (
          id: string,
          actor: string,
          tx: Prisma.TransactionClient,
        ) => Promise<CreatorService>;
      };
      const original = target.requireOwned.bind(
        svc,
      ) as typeof target.requireOwned;
      let first = true;
      jest.spyOn(target, 'requireOwned').mockImplementation(async (...args) => {
        const row = await original(...args);
        if (first) {
          first = false;
          admitted();
          await gate;
        }
        return row;
      });
      const a = firstAction();
      await firstAdmitted;
      const b = secondAction();
      const results = Promise.allSettled([a, b]);
      try {
        const deadline = Date.now() + 5000;
        let waiting = false;
        while (Date.now() < deadline) {
          const rows = await db.$queryRaw<
            Array<{ waiting: boolean }>
          >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name = ${applicationName} AND wait_event_type = 'Lock') AS waiting`;
          if (rows[0]?.waiting) {
            waiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waiting).toBe(true);
      } finally {
        release();
        await results;
      }
      return results;
    }
    it('admits only one competing save with the same expected version', async () => {
      const results = await competing(
        () =>
          svc.update(id, owner, { title: 'First writer', expectedVersion: 0 }),
        () =>
          svc.update(id, owner, { title: 'Stale writer', expectedVersion: 0 }),
      );
      expect(results[0].status).toBe('fulfilled');
      expect(results[1]).toMatchObject({
        status: 'rejected',
        reason: expect.any(ConflictException) as unknown,
      });
      expect(
        await db.creatorService.findUnique({ where: { id } }),
      ).toMatchObject({ title: 'First writer', version: 1 });
    });
    it('prevents a queued update from modifying an archived service', async () => {
      const results = await competing(
        () => svc.archive(id, owner),
        () => svc.update(id, owner, { title: 'Revived' }),
      );
      expect(results[1]).toMatchObject({
        status: 'rejected',
        reason: expect.any(NotFoundException) as unknown,
      });
      expect(
        await db.creatorService.findUnique({ where: { id } }),
      ).toMatchObject({ title: 'Fixture', status: 'archived', version: 1 });
    });
    it('does not repeat a publish transition after waiting for the first publisher', async () => {
      const results = await competing(
        () => svc.publish(id, owner),
        () => svc.publish(id, owner),
      );
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      expect(
        await db.creatorService.findUnique({ where: { id } }),
      ).toMatchObject({ status: 'listed', version: 1 });
    });
    it('reads current packages after a competing draft edit before publication', async () => {
      const results = await competing(
        () => svc.update(id, owner, { packages: [] }),
        () => svc.publish(id, owner),
      );
      expect(results[1]).toMatchObject({
        status: 'rejected',
        reason: expect.any(BadRequestException) as unknown,
      });
      expect(
        await db.creatorService.findUnique({ where: { id } }),
      ).toMatchObject({ status: 'draft', version: 1 });
    });
    it('orders pause and resume against the committed status', async () => {
      await svc.publish(id, owner);
      const results = await competing(
        () => svc.pause(id, owner),
        () => svc.resume(id, owner),
      );
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      expect(
        await db.creatorService.findUnique({ where: { id } }),
      ).toMatchObject({ status: 'listed', version: 3 });
    });
    it('preserves ownership and missing-service denials', async () => {
      await expect(
        svc.update(id, randomUUID(), { title: 'Intruder' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.publish(randomUUID(), owner)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(
        await db.creatorService.findUnique({ where: { id } }),
      ).toMatchObject({ version: 0 });
    });
    it('rolls back title, version and child replacement when question validation fails', async () => {
      const before = await svc.detail(id, owner);
      const q = before.requirementQuestions[0];
      await expect(
        svc.update(id, owner, {
          title: 'Must rollback',
          packages: [],
          requirementQuestions: [q, q],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(await svc.detail(id, owner)).toEqual(before);
    });
  },
);
