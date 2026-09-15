import { CrewAuthorizationService } from '../crew-authorization.service';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  CREW_PERMISSION_KEYS,
  CREW_OWNER_ONLY_PERMISSIONS,
} from '@repo/shared';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../../infra/db/db.module';
import { CrewProductionService } from './production.service';

const databaseUrl =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.DATABASE_POSTGRES_INTEGRATION === '1'
    ? process.env.DATABASE_URL
    : undefined);
const suite = databaseUrl ? describe : describe.skip;
suite('Studio linking authorization on PostgreSQL', () => {
  let db: PrismaClient;
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !(
        (url.port === '5433' && url.pathname === '/fizzdragon_outbox_test') ||
        (url.port === '55439' && url.pathname === '/task01') ||
        (url.port === '55459' && url.pathname === '/develop_selection_test')
      )
    )
      throw new Error('Explicitly allowed loopback test database required');
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl }),
      transactionOptions: { timeout: 15000 },
    });
    await db.$connect();
  });
  afterAll(async () => {
    await db?.$disconnect();
  });

  it('stores every assignable permission but rejects unknown and owner-only overrides', async () => {
    const crewId = randomUUID(),
      memberId = randomUUID(),
      actorId = randomUUID();
    try {
      await db.crew.create({
        data: {
          id: crewId,
          name: 'Permission fixture',
          description: '',
          logo: 'fixture',
          createdByUserId: actorId,
        },
      });
      await db.crewMember.create({
        data: { id: memberId, crewId, userId: actorId, joinedVia: 'creation' },
      });
      const ownerOnly = new Set<string>(CREW_OWNER_ONLY_PERMISSIONS);
      const keys = CREW_PERMISSION_KEYS.filter((key) => !ownerOnly.has(key));
      for (const permissionKey of [...keys, 'finance.view', 'finance.settle']) {
        await db.crewMemberPermissionOverride.create({
          data: {
            memberId,
            permissionKey,
            effect: 'allow',
            changedByUserId: actorId,
          },
        });
      }
      const context = await new CrewAuthorizationService(
        db as PrismaService,
      ).requireMembership(crewId, actorId);
      expect(context.permissions).toEqual(expect.arrayContaining(keys));
      expect(context.permissions).not.toContain('finance.view');
      expect(context.permissions).not.toContain('finance.settle');
      for (const permissionKey of [
        ...CREW_OWNER_ONLY_PERMISSIONS,
        'unknown.permission',
      ]) {
        await expect(
          db.crewMemberPermissionOverride.create({
            data: {
              memberId,
              permissionKey,
              effect: 'allow',
              changedByUserId: actorId,
            },
          }),
        ).rejects.toThrow();
      }
      expect(
        await db.crewMemberPermissionOverride.count({ where: { memberId } }),
      ).toBe(keys.length + 2);
    } finally {
      await db.crew.deleteMany({ where: { id: crewId } });
    }
  });

  it('rejects legacy project-link writes without changing data', async () => {
    const service = new CrewProductionService(
      db as PrismaService,
      { require: jest.fn().mockResolvedValue({}) } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(
      service.linkStudioProject(randomUUID(), randomUUID(), {
        projectId: randomUUID(),
      }),
    ).rejects.toThrow('Single-project linking has been replaced');
  });
});
