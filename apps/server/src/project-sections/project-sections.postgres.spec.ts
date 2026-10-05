import { randomUUID } from 'node:crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { ProjectSectionsService } from './project-sections.service';
import { createProjectSectionWithCanvas } from './project-section.persistence';
import { WorkspacePermissionService } from '../workspaces/workspace-permission.service';
import { PlatformAuditLogService } from '../workspaces/audit-log.service';
import type { PrismaService } from '../infra/db/db.module';

const url = process.env.PROJECT_SECTIONS_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('Project chapter concurrency PostgreSQL', () => {
  let db: PrismaClient;
  let renameDb: PrismaClient;
  let workspaceId: string;
  const actor = `section-test-${randomUUID()}`;
  const applicationName = `chapter-rename-${randomUUID()}`;

  beforeAll(async () => {
    const target = new URL(url!);
    if (
      target.hostname !== '127.0.0.1' ||
      target.port !== '55439' ||
      target.pathname !== '/task01' ||
      target.search
    ) {
      throw new Error('Use the owned local task01 fixture on 127.0.0.1:55439.');
    }
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    target.searchParams.set('application_name', applicationName);
    renameDb = new PrismaClient({
      adapter: new PrismaPg({ connectionString: target.toString() }),
    });
    workspaceId = (
      await db.workspace.create({
        data: {
          name: 'Chapter concurrency fixture',
          ownerUserId: actor,
          createdById: actor,
        },
      })
    ).id;
    await db.workspaceMember.create({
      data: { workspaceId, userId: actor, role: 'editor' },
    });
  });

  afterAll(async () => {
    if (!db) return;
    if (workspaceId) {
      await db.aiEventOutbox.deleteMany({ where: { userId: actor } });
      await db.studioDocument.deleteMany({ where: { workspaceId } });
      await db.workspace.delete({ where: { id: workspaceId } });
    }
    await renameDb?.$disconnect();
    await db.$disconnect();
  });

  it('saves a rename overlapping a reorder without deadlock or lost chapter data', async () => {
    const project = await db.platformProject.create({
      data: {
        workspaceId,
        name: 'Fixture',
        createdById: actor,
      },
    });
    const sections = await db.$transaction(async (tx) => {
      const one = await createProjectSectionWithCanvas(tx, {
        workspaceId,
        projectId: project.id,
        title: 'One',
        rank: 0,
        actorId: actor,
      });
      const two = await createProjectSectionWithCanvas(tx, {
        workspaceId,
        projectId: project.id,
        title: 'Two',
        rank: 1,
        actorId: actor,
      });
      return [one, two];
    });
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    // Pause real reorder after its project update; all reads/writes and locks
    // remain actual PostgreSQL operations, including the concurrent rename.
    const reorderDb = new Proxy(db, {
      get(target, key) {
        if (key === '$transaction')
          return (run: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
            target.$transaction(
              async (tx) =>
                run(
                  new Proxy(tx, {
                    get(client, property) {
                      if (property === 'platformProject')
                        return new Proxy(client.platformProject, {
                          get(delegate, method) {
                            if (method === 'updateMany')
                              return async (
                                args: Prisma.PlatformProjectUpdateManyArgs,
                              ) => {
                                const result = await delegate.updateMany(args);
                                ready();
                                await gate;
                                return result;
                              };
                            return Reflect.get(delegate, method) as unknown;
                          },
                        });
                      return Reflect.get(client, property) as unknown;
                    },
                  }),
                ),
              { timeout: 15000 },
            );
        return Reflect.get(target, key) as unknown;
      },
    });
    const serviceFor = (client: PrismaClient) => {
      const prisma = client as unknown as PrismaService;
      return new ProjectSectionsService(
        prisma,
        new WorkspacePermissionService(prisma),
        new PlatformAuditLogService(prisma),
      );
    };
    const reordering = serviceFor(reorderDb)
      .reorder({ userId: actor }, project.id, {
        expectedProjectVersion: project.version,
        sectionIds: [sections[1].section.id, sections[0].section.id],
      })
      .then(
        () => ({ ok: true }),
        (error: unknown) => ({ ok: false, error }),
      );
    await Promise.race([
      started,
      reordering.then((outcome) => {
        throw new Error(
          `Reorder finished before barrier: ${JSON.stringify(outcome)}`,
        );
      }),
    ]);
    const renaming = serviceFor(renameDb)
      .update({ userId: actor }, project.id, sections[0].section.id, {
        expectedVersion: sections[0].section.version,
        title: 'Renamed',
      })
      .then(
        () => ({ ok: true }),
        (error: unknown) => ({ ok: false, error }),
      );
    try {
      const deadline = Date.now() + 3000;
      while (true) {
        const [row] = await db.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*) FROM pg_stat_activity
          WHERE application_name=${applicationName} AND wait_event_type='Lock'
        `;
        if (Number(row.count)) break;
        if (Date.now() > deadline)
          throw new Error('Rename did not reach the concurrent lock boundary.');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } finally {
      release();
    }
    const outcomes = await Promise.all([reordering, renaming]);
    expect(outcomes).toEqual([{ ok: true }, { ok: true }]);
    const result = await serviceFor(db).list({ userId: actor }, project.id);
    expect(result.projectVersion).toBe(project.version + 2);
    expect(result.sections.map(({ title, rank }) => ({ title, rank }))).toEqual(
      [
        { title: 'Two', rank: 0 },
        { title: 'Renamed', rank: 1 },
      ],
    );
    expect(
      await db.studioDocument.findUnique({
        where: { id: sections[0].canvas.id },
      }),
    ).toMatchObject({ title: 'Renamed' });
  }, 20000);
});
