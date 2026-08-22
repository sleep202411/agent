import {
  MediaAssetKind,
  MediaAssetSource,
  MediaStorageProvider,
  Prisma,
  StoryDurationPreset,
  StoryFrameProfile,
  StoryProductionPlanDisposition,
  StoryProductionSpecStatus,
  StoryProjectMemberRole,
  StoryProjectStatus,
  StoryStoryboardBindingMode,
  StoryVisualStyle,
  StoryVisibility,
  WorkspaceMemberRole,
  WorkspaceType,
} from '@prisma/client';
import {
  STORY_PRODUCTION_PLAN_SCHEMA_VERSION,
  StoryProductionPlanSchema,
  type StoryProductionPlan,
} from '@repo/shared/story-production';
import { config as loadEnv } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { buildPrisma } from '../infra/db/db.module';
import { canonicalJsonHash } from './canonical-json';
import {
  EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT,
  INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
  InteractiveStoryDraftContentSchema,
} from './dto';
import { StoryProductionPlanService } from './story-production-plan.service';

loadEnv({
  path: resolve(__dirname, '../../.env'),
  override: false,
  quiet: true,
});

const INTEGRATION_ENABLED =
  process.env.STORY_PRODUCTION_CONFLICT_POSTGRES_INTEGRATION === '1';
const DEFAULT_LOCAL_DATABASE_URL =
  'postgres://fizzdragon:fizzdragon@localhost:5433/fizzdragon';
const describePostgres = INTEGRATION_ENABLED ? describe : describe.skip;

describePostgres(
  'Story production conflict resolution PostgreSQL integration',
  () => {
    const databaseUrl =
      process.env.DATABASE_URL?.trim() || DEFAULT_LOCAL_DATABASE_URL;
    let prisma: ReturnType<typeof buildPrisma>;
    const workspaceIds = new Set<string>();

    beforeAll(async () => {
      assertDedicatedLocalPostgres(databaseUrl);
      prisma = buildPrisma();
      await prisma.$connect();
      const migration = await prisma.$queryRaw<
        Array<{ migration_name: string }>
      >`
      SELECT migration_name
      FROM _prisma_migrations
      WHERE migration_name = '20260821023600_story_production_conflict_resolution'
        AND finished_at IS NOT NULL
        AND rolled_back_at IS NULL
    `;
      if (migration.length !== 1) {
        throw new Error(
          'Apply 20260821023600_story_production_conflict_resolution before running this integration.',
        );
      }
    });

    afterEach(async () => {
      if (workspaceIds.size > 0) {
        await prisma.storyProject.deleteMany({
          where: { workspaceId: { in: [...workspaceIds] } },
        });
        await prisma.workspace.deleteMany({
          where: { id: { in: [...workspaceIds] } },
        });
        workspaceIds.clear();
      }
    });

    afterAll(async () => {
      if (prisma) await prisma.$disconnect();
    });

    it('recovers stale Asset/Storyboard specs through both decisions while preserving compatible creative media and bindings', async () => {
      const fixture = await createFixture(prisma, workspaceIds);
      const service = productionService(prisma, fixture);
      const initial = plan('Initial', 4_000);
      await prisma.$transaction((tx) =>
        service.applyApprovedProductionPlanInTransaction(tx, {
          storyProjectId: fixture.projectId,
          storyChapterId: fixture.chapterId,
          actorUserId: fixture.userId,
          sourceFingerprint: '1'.repeat(64),
          canonicalCharacterIds: [],
          productionPlan: initial,
        }),
      );

      const asset = await prisma.storyAssetSpec.findFirstOrThrow({
        where: { storyChapterId: fixture.chapterId },
      });
      const sequence = await prisma.storyStoryboardSequence.findFirstOrThrow({
        where: { storyChapterId: fixture.chapterId },
      });
      const clip = await prisma.storyStoryboardClip.findFirstOrThrow({
        where: { sequenceId: sequence.id },
      });
      const binding =
        await prisma.storyStoryboardClipAssetBinding.findFirstOrThrow({
          where: { storyboardClipId: clip.id },
        });
      const assetMedia = await prisma.mediaAsset.create({
        data: {
          kind: MediaAssetKind.image,
          storageProvider: MediaStorageProvider.external_url,
          workspaceId: fixture.workspaceId,
          externalUrl: `https://example.test/${fixture.prefix}/asset.png`,
          contentType: 'image/png',
          source: MediaAssetSource.user_upload,
          createdByUserId: fixture.userId,
        },
      });
      const assetVersion = await prisma.storyAssetMediaVersion.create({
        data: {
          storyProjectId: fixture.projectId,
          storyChapterId: fixture.chapterId,
          assetSpecId: asset.id,
          versionNumber: 1,
          mediaAssetId: assetMedia.id,
          sourceFingerprint: 'a'.repeat(64),
          createdByUserId: fixture.userId,
        },
      });
      const clipMedia = await prisma.mediaAsset.create({
        data: {
          kind: MediaAssetKind.video,
          storageProvider: MediaStorageProvider.external_url,
          workspaceId: fixture.workspaceId,
          externalUrl: `https://example.test/${fixture.prefix}/clip.mp4`,
          contentType: 'video/mp4',
          durationSeconds: 4,
          source: MediaAssetSource.user_upload,
          createdByUserId: fixture.userId,
        },
      });
      const clipVersion = await prisma.storyStoryboardClipMediaVersion.create({
        data: {
          storyProjectId: fixture.projectId,
          storyChapterId: fixture.chapterId,
          storyboardClipId: clip.id,
          versionNumber: 1,
          mediaAssetId: clipMedia.id,
          sourceFingerprint: 'c'.repeat(64),
          createdByUserId: fixture.userId,
        },
      });
      const modifiedAt = new Date();
      await Promise.all([
        prisma.storyAssetSpec.update({
          where: { id: asset.id },
          data: {
            name: 'Creator gate',
            imagePrompt: 'Creator gate prompt.',
            selectedMediaVersionId: assetVersion.id,
            userModifiedAt: modifiedAt,
            userModifiedByUserId: fixture.userId,
            version: { increment: 1 },
          },
        }),
        prisma.storyStoryboardSequence.update({
          where: { id: sequence.id },
          data: {
            title: 'Creator sequence',
            userModifiedAt: modifiedAt,
            userModifiedByUserId: fixture.userId,
            version: { increment: 1 },
          },
        }),
        prisma.storyStoryboardClip.update({
          where: { id: clip.id },
          data: {
            selectedMediaVersionId: clipVersion.id,
            userModifiedAt: modifiedAt,
            userModifiedByUserId: fixture.userId,
            version: { increment: 1 },
          },
        }),
        prisma.storyStoryboardClipAssetBinding.update({
          where: { id: binding.id },
          data: {
            mode: StoryStoryboardBindingMode.pinned,
            pinnedMediaVersionId: assetVersion.id,
            userModifiedAt: modifiedAt,
            userModifiedByUserId: fixture.userId,
            version: { increment: 1 },
          },
        }),
      ]);

      const latest = plan('Latest', 5_000);
      await prisma.$transaction((tx) =>
        service.applyApprovedProductionPlanInTransaction(tx, {
          storyProjectId: fixture.projectId,
          storyChapterId: fixture.chapterId,
          actorUserId: fixture.userId,
          sourceFingerprint: '2'.repeat(64),
          canonicalCharacterIds: [],
          productionPlan: latest,
        }),
      );
      const staleAsset = await prisma.storyAssetSpec.findUniqueOrThrow({
        where: { id: asset.id },
      });
      const staleSequence =
        await prisma.storyStoryboardSequence.findUniqueOrThrow({
          where: { id: sequence.id },
        });
      expect(staleAsset).toMatchObject({
        name: 'Creator gate',
        status: StoryProductionSpecStatus.stale,
      });
      expect(staleAsset.pendingPlanSnapshotId).not.toBeNull();
      expect(staleSequence).toMatchObject({
        title: 'Creator sequence',
        status: StoryProductionSpecStatus.stale,
      });
      expect(staleSequence.pendingPlanSnapshotId).toBe(
        staleAsset.pendingPlanSnapshotId,
      );

      const sequenceResponse = await service.resolveStoryboardSequenceConflict(
        { userId: fixture.userId } as never,
        fixture.workspaceId,
        fixture.projectId,
        fixture.chapterId,
        sequence.id,
        `${fixture.prefix}:latest-sequence`,
        {
          expectedVersion: staleSequence.version,
          expectedPendingSourceFingerprint:
            staleSequence.pendingSourceFingerprint!,
          resolution: 'use_latest_plan',
        },
      );
      const replay = await service.resolveStoryboardSequenceConflict(
        { userId: fixture.userId } as never,
        fixture.workspaceId,
        fixture.projectId,
        fixture.chapterId,
        sequence.id,
        `${fixture.prefix}:latest-sequence`,
        {
          expectedVersion: staleSequence.version,
          expectedPendingSourceFingerprint:
            staleSequence.pendingSourceFingerprint!,
          resolution: 'use_latest_plan',
        },
      );
      expect(replay).toEqual(sequenceResponse);
      await service.resolveAssetSpecConflict(
        { userId: fixture.userId } as never,
        fixture.workspaceId,
        fixture.projectId,
        fixture.chapterId,
        asset.id,
        `${fixture.prefix}:latest-asset`,
        {
          expectedVersion: staleAsset.version,
          expectedPendingSourceFingerprint:
            staleAsset.pendingSourceFingerprint!,
          resolution: 'use_latest_plan',
        },
      );

      const [latestAsset, latestSequence, latestClip, latestBinding] =
        await Promise.all([
          prisma.storyAssetSpec.findUniqueOrThrow({ where: { id: asset.id } }),
          prisma.storyStoryboardSequence.findUniqueOrThrow({
            where: { id: sequence.id },
          }),
          prisma.storyStoryboardClip.findUniqueOrThrow({
            where: { id: clip.id },
          }),
          prisma.storyStoryboardClipAssetBinding.findUniqueOrThrow({
            where: { id: binding.id },
          }),
        ]);
      expect(latestAsset).toMatchObject({
        name: 'Latest gate',
        status: StoryProductionSpecStatus.current,
        pendingPlanSnapshotId: null,
        planDisposition: StoryProductionPlanDisposition.planned,
        selectedMediaVersionId: assetVersion.id,
      });
      expect(latestSequence).toMatchObject({
        title: 'Latest sequence',
        durationMs: 5_000,
        status: StoryProductionSpecStatus.current,
        pendingPlanSnapshotId: null,
      });
      expect(latestClip).toMatchObject({
        id: clip.id,
        selectedMediaVersionId: clipVersion.id,
        durationMs: 5_000,
      });
      expect(latestBinding).toMatchObject({
        id: binding.id,
        mode: StoryStoryboardBindingMode.pinned,
        pinnedMediaVersionId: assetVersion.id,
      });

      await Promise.all([
        prisma.storyAssetSpec.update({
          where: { id: asset.id },
          data: {
            name: 'Final creator gate',
            userModifiedAt: new Date(),
            userModifiedByUserId: fixture.userId,
            version: { increment: 1 },
          },
        }),
        prisma.storyStoryboardSequence.update({
          where: { id: sequence.id },
          data: {
            title: 'Final creator sequence',
            userModifiedAt: new Date(),
            userModifiedByUserId: fixture.userId,
            version: { increment: 1 },
          },
        }),
      ]);
      await prisma.$transaction((tx) =>
        service.applyApprovedProductionPlanInTransaction(tx, {
          storyProjectId: fixture.projectId,
          storyChapterId: fixture.chapterId,
          actorUserId: fixture.userId,
          sourceFingerprint: '3'.repeat(64),
          canonicalCharacterIds: [],
          productionPlan: plan('Third', 5_000),
        }),
      );
      const [thirdAsset, thirdSequence] = await Promise.all([
        prisma.storyAssetSpec.findUniqueOrThrow({ where: { id: asset.id } }),
        prisma.storyStoryboardSequence.findUniqueOrThrow({
          where: { id: sequence.id },
        }),
      ]);
      await service.resolveAssetSpecConflict(
        { userId: fixture.userId } as never,
        fixture.workspaceId,
        fixture.projectId,
        fixture.chapterId,
        asset.id,
        `${fixture.prefix}:keep-asset`,
        {
          expectedVersion: thirdAsset.version,
          expectedPendingSourceFingerprint:
            thirdAsset.pendingSourceFingerprint!,
          resolution: 'keep_current',
        },
      );
      await service.resolveStoryboardSequenceConflict(
        { userId: fixture.userId } as never,
        fixture.workspaceId,
        fixture.projectId,
        fixture.chapterId,
        sequence.id,
        `${fixture.prefix}:keep-sequence`,
        {
          expectedVersion: thirdSequence.version,
          expectedPendingSourceFingerprint:
            thirdSequence.pendingSourceFingerprint!,
          resolution: 'keep_current',
        },
      );
      const [keptAsset, keptSequence] = await Promise.all([
        prisma.storyAssetSpec.findUniqueOrThrow({ where: { id: asset.id } }),
        prisma.storyStoryboardSequence.findUniqueOrThrow({
          where: { id: sequence.id },
        }),
      ]);
      expect(keptAsset).toMatchObject({
        name: 'Final creator gate',
        status: StoryProductionSpecStatus.current,
        pendingPlanSnapshotId: null,
        planDisposition: StoryProductionPlanDisposition.user_override,
      });
      expect(keptSequence).toMatchObject({
        title: 'Final creator sequence',
        status: StoryProductionSpecStatus.current,
        pendingPlanSnapshotId: null,
        planDisposition: StoryProductionPlanDisposition.user_override,
      });
    });

    it('rejects a pending snapshot from another chapter at the database scope boundary', async () => {
      const fixture = await createFixture(prisma, workspaceIds);
      const otherChapter = await prisma.storyChapter.create({
        data: {
          storyProjectId: fixture.projectId,
          title: 'Other chapter',
          rank: 1,
          nodeIds: [],
          createdByUserId: fixture.userId,
        },
      });
      const exactPlan = plan('Other', 4_000);
      const snapshot = await prisma.storyProductionPlanSnapshot.create({
        data: {
          storyProjectId: fixture.projectId,
          storyChapterId: otherChapter.id,
          sourceFingerprint: '9'.repeat(64),
          planFingerprint: canonicalJsonHash({
            sourceFingerprint: '9'.repeat(64),
            productionPlan: exactPlan,
          }),
          productionPlan: exactPlan as Prisma.InputJsonValue,
          createdByUserId: fixture.userId,
        },
      });
      const asset = await prisma.storyAssetSpec.create({
        data: {
          storyProjectId: fixture.projectId,
          storyChapterId: fixture.chapterId,
          stableKey: `${fixture.prefix}.asset`,
          kind: 'location',
          sourceNodeIds: ['scene.gate'],
          name: 'Scoped asset',
          imagePrompt: 'Scoped asset prompt.',
          sourceFingerprint: '8'.repeat(64),
          createdByUserId: fixture.userId,
        },
      });

      await expect(
        prisma.storyAssetSpec.update({
          where: { id: asset.id },
          data: {
            status: StoryProductionSpecStatus.stale,
            pendingSourceFingerprint: '7'.repeat(64),
            pendingPlanSnapshotId: snapshot.id,
          },
        }),
      ).rejects.toBeDefined();
    });
  },
);

function plan(label: string, durationMs: number): StoryProductionPlan {
  return StoryProductionPlanSchema.parse({
    schemaVersion: STORY_PRODUCTION_PLAN_SCHEMA_VERSION,
    assetSpecs: [
      {
        stableKey: 'asset.gate',
        kind: 'location',
        name: `${label} gate`,
        description: `${label} gate description.`,
        imagePrompt: `${label} gate image prompt.`,
        sourceNodeIds: ['scene.gate'],
      },
    ],
    storyboardSequences: [
      {
        plotNodeId: 'scene.gate',
        title: `${label} sequence`,
        description: `${label} footage of the gate opening at night.`,
        durationMs,
        clips: [
          {
            stableKey: 'shot.gate',
            kind: 'video',
            title: `${label} shot`,
            description: `${label} shot description.`,
            startMs: 0,
            durationMs,
            videoPrompt: `${label} gate video prompt framing @asset.gate at night.`,
          },
        ],
        cues: [],
      },
    ],
  });
}

async function createFixture(
  prisma: ReturnType<typeof buildPrisma>,
  workspaceIds: Set<string>,
) {
  const prefix = `story-conflict-pg-${randomUUID()}`;
  const userId = `${prefix}:user`.slice(0, 64);
  const draft = InteractiveStoryDraftContentSchema.parse({
    ...EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT,
    graph: {
      entryNodeId: 'scene.gate',
      nodes: [
        {
          kind: 'clip',
          nodeId: 'scene.gate',
          clipKey: 'GATE',
          description: 'EXT. GATE - NIGHT\n\nThe gate opens.',
          interactions: [],
          exit: { kind: 'auto', nextNodeId: null },
        },
      ],
    },
  });
  const workspace = await prisma.workspace.create({
    data: {
      type: WorkspaceType.team,
      name: prefix,
      ownerUserId: userId,
      createdById: userId,
      members: {
        create: {
          userId,
          role: WorkspaceMemberRole.owner,
        },
      },
    },
  });
  workspaceIds.add(workspace.id);
  const project = await prisma.storyProject.create({
    data: {
      workspaceId: workspace.id,
      frameProfile: StoryFrameProfile.landscape_16_9,
      durationPreset: StoryDurationPreset.short_5_15,
      visualStyle: StoryVisualStyle.cinematic_realism,
      creativeProfileConfirmedAt: new Date(),
      status: StoryProjectStatus.active,
      visibility: StoryVisibility.private,
      title: prefix,
      defaultLocale: 'en-US',
      createdByUserId: userId,
      members: {
        create: {
          userId,
          role: StoryProjectMemberRole.owner,
          grantedByUserId: userId,
        },
      },
      draft: {
        create: {
          schemaVersion: INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
          content: draft as Prisma.InputJsonObject,
          contentHash: canonicalJsonHash(draft),
          updatedByUserId: userId,
        },
      },
      writeState: { create: {} },
    },
  });
  const chapter = await prisma.storyChapter.create({
    data: {
      storyProjectId: project.id,
      title: 'Chapter 1',
      rank: 0,
      nodeIds: ['scene.gate'],
      entryNodeId: 'scene.gate',
      createdByUserId: userId,
    },
  });
  return {
    prefix,
    userId,
    workspaceId: workspace.id,
    projectId: project.id,
    chapterId: chapter.id,
  };
}

function productionService(
  prisma: ReturnType<typeof buildPrisma>,
  fixture: Awaited<ReturnType<typeof createFixture>>,
) {
  const service = new StoryProductionPlanService(
    prisma as never,
    {
      requireProject: jest.fn().mockResolvedValue({
        project: { workspaceId: fixture.workspaceId },
      }),
      requireProjectInTransaction: jest.fn().mockResolvedValue(undefined),
    } as never,
    {
      assertHumanWriteAllowed: jest.fn().mockResolvedValue(undefined),
    } as never,
  );
  jest.spyOn(service, 'getProductionStateInTransaction').mockResolvedValue({
    projectId: fixture.projectId,
    chapterId: fixture.chapterId,
    profile: { status: 'current' },
    script: { status: 'current', documentId: null, sequence: null },
    plotTree: { status: 'current', nodeCount: 1 },
    assets: { status: 'current', currentCount: 1, staleCount: 0 },
    storyboard: {
      status: 'current',
      sequenceCount: 1,
      staleCount: 0,
      missingPlotNodeIds: [],
    },
    ready: true,
  });
  return service;
}

function assertDedicatedLocalPostgres(rawUrl: string): void {
  const url = new URL(rawUrl);
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new Error('Conflict integration tests require a local PostgreSQL.');
  }
}
