import { workspaceTestDatabase } from './__tests__/workspace-test-database';
import { StoryProjectsService } from '../../story-studio/story-projects.service';
import { StoryCrewAssetsController } from '../assets/story-crew-assets.controller';
import { StoryPermissionService } from '../../story-studio/story-permission.service';
import { StoryProjectWriteGuardService } from '../../story-studio/story-project-write-guard.service';
import { MediaAccessService } from '../../media/media-access.service';
import { crewStorageUsage } from '../assets/storage-quota';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaService } from '../../infra/db/db.module';
import { WorkspacePermissionService } from '../../workspaces/workspace-permission.service';
import { CrewAuthorizationService } from '../crew-authorization.service';
import { CrewAssetAccessService } from '../assets/asset-access.service';
import { CrewAssetsService } from '../assets/assets.service';
import { CrewProductionService } from './production.service';
import { CrewStudioWorkspaceService } from './studio-workspace.service';

const url = workspaceTestDatabase(process.env);
(url ? describe : describe.skip)(
  'Crew workspace asset loop (PostgreSQL)',
  () => {
    let db: PrismaClient;
    const owner = randomUUID(),
      reader = randomUUID(),
      outsider = randomUUID();
    const crewId = randomUUID(),
      workspaceId = randomUUID(),
      projectId = randomUUID(),
      otherProjectId = randomUUID(),
      documentId = randomUUID(),
      mediaId = randomUUID();
    let links: CrewStudioWorkspaceService;
    let assets: CrewAssetsService;
    let access: CrewAssetAccessService;
    beforeAll(async () => {
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url }),
        transactionOptions: { timeout: 15000 },
      });
      const prisma = db as PrismaService;
      const authorization = new CrewAuthorizationService(prisma);
      access = new CrewAssetAccessService(prisma, authorization);
      links = new CrewStudioWorkspaceService(prisma, authorization, {
        revoke: jest.fn().mockResolvedValue(undefined),
      } as never);
      assets = new CrewAssetsService(
        prisma,
        new WorkspacePermissionService(prisma),
        authorization,
        access,
        {
          forProvider: () => ({ isHealthy: () => Promise.resolve(true) }),
        } as never,
        {} as never,
        { broadcastCrewAssetChange: () => Promise.resolve(undefined) } as never,
      );
      await db.workspace.create({
        data: {
          id: workspaceId,
          name: 'Shared production',
          ownerUserId: owner,
          createdById: owner,
        },
      });
      await db.workspaceMember.createMany({
        data: [
          { workspaceId, userId: owner, role: 'owner' },
          { workspaceId, userId: reader, role: 'editor' },
        ],
      });
      await db.crew.create({
        data: {
          id: crewId,
          name: 'Review Crew',
          description: '',
          logo: '/review-crew.png',
          createdByUserId: owner,
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
      await db.platformProject.createMany({
        data: [projectId, otherProjectId].map((id, index) => ({
          id,
          workspaceId,
          name: index ? 'Second project' : 'Harbour canvas',
          createdById: owner,
        })),
      });
      await db.studioDocument.create({
        data: {
          id: documentId,
          workspaceId,
          platformProjectId: projectId,
          type: 'canvas',
          title: 'Canvas',
          createdById: owner,
        },
      });
      await db.mediaAsset.create({
        data: {
          id: mediaId,
          workspaceId,
          kind: 'image',
          storageProvider: 'external_url',
          externalUrl: 'https://example.invalid/test.png',
          contentType: 'image/png',
          createdByUserId: owner,
          visibility: 'private',
        },
      });
    });
    afterAll(async () => {
      if (!db) return;
      try {
        await db.crew.deleteMany({ where: { id: crewId } });
        await db.mediaAsset.deleteMany({ where: { id: mediaId } });
        await db.workspace.deleteMany({ where: { id: workspaceId } });
      } finally {
        await db.$disconnect();
      }
    });
    it('rejects a Crew admin with only editor workspace access and audits an authorized link', async () => {
      await expect(links.link(crewId, reader, workspaceId)).rejects.toThrow();
      const member = await db.crewMember.create({
        data: {
          id: randomUUID(),
          crewId,
          userId: reader,
          joinedVia: 'invitation',
          policies: { create: { policyKey: 'admin', assignedByUserId: owner } },
        },
      });
      try {
        await expect(links.link(crewId, reader, workspaceId)).rejects.toThrow(
          'Workspace not found.',
        );
      } finally {
        await db.crewMember.delete({ where: { id: member.id } });
      }
      await links.link(crewId, owner, workspaceId);
      expect(await db.crewProductionActivity.count({ where: { crewId } })).toBe(
        1,
      );
      await links.link(crewId, owner, workspaceId);
      expect(await db.crewProductionActivity.count({ where: { crewId } })).toBe(
        1,
      );
    });
    it('removes deleted Crew context from every linked workspace project', async () => {
      await db.crew.update({
        where: { id: crewId },
        data: { deletedAt: new Date() },
      });
      try {
        expect((await assets.projectContext(projectId, owner)).crew).toBeNull();
        expect(
          (await assets.projectContext(otherProjectId, reader)).crew,
        ).toBeNull();
        await expect(
          assets.listForProject(otherProjectId, reader, {
            source: 'all',
            sort: 'modified',
          }),
        ).rejects.toThrow();
      } finally {
        await db.crew.update({
          where: { id: crewId },
          data: { deletedAt: null },
        });
      }
    });
    it('ignores deleted internal-production Crew links without affecting project access', async () => {
      await db.crew.update({
        where: { id: crewId },
        data: { studioWorkspaceId: null, productionProjectId: projectId },
      });
      try {
        expect((await assets.projectContext(projectId, owner)).crew?.id).toBe(
          crewId,
        );
        await db.crew.update({
          where: { id: crewId },
          data: { deletedAt: new Date() },
        });
        expect((await assets.projectContext(projectId, owner)).crew).toBeNull();
      } finally {
        await db.crew.update({
          where: { id: crewId },
          data: {
            deletedAt: null,
            productionProjectId: null,
            studioWorkspaceId: workspaceId,
          },
        });
      }
    });
    it('ignores deleted task and Crew associations for a task Canvas', async () => {
      const state = await db.crewTaskWorkflowState.create({
        data: {
          crewId,
          name: 'Fixture',
          color: '#ffffff',
          semantic: 'open',
          createdByUserId: owner,
        },
      });
      const task = await db.crewTask.create({
        data: {
          crewId,
          number: 100,
          title: 'Fixture task',
          workflowStateId: state.id,
          canvasProjectId: projectId,
          createdByUserId: owner,
        },
      });
      await db.crew.update({
        where: { id: crewId },
        data: { studioWorkspaceId: null },
      });
      try {
        expect((await assets.projectContext(projectId, owner)).crew?.id).toBe(
          crewId,
        );
        await db.crewTask.update({
          where: { id: task.id },
          data: { deletedAt: new Date() },
        });
        expect((await assets.projectContext(projectId, owner)).crew).toBeNull();
        await db.crewTask.update({
          where: { id: task.id },
          data: { deletedAt: null },
        });
        await db.crew.update({
          where: { id: crewId },
          data: { deletedAt: new Date() },
        });
        expect((await assets.projectContext(projectId, owner)).crew).toBeNull();
      } finally {
        await db.crewTask.delete({ where: { id: task.id } });
        await db.crewTaskWorkflowState.delete({ where: { id: state.id } });
        await db.crew.update({
          where: { id: crewId },
          data: { deletedAt: null, studioWorkspaceId: workspaceId },
        });
      }
    });
    it('concurrent canvas saves reuse one named folder and one file, visible from a second project', async () => {
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          assets.saveFromCanvas(documentId, owner, mediaId),
        ),
      );
      expect(new Set(results.map((result) => result.id)).size).toBe(1);
      expect((await crewStorageUsage(db, crewId)).unknownSizeCount).toBe(0);
      expect(results[0].folderName).toBe('Harbour canvas');
      expect(await db.crewAssetNode.count({ where: { crewId } })).toBe(2);
      const listing = await assets.listForProject(otherProjectId, reader, {
        source: 'recent',
        sort: 'modified',
        limit: 200,
      });
      expect(listing.items.some((item) => item.media?.id === mediaId)).toBe(
        true,
      );
      await expect(
        assets.listForProject(otherProjectId, outsider, {
          source: 'recent',
          sort: 'modified',
        }),
      ).rejects.toThrow();
    });
    it('exposes the same Crew library to film/game projects with Story access checks', async () => {
      const prisma = db as PrismaService;
      const workspacePermissions = new WorkspacePermissionService(prisma);
      const guard = new StoryProjectWriteGuardService(prisma);
      const permissions = new StoryPermissionService(prisma, guard);
      const mediaAccess = new MediaAccessService(
        prisma,
        {} as never,
        workspacePermissions,
        access,
        {} as never,
      );
      const stories = new StoryProjectsService(
        prisma,
        permissions,
        workspacePermissions,
        guard,
        mediaAccess,
      );
      const { project } = await stories.create(
        { userId: owner },
        {
          workspaceId,
          title: 'Harbour interactive film',
          defaultLocale: 'en-US',
          visibility: 'private',
        },
      );
      const controller = new StoryCrewAssetsController(
        prisma,
        permissions,
        assets,
      );
      try {
        const listing = await controller.list(
          project.id,
          { userId: reader },
          { source: 'recent', sort: 'modified' },
        );
        expect(
          listing.data.items.some((item) => item.media?.id === mediaId),
        ).toBe(true);
        const imported = await stories.addCandidateAsset(
          { userId: reader },
          project.id,
          mediaId,
        );
        expect(imported.asset.id).toBe(mediaId);
        expect(
          await db.storyCandidateAsset.count({
            where: { storyProjectId: project.id, mediaAssetId: mediaId },
          }),
        ).toBe(1);
        await expect(
          controller.list(
            project.id,
            { userId: outsider },
            { source: 'recent', sort: 'modified' },
          ),
        ).rejects.toThrow();
      } finally {
        await db.storyProject.delete({ where: { id: project.id } });
      }
    });
    it('grants Crew-only consumption only through explicit active canvas-save references', async () => {
      const crewOnly = randomUUID();
      const member = await db.crewMember.create({
        data: {
          id: randomUUID(),
          crewId,
          userId: crewOnly,
          joinedVia: 'invitation',
          // Otherwise linked Studio membership independently grants workspace
          // access, even after the explicit Crew asset reference is removed.
          permissionOverrides: {
            create: {
              permissionKey: 'studio.view',
              effect: 'deny',
              changedByUserId: owner,
            },
          },
        },
      });
      const mediaAccess = new MediaAccessService(
        db as PrismaService,
        {} as never,
        new WorkspacePermissionService(db as PrismaService),
        access,
        {} as never,
      );
      const node = await db.crewAssetNode.findFirstOrThrow({
        where: { crewId, mediaAssetId: mediaId },
      });
      try {
        await expect(
          mediaAccess.requireUseAccessById(crewOnly, mediaId),
        ).resolves.toBeUndefined();
        await db.crewAssetNode.update({
          where: { id: node.id },
          data: { sharedFromStudio: false },
        });
        await expect(
          mediaAccess.requireUseAccessById(crewOnly, mediaId),
        ).rejects.toThrow();
        await db.crewAssetNode.update({
          where: { id: node.id },
          data: { sharedFromStudio: true },
        });
        await db.crewAssetNode.update({
          where: { id: node.parentId! },
          data: { accessMode: 'restricted' },
        });
        await expect(
          mediaAccess.requireUseAccessById(crewOnly, mediaId),
        ).rejects.toThrow();
      } finally {
        await db.crewAssetNode.update({
          where: { id: node.id },
          data: { sharedFromStudio: true },
        });
        await db.crewAssetNode.update({
          where: { id: node.parentId! },
          data: { accessMode: 'inherit' },
        });
        await db.crewMember.delete({ where: { id: member.id } });
      }
    });
    it('rechecks workspace ownership after waiting for an ownership change', async () => {
      let locked!: () => void;
      let release!: () => void;
      const ready = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const transfer = db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${workspaceId}::uuid FOR UPDATE`;
        await tx.workspace.update({
          where: { id: workspaceId },
          data: { ownerUserId: reader },
        });
        await tx.workspaceMember.updateMany({
          where: { workspaceId, userId: owner },
          data: { role: 'editor' },
        });
        locked();
        await gate;
      });
      await ready;
      const attempted = links.link(crewId, owner, workspaceId);
      const rejected = expect(attempted).rejects.toThrow(
        'Workspace not found.',
      );
      release();
      try {
        await transfer;
        await rejected;
      } finally {
        await db.workspace.update({
          where: { id: workspaceId },
          data: { ownerUserId: owner },
        });
        await db.workspaceMember.updateMany({
          where: { workspaceId, userId: owner },
          data: { role: 'owner' },
        });
      }
    });
    it('preserves restricted folder ACL and unlink revokes inherited workspace access', async () => {
      const file = await db.crewAssetNode.findFirstOrThrow({
        where: { crewId, mediaAssetId: mediaId },
      });
      await db.crewAssetNode.update({
        where: { id: file.parentId! },
        data: { accessMode: 'restricted' },
      });
      expect(
        await access.resolveNodePermission(crewId, file.id, reader),
      ).toBeNull();
      await db.crewAssetNode.update({
        where: { id: file.parentId! },
        data: { accessMode: 'inherit' },
      });
      expect(await access.resolveNodePermission(crewId, file.id, reader)).toBe(
        'view',
      );
      await links.link(crewId, owner, null);
      expect(
        await access.resolveNodePermission(crewId, file.id, reader),
      ).toBeNull();
      await links.link(crewId, owner, workspaceId);
    });
    it('keeps private evidence out of explicit Studio browsing, import and counterpart replacement', async () => {
      const file = await db.crewAssetNode.findFirstOrThrow({
        where: { crewId, mediaAssetId: mediaId },
      });
      expect(
        (await assets.listStudioMediaOptions(crewId, owner, {})).items.map(
          (row: { id: string }) => row.id,
        ),
      ).toContain(mediaId);
      try {
        for (const uploadKind of [
          'crew_expense_receipt',
          'crew_dispute_evidence',
          'crew_agreement_archive',
        ]) {
          await db.mediaAsset.update({
            where: { id: mediaId },
            data: { metadata: { uploadKind } },
          });
          expect(
            (await assets.listStudioMediaOptions(crewId, owner, {})).items.map(
              (row: { id: string }) => row.id,
            ),
          ).not.toContain(mediaId);
          await expect(
            assets.linkStudioMedia(crewId, owner, { mediaAssetIds: [mediaId] }),
          ).rejects.toThrow();
          await expect(
            assets.setStudioLink(crewId, owner, file.id, {
              mediaAssetId: mediaId,
            }),
          ).rejects.toThrow();
          await expect(
            assets.saveFromCanvas(documentId, owner, mediaId),
          ).rejects.toThrow('Private');
          expect(
            (
              await db.crewAssetNode.findUniqueOrThrow({
                where: { id: file.id },
              })
            ).linkedStudioMediaAssetId,
          ).toBe(file.linkedStudioMediaAssetId);
        }
      } finally {
        await db.mediaAsset.update({
          where: { id: mediaId },
          data: { metadata: {} },
        });
      }
      expect(
        (await assets.listStudioMediaOptions(crewId, owner, {})).items.map(
          (row: { id: string }) => row.id,
        ),
      ).toContain(mediaId);
    });

    it('rejects blocked media, private receipts, non-canvas documents and ended documents', async () => {
      await db.mediaAsset.update({
        where: { id: mediaId },
        data: { moderationStatus: 'blocked' },
      });
      await expect(
        assets.saveFromCanvas(documentId, owner, mediaId),
      ).rejects.toThrow();
      await db.mediaAsset.update({
        where: { id: mediaId },
        data: {
          moderationStatus: 'approved',
          metadata: { uploadKind: 'crew_expense_receipt' },
        },
      });
      await expect(
        assets.saveFromCanvas(documentId, owner, mediaId),
      ).rejects.toThrow('Private');
      await db.mediaAsset.update({
        where: { id: mediaId },
        data: { metadata: {} },
      });
      await db.studioDocument.update({
        where: { id: documentId },
        data: { status: 'archived' },
      });
      await expect(
        assets.saveFromCanvas(documentId, owner, mediaId),
      ).rejects.toThrow('Canvas project not found');
      await db.studioDocument.update({
        where: { id: documentId },
        data: { status: 'active', type: 'script' },
      });
      await expect(
        assets.saveFromCanvas(documentId, owner, mediaId),
      ).rejects.toThrow('Canvas project not found');
    });
    it('switches between existing project links and workspace links without losing project access', async () => {
      const prisma = db as PrismaService;
      const production = new CrewProductionService(
        prisma,
        new CrewAuthorizationService(prisma),
        access,
        {
          broadcastCrewTaskProjectChange: () => Promise.resolve(undefined),
        } as never,
        new WorkspacePermissionService(prisma),

        { revoke: jest.fn().mockResolvedValue(undefined) } as never,
      );
      await production.linkStudioProject(crewId, owner, { projectId });
      const select = { studioProjectId: true, studioWorkspaceId: true };
      expect(
        await db.crew.findUniqueOrThrow({ where: { id: crewId }, select }),
      ).toEqual({ studioProjectId: projectId, studioWorkspaceId: null });
      expect((await assets.projectContext(projectId, owner)).crew?.id).toBe(
        crewId,
      );
      await links.link(crewId, owner, workspaceId);
      expect(
        await db.crew.findUniqueOrThrow({ where: { id: crewId }, select }),
      ).toEqual({ studioProjectId: null, studioWorkspaceId: workspaceId });
      expect(
        (await assets.projectContext(otherProjectId, owner)).crew?.id,
      ).toBe(crewId);
    });
    it('serializes explicit import retries and preserves original media when counterparts change', async () => {
      const folder = await db.crewAssetNode.create({
        data: {
          crewId,
          kind: 'folder',
          name: 'Explicit import recovery',
          createdByUserId: owner,
          updatedByUserId: owner,
        },
      });
      const counterpart = await db.mediaAsset.create({
        data: {
          workspaceId,
          kind: 'image',
          storageProvider: 'external_url',
          externalUrl: 'https://example.invalid/counterpart.png',
          contentType: 'image/png',
          createdByUserId: owner,
          visibility: 'private',
        },
      });
      try {
        const input = {
          parentId: folder.id,
          mediaAssetIds: [mediaId, mediaId],
        };
        const attempts = await Promise.all(
          Array.from({ length: 4 }, () =>
            assets.linkStudioMedia(crewId, owner, input),
          ),
        );
        expect(
          attempts.reduce((count, result) => count + result.items.length, 0),
        ).toBe(1);
        expect(
          await db.crewAssetNode.count({
            where: { crewId, parentId: folder.id },
          }),
        ).toBe(1);
        const imported = await db.crewAssetNode.findFirstOrThrow({
          where: { crewId, parentId: folder.id },
        });
        expect(imported).toMatchObject({
          mediaAssetId: mediaId,
          linkedStudioMediaAssetId: mediaId,
          sharedFromStudio: true,
        });
        await assets.setStudioLink(crewId, owner, imported.id, {
          mediaAssetId: counterpart.id,
        });
        expect(
          await db.crewAssetNode.findUniqueOrThrow({
            where: { id: imported.id },
          }),
        ).toMatchObject({
          mediaAssetId: mediaId,
          linkedStudioMediaAssetId: counterpart.id,
        });
        await assets.setStudioLink(crewId, owner, imported.id, {
          mediaAssetId: null,
        });
        expect(
          await db.crewAssetNode.findUniqueOrThrow({
            where: { id: imported.id },
          }),
        ).toMatchObject({
          mediaAssetId: mediaId,
          linkedStudioMediaAssetId: null,
        });
        expect(
          (await assets.linkStudioMedia(crewId, owner, input)).items,
        ).toEqual([]);
        expect(
          await db.crewAssetNode.findUniqueOrThrow({
            where: { id: imported.id },
          }),
        ).toMatchObject({
          mediaAssetId: mediaId,
          linkedStudioMediaAssetId: null,
        });
        await expect(
          assets.linkStudioMedia(crewId, owner, {
            parentId: folder.id,
            mediaAssetIds: [counterpart.id, randomUUID()],
          }),
        ).rejects.toThrow('Only ready workspace media');
        expect(
          await db.crewAssetNode.count({
            where: { crewId, parentId: folder.id },
          }),
        ).toBe(1);
        expect(
          (
            await assets.linkStudioMedia(crewId, owner, {
              parentId: folder.id,
              mediaAssetIds: [counterpart.id],
            })
          ).items,
        ).toHaveLength(1);
      } finally {
        await db.crewAssetNode.deleteMany({ where: { parentId: folder.id } });
        await db.crewAssetNode.delete({ where: { id: folder.id } });
        await db.mediaAsset.delete({ where: { id: counterpart.id } });
      }
    });
    it('removes a Crew reference without deleting its original Studio media', async () => {
      const node = await db.crewAssetNode.findFirstOrThrow({
        where: { crewId, mediaAssetId: mediaId },
      });
      await assets.trash(crewId, owner, node.id);
      await assets.removePermanently(crewId, owner, node.id);
      expect(
        await db.crewAssetNode.findUnique({ where: { id: node.id } }),
      ).toBeNull();
      const original = await db.mediaAsset.findUniqueOrThrow({
        where: { id: mediaId },
      });
      expect(original.deletedAt).toBeNull();
      expect(original.status).toBe('ready');
    });
  },
);
