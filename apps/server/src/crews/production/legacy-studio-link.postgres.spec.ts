import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaService } from '../../infra/db/db.module';
import { CrewAuthorizationService } from '../crew-authorization.service';
import { WorkspacePermissionService } from '../../workspaces/workspace-permission.service';
import { CrewAssetsService } from '../assets/assets.service';
import { CrewAssetAccessService } from '../assets/asset-access.service';
import { CrewStudioWorkspaceService } from './studio-workspace.service';

const url =
  process.env.CREW_LEGACY_TEST_DATABASE_URL ||
  process.env.TASK01_TEST_DATABASE_URL ||
  (process.env.DATABASE_POSTGRES_INTEGRATION === '1'
    ? process.env.DATABASE_URL
    : undefined);
(url ? describe : describe.skip)('legacy Crew project compatibility', () => {
  let db: PrismaClient;
  const owner = randomUUID(),
    outsider = randomUUID();
  const crewId = randomUUID(),
    workspaceId = randomUUID();
  const projectId = randomUUID(),
    siblingId = randomUUID();
  let links: CrewStudioWorkspaceService;
  let assets: CrewAssetsService;
  beforeAll(async () => {
    const target = new URL(url!);
    if (
      !['postgres:', 'postgresql:'].includes(target.protocol) ||
      target.hostname !== '127.0.0.1' ||
      !['55439', '55440'].includes(target.port) ||
      target.pathname !== '/task01' ||
      [...target.searchParams.keys()].some((key) => key !== 'sslmode')
    )
      throw new Error('Owned local fixture required');
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const prisma = db as PrismaService;
    const auth = new CrewAuthorizationService(prisma);
    links = new CrewStudioWorkspaceService(prisma, auth);
    assets = new CrewAssetsService(
      prisma,
      new WorkspacePermissionService(prisma),
      auth,
      new CrewAssetAccessService(prisma, auth),
      {
        forProvider: () => ({ isHealthy: () => Promise.resolve(true) }),
      } as never,
      {} as never,
      {} as never,
    );
    await db.workspace.create({
      data: {
        id: workspaceId,
        name: 'Legacy workspace',
        ownerUserId: owner,
        createdById: owner,
      },
    });
    await db.workspaceMember.create({
      data: { workspaceId, userId: owner, role: 'owner' },
    });
    await db.platformProject.createMany({
      data: [projectId, siblingId].map((id) => ({
        id,
        workspaceId,
        name: 'Legacy canvas',
        createdById: owner,
      })),
    });
    await db.crew.create({
      data: {
        id: crewId,
        name: 'Legacy Crew',
        description: '',
        logo: '/legacy-fixture.png',
        createdByUserId: owner,
        studioProjectId: projectId,
      },
    });
    const member = await db.crewMember.create({
      data: {
        id: randomUUID(),
        crewId,
        userId: owner,
        joinedVia: 'invitation',
      },
    });
    await db.crewOwnership.create({ data: { crewId, memberId: member.id } });
  });
  afterAll(async () => {
    if (!db) return;
    try {
      await db.crew.deleteMany({ where: { id: crewId } });
      await db.workspace.deleteMany({ where: { id: workspaceId } });
    } finally {
      await db.$disconnect();
    }
  });
  it('retains only the original Canvas context without workspace sharing or save-back', async () => {
    const original = await assets.projectContext(projectId, owner);
    expect(original.crew?.id).toBe(crewId);
    expect(original.canSaveFromCanvas).toBe(false);
    expect((await assets.projectContext(siblingId, owner)).crew).toBeNull();
    await expect(assets.projectContext(projectId, outsider)).rejects.toThrow();
    const stored = await db.crew.findUniqueOrThrow({ where: { id: crewId } });
    expect(stored.studioProjectId).toBe(projectId);
    expect(stored.studioWorkspaceId).toBeNull();
    expect(
      (
        await assets.listForProject(projectId, owner, {
          source: 'all',
          sort: 'modified',
        })
      ).items,
    ).toEqual([]);
    await expect(
      assets.listForProject(siblingId, owner, {
        source: 'all',
        sort: 'modified',
      }),
    ).rejects.toThrow();
    await db.crew.update({
      where: { id: crewId },
      data: { deletedAt: new Date() },
    });
    try {
      expect((await assets.projectContext(projectId, owner)).crew).toBeNull();
    } finally {
      await db.crew.update({
        where: { id: crewId },
        data: { deletedAt: null },
      });
    }
  });
  it('requires authorized upgrade and records replacement of the legacy project', async () => {
    await expect(links.link(crewId, outsider, workspaceId)).rejects.toThrow();
    await links.link(crewId, owner, workspaceId);
    const stored = await db.crew.findUniqueOrThrow({ where: { id: crewId } });
    expect(stored.studioProjectId).toBeNull();
    expect(stored.studioWorkspaceId).toBe(workspaceId);
    expect((await assets.projectContext(siblingId, owner)).crew?.id).toBe(
      crewId,
    );
    const event = await db.crewProductionActivity.findFirstOrThrow({
      where: { crewId },
    });
    expect(event.payload).toHaveProperty('changes');
    expect((event.payload as { changes: unknown[] }).changes).toContainEqual({
      field: 'studio_project_id',
      from: projectId,
      to: null,
    });
    await links.link(crewId, owner, workspaceId);
    expect(await db.crewProductionActivity.count({ where: { crewId } })).toBe(
      1,
    );
  });
  it('audits legacy-only disconnect and never restores it on later unlink', async () => {
    await db.crew.update({
      where: { id: crewId },
      data: { studioWorkspaceId: null, studioProjectId: projectId },
    });
    await db.crewProductionActivity.deleteMany({ where: { crewId } });
    await links.link(crewId, owner, null);
    expect((await assets.projectContext(projectId, owner)).crew).toBeNull();
    const event = await db.crewProductionActivity.findFirstOrThrow({
      where: { crewId },
    });
    expect(event.payload).toHaveProperty('changes');
    expect((event.payload as { changes: unknown[] }).changes).toContainEqual({
      field: 'studio_project_id',
      from: projectId,
      to: null,
    });
    await links.link(crewId, owner, workspaceId);
    await links.link(crewId, owner, null);
    expect((await assets.projectContext(projectId, owner)).crew).toBeNull();
  });
});
