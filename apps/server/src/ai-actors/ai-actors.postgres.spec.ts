import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { AiActorsService } from './ai-actors.service';
import { WorkspacePermissionService } from '../workspaces/workspace-permission.service';
import type { PrismaService } from '../infra/db/db.module';
import type { AdminActor } from '../admin-auth/admin-auth.types';
const url = process.env.AI_ACTOR_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('AI Actors PostgreSQL', () => {
  let db: PrismaClient, service: AiActorsService, admin: AdminActor;
  let workspaceId: string,
    projectId: string,
    actorId: string,
    photoAssetId: string;
  const editor = `actor-editor-${randomUUID()}`;
  beforeAll(async () => {
    const target = new URL(url!);
    if (
      target.hostname !== '127.0.0.1' ||
      !(
        (target.port === '55193' && target.pathname === '/ai_actor_review') ||
        (target.port === '55439' && target.pathname === '/task01')
      ) ||
      target.search
    )
      throw new Error(
        'Use an owned local fixture: ai_actor_review on port 55193 or task01 on port 55439.',
      );
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const prisma = db as unknown as PrismaService;
    service = new AiActorsService(
      prisma,
      new WorkspacePermissionService(prisma),
    );
    const user = await db.adminUser.create({
      data: {
        email: `${randomUUID()}@actor.test`,
        displayName: 'Actor test admin',
        status: 'active',
        passwordHash: 'test-only-unusable-hash',
      },
    });
    admin = { id: user.id, siteScope: 'all' } as AdminActor;
    workspaceId = (
      await db.workspace.create({
        data: {
          name: 'Actor test workspace',
          ownerUserId: editor,
          createdById: editor,
        },
      })
    ).id;
    await db.workspaceMember.create({
      data: { workspaceId, userId: editor, role: 'editor' },
    });
    await db.workspaceMember.create({
      data: { workspaceId, userId: `${editor}-viewer`, role: 'viewer' },
    });
    projectId = (
      await db.platformProject.create({
        data: { name: 'Actor test canvas', workspaceId, createdById: editor },
      })
    ).id;
    photoAssetId = (
      await db.mediaAsset.create({
        data: {
          kind: 'image',
          storageProvider: 'external_url',
          externalUrl: 'https://fixture.invalid/portrait.jpg',
          contentType: 'image/jpeg',
          visibility: 'private',
          createdByUserId: admin.id,
          checksumSha256: 'a'.repeat(64),
          metadata: { uploadKind: 'ai_reference_image' },
        },
      })
    ).id;
    actorId = (
      await service.save(admin, {
        name: 'Test performer',
        photoAssetId,
        active: true,
      })
    ).id;
  });
  afterAll(async () => {
    if (!db) return;
    if (actorId) {
      await db.aiActorUse.deleteMany({ where: { actorId } });
      await db.aiActorUnlock.deleteMany({ where: { actorId } });
      await db.aiActor.delete({ where: { id: actorId } });
    }
    if (photoAssetId)
      await db.mediaAsset.delete({ where: { id: photoAssetId } });
    if (workspaceId) await db.workspace.delete({ where: { id: workspaceId } });
    if (admin) {
      await db.adminAuditLog.deleteMany({ where: { actorUserId: admin.id } });
      await db.adminUser.delete({ where: { id: admin.id } });
    }
    await db.$disconnect();
  });
  it('publishes the photo with an administrator audit', async () => {
    expect(
      (await db.mediaAsset.findUniqueOrThrow({ where: { id: photoAssetId } }))
        .visibility,
    ).toBe('public');
    expect(
      await db.adminAuditLog.count({
        where: { resourceId: actorId, action: 'ai_actor.create' },
      }),
    ).toBe(1);
  });
  it('rejects viewer and outsider unlocks', async () => {
    await expect(
      service.unlock(`${editor}-viewer`, actorId, workspaceId),
    ).rejects.toThrow();
    await expect(
      service.unlock('outsider', actorId, workspaceId),
    ).rejects.toThrow();
  });
  it('deduplicates concurrent free unlocks and reference requests', async () => {
    await Promise.all([
      service.unlock(editor, actorId, workspaceId),
      service.unlock(editor, actorId, workspaceId),
    ]);
    expect(await db.aiActorUnlock.count({ where: { actorId } })).toBe(1);
    const id = randomUUID();
    const [one, two] = await Promise.all([
      service.use(editor, actorId, projectId, id),
      service.use(editor, actorId, projectId, id),
    ]);
    expect(one).toEqual(two);
    expect(await db.aiActorUse.count({ where: { actorId } })).toBe(1);
    expect((await service.usage(actorId, 1)).items[0].workspaceId).toBe(
      workspaceId,
    );
  });
  it('rejects cross-workspace project access and hidden actors', async () => {
    await expect(
      service.use('outsider', actorId, projectId, randomUUID()),
    ).rejects.toThrow();
    await service.save(admin, {
      id: actorId,
      name: 'Test performer',
      photoAssetId,
      active: false,
    });
    await expect(
      service.use(editor, actorId, projectId, randomUUID()),
    ).rejects.toThrow('unavailable');
    await service.save(admin, {
      id: actorId,
      name: 'Test performer',
      photoAssetId,
      active: true,
    });
  });
  it('rolls back the actor edit when the administrator audit cannot be persisted', async () => {
    await expect(
      service.save(
        { ...admin, id: randomUUID() },
        { id: actorId, name: 'Must roll back', photoAssetId, active: true },
      ),
    ).rejects.toThrow();
    expect(
      (await db.aiActor.findUniqueOrThrow({ where: { id: actorId } })).name,
    ).toBe('Test performer');
  });
  it('rejects a stale edit after archival and keeps archived actors unusable', async () => {
    await service.archive(actorId);
    await expect(
      service.save(admin, {
        id: actorId,
        name: 'Stale edit',
        photoAssetId,
        active: true,
      }),
    ).rejects.toThrow('Actor not found.');
    const archived = await db.aiActor.findUniqueOrThrow({
      where: { id: actorId },
    });
    expect(archived.active).toBe(false);
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.name).toBe('Test performer');

    // Historical inconsistent records must also remain unavailable by known ID.
    await db.aiActor.update({ where: { id: actorId }, data: { active: true } });
    await expect(service.unlock(editor, actorId, workspaceId)).rejects.toThrow(
      'unavailable',
    );
    await expect(
      service.use(editor, actorId, projectId, randomUUID()),
    ).rejects.toThrow('unavailable');
  });
});
