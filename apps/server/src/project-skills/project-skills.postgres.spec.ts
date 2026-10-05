import { randomUUID } from 'node:crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { ProjectSkillsService } from './project-skills.service';
import { ProjectSkillsResolver } from './project-skills.resolver';
import { WorkspacePermissionService } from '../workspaces/workspace-permission.service';
import type { PrismaService } from '../infra/db/db.module';

const url = process.env.PROJECT_SKILLS_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('Project Skill receipt replay PostgreSQL', () => {
  let db: PrismaClient;
  let service: ProjectSkillsService;
  let workspaceId: string;
  let skillId: string;
  let versionId: string;
  const actor = `skill-test-${randomUUID()}`;
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
    const prisma = db as unknown as PrismaService;
    service = new ProjectSkillsService(
      prisma,
      new WorkspacePermissionService(prisma),
      {} as never,
      new ProjectSkillsResolver(prisma),
    );
    workspaceId = (
      await db.workspace.create({
        data: {
          name: 'Skill receipt fixture',
          ownerUserId: actor,
          createdById: actor,
        },
      })
    ).id;
    await db.workspaceMember.create({
      data: { workspaceId, userId: actor, role: 'admin' },
    });
    skillId = (
      await db.skillCatalogItem.create({
        data: {
          slug: randomUUID(),
          name: 'Receipt fixture',
          description: 'Local fixture',
          publisherName: 'Fixture',
          category: 'custom',
          kind: 'general',
          workspaceId,
        },
      })
    ).id;
    // The fixture directly seeds an installation; catalog publication is not
    // under test. Keep its version draft so cleanup respects immutable versions.
    versionId = (
      await db.skillVersion.create({
        data: {
          skillId,
          version: '1.0.0',
          manifestSchemaVersion: 'fizzdragon.skill/v1',
          instructions: 'Fixture',
          checksum: 'a'.repeat(64),
          configSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {},
          },
          capabilities: ['image_generation'],
          projectKinds: ['platform'],
        },
      })
    ).id;
  });
  afterAll(async () => {
    if (!db) return;
    if (workspaceId) {
      await db.projectSkillState.deleteMany({ where: { workspaceId } });
      await db.projectSkillAudit.deleteMany({ where: { workspaceId } });
      await db.projectSkillInstallation.deleteMany({ where: { workspaceId } });
    }
    if (versionId) await db.skillVersion.delete({ where: { id: versionId } });
    if (skillId) await db.skillCatalogItem.delete({ where: { id: skillId } });
    if (workspaceId) await db.workspace.delete({ where: { id: workspaceId } });
    await db.$disconnect();
  });
  const seed = async () => {
    const project = await db.platformProject.create({
      data: {
        workspaceId,
        name: 'Fixture project',
        createdById: actor,
      },
    });
    const installation = await db.projectSkillInstallation.create({
      data: {
        workspaceId,
        platformProjectId: project.id,
        skillId,
        pinnedVersionId: versionId,
        installedByUserId: actor,
        updatedByUserId: actor,
      },
    });
    return { project, installation };
  };
  it.each(['update', 'defaults'] as const)(
    'replays %s after later uninstall without resurrecting it',
    async (operation) => {
      const { project, installation } = await seed();
      const key = randomUUID();
      const perform = () =>
        operation === 'update'
          ? service.update(
              { userId: actor },
              'platform',
              project.id,
              installation.id,
              {
                expectedRevision: 0,
                expectedProjectRevision: 0,
                idempotencyKey: key,
                config: {},
              },
            )
          : service.setDefaults(
              { userId: actor },
              'platform',
              project.id,
              'image_generation',
              {
                expectedProjectRevision: 0,
                idempotencyKey: key,
                installationIds: [installation.id],
              },
            );
      const first = await perform();
      await service.uninstall(
        { userId: actor },
        'platform',
        project.id,
        installation.id,
        {
          expectedRevision: operation === 'update' ? 1 : 0,
          expectedProjectRevision: 1,
          idempotencyKey: randomUUID(),
        },
      );
      await expect(perform()).resolves.toEqual(first);
      expect(
        await db.projectSkillInstallation.count({
          where: { id: installation.id },
        }),
      ).toBe(0);
      expect(
        await db.projectSkillState.findUnique({
          where: { platformProjectId: project.id },
        }),
      ).toMatchObject({ revision: 2 });
      expect(
        await db.projectSkillAudit.count({
          where: { platformProjectId: project.id },
        }),
      ).toBe(2);
      expect(
        await db.projectSkillMutation.count({
          where: { workspaceId, idempotencyKey: key },
        }),
      ).toBe(1);
    },
  );
  it('returns one receipt for concurrent identical updates', async () => {
    const { project, installation } = await seed();
    const body = {
      expectedRevision: 0,
      expectedProjectRevision: 0,
      idempotencyKey: randomUUID(),
      config: {},
    };
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        service.update(
          { userId: actor },
          'platform',
          project.id,
          installation.id,
          body,
        ),
      ),
    );
    expect(results).toEqual(Array(4).fill(results[0]));
    expect(
      await db.projectSkillState.findUnique({
        where: { platformProjectId: project.id },
      }),
    ).toMatchObject({ revision: 1 });
    expect(
      await db.projectSkillAudit.count({
        where: { platformProjectId: project.id },
      }),
    ).toBe(1);
    await expect(
      service.update(
        { userId: actor },
        'platform',
        project.id,
        installation.id,
        { ...body, status: 'disabled' },
      ),
    ).rejects.toMatchObject({
      response: { code: 'PROJECT_SKILL_IDEMPOTENCY_CONFLICT' },
    });
    await expect(
      service.update(
        { userId: 'outsider' },
        'platform',
        project.id,
        installation.id,
        body,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('replays a duplicate crossing the initial empty receipt read', async () => {
    const { project, installation } = await seed();
    const body = {
      expectedRevision: 0,
      expectedProjectRevision: 0,
      idempotencyKey: randomUUID(),
      config: {},
    };
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const instrumented = new Proxy(db, {
      get(target, key) {
        if (key === '$transaction')
          return (run: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
            target.$transaction(
              (tx) =>
                run(
                  new Proxy(tx, {
                    get(client, property) {
                      if (property === 'projectSkillMutation')
                        return new Proxy(client.projectSkillMutation, {
                          get(delegate, method) {
                            if (method === 'findUnique')
                              return async (
                                args: Prisma.ProjectSkillMutationFindUniqueArgs,
                              ) => {
                                const result = await delegate.findUnique(args);
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
    }) as unknown as PrismaService;
    const firstService = new ProjectSkillsService(
      instrumented,
      new WorkspacePermissionService(instrumented),
      {} as never,
      new ProjectSkillsResolver(instrumented),
    );
    const target = new URL(url!);
    const applicationName = `skill-retry-${randomUUID()}`;
    target.searchParams.set('application_name', applicationName);
    const secondDb = new PrismaClient({
      adapter: new PrismaPg({ connectionString: target.toString() }),
    });
    const secondPrisma = secondDb as unknown as PrismaService;
    const secondService = new ProjectSkillsService(
      secondPrisma,
      new WorkspacePermissionService(secondPrisma),
      {} as never,
      new ProjectSkillsResolver(secondPrisma),
    );
    const perform = (instance: ProjectSkillsService) =>
      instance
        .update(
          { userId: actor },
          'platform',
          project.id,
          installation.id,
          body,
        )
        .then(
          (result) => ({ ok: true, result }),
          (error: unknown) => ({ ok: false, error }),
        );
    const first = perform(firstService);
    let second: ReturnType<typeof perform> | undefined;
    try {
      await Promise.race([
        started,
        first.then((result) => {
          throw new Error(
            `First request finished before barrier: ${JSON.stringify(result)}`,
          );
        }),
      ]);
      let settled = false;
      second = perform(secondService).finally(() => {
        settled = true;
      });
      const deadline = Date.now() + 3000;
      while (!settled) {
        const [row] = await db.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*) FROM pg_stat_activity
          WHERE application_name=${applicationName} AND wait_event_type='Lock'
        `;
        if (Number(row.count)) break;
        if (Date.now() > deadline)
          throw new Error(
            'Duplicate did not finish or reach its lock boundary.',
          );
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } finally {
      release();
      await Promise.all([first, second]);
      await secondDb.$disconnect();
    }
    const results = await Promise.all([first, second]);
    expect(results).toEqual([
      { ok: true, result: expect.any(Object) as unknown },
      { ok: true, result: expect.any(Object) as unknown },
    ]);
    expect(results[1]).toEqual(results[0]);
    expect(
      await db.projectSkillState.findUnique({
        where: { platformProjectId: project.id },
      }),
    ).toMatchObject({ revision: 1 });
    expect(
      await db.projectSkillAudit.count({
        where: { platformProjectId: project.id },
      }),
    ).toBe(1);
  }, 20000);
});
