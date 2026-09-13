import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  CREW_PERMISSION_KEYS,
  CREW_OWNER_ONLY_PERMISSIONS,
} from '@repo/shared';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../../infra/db/db.module';
import { WorkspacePermissionService } from '../../workspaces/workspace-permission.service';
import { CrewAuthorizationService } from '../crew-authorization.service';
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

  it.each([
    'crew',
    'project',
    'workspace',
    'after-write',
    'authorized',
  ] as const)(
    '%s authority preserves the link and activity transaction',
    async (mode) => {
      const crewId = randomUUID(),
        ownerId = randomUUID(),
        actorId = randomUUID(),
        memberId = randomUUID();
      const workspaceId = randomUUID(),
        projectId = randomUUID();
      let unlock: () => void = () => {};
      let holder: Promise<unknown> | undefined;
      let result: Promise<{ value?: unknown; error?: unknown }> | undefined;
      const broadcast = jest.fn().mockResolvedValue(undefined);
      try {
        await db.crew.create({
          data: {
            id: crewId,
            name: 'Link fixture',
            description: '',
            logo: 'fixture',
            createdByUserId: ownerId,
          },
        });
        await db.crewMember.create({
          data: {
            id: memberId,
            crewId,
            userId: actorId,
            joinedVia: 'invitation',
          },
        });
        await db.crewOwnership.create({ data: { crewId, memberId } });
        await db.workspace.create({
          data: {
            id: workspaceId,
            type: 'team',
            name: 'Link fixture',
            ownerUserId: ownerId,
            createdById: ownerId,
          },
        });
        await db.platformProject.create({
          data: {
            id: projectId,
            workspaceId,
            name: 'Linked project',
            createdById: ownerId,
          },
        });
        if (mode === 'workspace') {
          await db.workspaceMember.create({
            data: {
              workspaceId,
              userId: actorId,
              role: 'editor',
              invitedById: ownerId,
            },
          });
        } else {
          await db.projectMember.create({
            data: {
              projectId,
              userId: actorId,
              role: 'editor',
              grantedById: ownerId,
            },
          });
        }
        const client =
          mode === 'after-write'
            ? db.$extends({
                query: {
                  crew: {
                    async update({ args, query }) {
                      const value = await query(args);
                      await db.projectMember.updateMany({
                        where: { projectId, userId: actorId },
                        data: { role: 'viewer' },
                      });
                      return value;
                    },
                  },
                },
              })
            : db;
        const service = new CrewProductionService(
          client as PrismaService,
          new CrewAuthorizationService(db as PrismaService),
          {} as never,
          { broadcastCrewTaskProjectChange: broadcast } as never,
          new WorkspacePermissionService(db as PrismaService),
        );
        let ready!: (pid: number) => void;
        const entered = new Promise<number>((resolve) => {
          ready = resolve;
        });
        const release = new Promise<void>((resolve) => {
          unlock = resolve;
        });
        holder = db.$transaction(
          async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`crew:studio-project:${crewId}`})::bigint)`;
            const [row] = await tx.$queryRaw<
              Array<{ pid: number }>
            >`SELECT pg_backend_pid() AS pid`;
            ready(row.pid);
            await release;
          },
          { timeout: 15000 },
        );
        const pid = await entered;
        result = service.linkStudioProject(crewId, actorId, { projectId }).then(
          (value) => ({ value }),
          (error) => ({ error: error as unknown }),
        );
        let waiting = false;
        for (let i = 0; i < 200; i++) {
          const [row] = await db.$queryRaw<
            Array<{ waiting: boolean }>
          >`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))) AS waiting`;
          if (row.waiting) {
            waiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waiting).toBe(true);
        if (mode === 'crew')
          await db.crewMember.update({
            where: { id: memberId },
            data: { status: 'removed', removedAt: new Date() },
          });
        if (mode === 'project')
          await db.projectMember.updateMany({
            where: { projectId, userId: actorId },
            data: { role: 'viewer' },
          });
        if (mode === 'workspace')
          await db.workspaceMember.updateMany({
            where: { workspaceId, userId: actorId },
            data: { role: 'viewer' },
          });
        unlock();
        await holder;
        const outcome = await result;
        const crew = await db.crew.findUniqueOrThrow({ where: { id: crewId } });
        const activities = await db.crewProductionActivity.count({
          where: { crewId },
        });
        if (mode === 'authorized') {
          expect(outcome).toHaveProperty('value');
          expect(crew.studioProjectId).toBe(projectId);
          expect(activities).toBe(1);
          expect(broadcast).toHaveBeenCalledTimes(1);
        } else {
          expect(outcome).toMatchObject({ error: { status: 403 } });
          expect(crew.studioProjectId).toBeNull();
          expect(activities).toBe(0);
          expect(broadcast).not.toHaveBeenCalled();
        }
      } finally {
        unlock();
        await holder;
        await result;
        await db.crewOwnership.deleteMany({ where: { crewId } });
        await db.crew.deleteMany({ where: { id: crewId } });
        await db.workspace.deleteMany({ where: { id: workspaceId } });
      }
    },
    20000,
  );
});
