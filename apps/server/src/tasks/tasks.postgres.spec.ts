import { randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { TasksService } from './tasks.service';
import type { PrismaService } from '../infra/db/db.module';
import type { AiGenerationService } from '../ai-generation/ai-generation.service';
import type { AgentOsProjectContextService } from '../agent-os-gateway/agent-os-project-context.service';
import type { AuthUser } from '../auth';
const databaseUrl =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.DATABASE_POSTGRES_INTEGRATION === '1'
    ? process.env.DATABASE_URL
    : undefined);
(databaseUrl ? describe : describe.skip)(
  'recent task ownership (PostgreSQL)',
  () => {
    let db: PrismaClient;
    let service: TasksService;
    const owner = `task-owner-${randomUUID()}`;
    const other = `task-other-${randomUUID()}`;
    const projectId = randomUUID();
    const projects = { requireRead: jest.fn() };
    beforeAll(async () => {
      const url = postgresFixtureUrl(databaseUrl!);
      if (
        !['localhost', '127.0.0.1'].includes(url.hostname) ||
        !(
          (url.port === '55439' && url.pathname === '/task01') ||
          (url.port === '5433' && url.pathname === '/fizzdragon_outbox_test')
        )
      )
        throw new Error('Named loopback fixture required');
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: databaseUrl }),
      });
      await db.$connect();
      service = new TasksService(
        db as PrismaService,
        {
          listJobs: () => Promise.resolve({ jobs: [] }),
        } as unknown as AiGenerationService,
        projects as unknown as AgentOsProjectContextService,
      );
      const at = new Date('2026-09-15T00:00:00Z');
      await db.agentOsRun.createMany({
        data: [owner, owner, other].map((actorId) => ({
          id: randomUUID(),
          projectId,
          conversationId: randomUUID(),
          actorId,
          modelProfileId: 'fixture',
          status: 'waiting_for_input',
          projectKind: 'platform',
          workbenchMode: 'canvas',
          createdAt: at,
          updatedAt: at,
        })),
      });
    });
    afterAll(async () => {
      if (!db) return;
      try {
        await db.agentOsRun.deleteMany({
          where: { actorId: { in: [owner, other] } },
        });
      } finally {
        await db.$disconnect();
      }
    });
    it('returns only the authenticated actor and stable tied ordering', async () => {
      projects.requireRead.mockResolvedValue({ projectKind: 'platform' });
      const tasks = await service.list({ userId: owner } as AuthUser);
      expect(tasks).toHaveLength(2);
      expect(tasks.every((task) => task.status === 'waiting')).toBe(true);
      expect(
        (await service.list({ userId: owner } as AuthUser)).map(
          (task) => task.id,
        ),
      ).toEqual(tasks.map((task) => task.id));
      const foreign = await db.agentOsRun.findFirstOrThrow({
        where: { actorId: other },
      });
      expect(tasks.some((task) => task.remoteId === foreign.id)).toBe(false);
    });
    it('does not return the owner records after project access is denied', async () => {
      projects.requireRead.mockRejectedValue(new ForbiddenException());
      await expect(
        service.list({ userId: owner } as AuthUser),
      ).resolves.toEqual([]);
    });
  },
);
