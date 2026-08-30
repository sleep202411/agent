import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  MediaAssetKind,
  MediaAssetModerationStatus,
  MediaAssetStatus,
  MediaAssetVariantKind,
  MediaAssetVariantStatus,
  Prisma,
  StoryProductionPlanDisposition,
  StoryProductionSpecStatus,
  StoryStoryboardBindingMode,
  type StoryAssetSpec,
  type StoryStoryboardClip,
  type StoryStoryboardSequence,
} from '@prisma/client';
import {
  StoryAssetPlanSchema,
  StoryProductionPlanSchema,
  StoryStoryboardPlanSchema,
  storyClipAssetMentions,
  type StoryAssetPlan,
  type StoryProductionPlan,
  type StoryStoryboardPlan,
} from '@repo/shared/story-production';
import type { StoryScreenplay } from '@repo/shared/story-agent';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import {
  resolveMediaPublicUrl,
  resolveMediaPublicVariantUrl,
} from '../infra/storage/media-asset-url-resolver.service';
import { canonicalJsonHash } from './canonical-json';
import {
  InteractiveStoryDraftContentSchema,
  type InteractiveStoryDraftContent,
} from './dto';
import { StoryPermissionService } from './story-permission.service';
import {
  storyProductionGenerationBasePath,
  toStoryProductionGenerationProgressDto,
} from './story-production-generation.dto';
import { StoryProjectWriteGuardService } from './story-project-write-guard.service';
import {
  readApprovedStoryScreenplaySnapshot,
  readCurrentStoryScreenplaySnapshot,
  readStoryScriptHead,
} from './story-script-stage';
import type {
  PatchStoryAssetSpecInput,
  PatchStoryStoryboardClipInput,
  PatchStoryStoryboardCueInput,
  PatchStoryStoryboardSequenceInput,
  PutStoryStoryboardTimelineInput,
  PutStoryStoryboardBindingInput,
  ResolveStoryProductionConflictInput,
} from './story-production-plan.schema';

const PUBLIC_MEDIA_ASSET_INCLUDE = Prisma.validator<Prisma.MediaAssetInclude>()(
  {
    placements: true,
    variants: {
      where: {
        deletedAt: null,
        status: MediaAssetVariantStatus.ready,
      },
      include: { placements: true },
    },
  },
);

const CREATIVE_MEDIA_VERSION_INCLUDE = {
  mediaAsset: { include: PUBLIC_MEDIA_ASSET_INCLUDE },
  preferredVariant: { include: { placements: true } },
} as const;

const ASSET_SPEC_INCLUDE = Prisma.validator<Prisma.StoryAssetSpecInclude>()({
  pendingPlanSnapshot: {
    select: {
      sourceFingerprint: true,
      planFingerprint: true,
      productionPlan: true,
    },
  },
  mediaVersions: {
    where: { archivedAt: null },
    orderBy: [{ versionNumber: 'desc' }, { id: 'asc' }],
    include: CREATIVE_MEDIA_VERSION_INCLUDE,
  },
  selectedMediaVersion: {
    include: CREATIVE_MEDIA_VERSION_INCLUDE,
  },
  generations: {
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 1,
    include: { aiJob: true },
  },
});

const STORYBOARD_INCLUDE =
  Prisma.validator<Prisma.StoryStoryboardSequenceInclude>()({
    pendingPlanSnapshot: {
      select: {
        sourceFingerprint: true,
        planFingerprint: true,
        productionPlan: true,
      },
    },
    clips: {
      where: { status: { not: StoryProductionSpecStatus.archived } },
      orderBy: [{ rank: 'asc' }, { id: 'asc' }],
      include: {
        mediaVersions: {
          where: { archivedAt: null },
          orderBy: [{ versionNumber: 'desc' }, { id: 'asc' }],
          include: CREATIVE_MEDIA_VERSION_INCLUDE,
        },
        selectedMediaVersion: {
          include: CREATIVE_MEDIA_VERSION_INCLUDE,
        },
        generations: {
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
          include: { aiJob: true },
        },
        assetBindings: {
          where: { status: { not: StoryProductionSpecStatus.archived } },
          orderBy: [{ rank: 'asc' }, { id: 'asc' }],
          include: {
            assetSpec: { include: ASSET_SPEC_INCLUDE },
            pinnedMediaVersion: {
              include: CREATIVE_MEDIA_VERSION_INCLUDE,
            },
          },
        },
      },
    },
    cues: {
      where: { status: { not: StoryProductionSpecStatus.archived } },
      orderBy: [{ atMs: 'asc' }, { id: 'asc' }],
    },
  });

type AssetSpecRow = Prisma.StoryAssetSpecGetPayload<{
  include: typeof ASSET_SPEC_INCLUDE;
}>;
type StoryboardSequenceRow = Prisma.StoryStoryboardSequenceGetPayload<{
  include: typeof STORYBOARD_INCLUDE;
}>;
type CreativeMediaVersionRow =
  | NonNullable<AssetSpecRow['selectedMediaVersion']>
  | NonNullable<StoryboardSequenceRow['clips'][number]['selectedMediaVersion']>;

interface StoryProductionApplyContext {
  storyProjectId: string;
  storyChapterId: string;
  actorUserId: string;
  /** Hash of the exact upstream source reconciled by this transaction. */
  sourceFingerprint: string;
}

export interface ApplyApprovedAssetPlanInput extends StoryProductionApplyContext {
  /** Canonical identities from the exact approved Plot interpretation. */
  canonicalCharacterIds: readonly string[];
  canonicalNodeIds: readonly string[];
  assetPlan: StoryAssetPlan;
}

export interface ApplyApprovedStoryboardPlanInput extends StoryProductionApplyContext {
  /** Immutable Asset source snapshot embedded in the Storyboard proposal. */
  assetPlan: StoryAssetPlan;
  storyboardPlan: StoryStoryboardPlan;
}

export interface InvalidateStoryProductionDownstreamInput extends StoryProductionApplyContext {
  /** The approval boundary whose true downstream stages must be invalidated. */
  upstreamStage: 'script' | 'plot';
  /** Unique approved upstream run; repeated approvals must invalidate too. */
  upstreamRunId: string;
}

/** Legacy whole-plan helper retained for old proposals and tests. */
export interface ApplyApprovedProductionPlanInput extends StoryProductionApplyContext {
  canonicalCharacterIds: readonly string[];
  productionPlan: StoryProductionPlan;
}

export interface StoryProductionReconcileResult {
  assetSpecsCreated: number;
  assetSpecsUpdated: number;
  assetSpecsMarkedStale: number;
  sequencesCreated: number;
  sequencesUpdated: number;
  sequencesMarkedStale: number;
}

export interface ValidateApprovedProductionPlanInput {
  productionPlan: StoryProductionPlan;
  draft: unknown;
  chapterNodeIds: readonly string[];
  canonicalCharacterIds: readonly string[];
}

export interface ValidateApprovedAssetPlanInput {
  assetPlan: StoryAssetPlan;
  canonicalNodeIds: readonly string[];
  canonicalCharacterIds: readonly string[];
}

export interface ValidateApprovedStoryboardPlanInput {
  storyboardPlan: StoryStoryboardPlan;
  assetPlan: StoryAssetPlan;
  draft: unknown;
  chapterNodeIds: readonly string[];
}

export type StoryProductionStageStatus = 'missing' | 'current' | 'stale';

export interface StoryProductionStateDto {
  projectId: string;
  chapterId: string;
  profile: { status: 'missing' | 'current' };
  script: {
    status: StoryProductionStageStatus;
    documentId: string | null;
    sequence: number | null;
  };
  plotTree: { status: StoryProductionStageStatus; nodeCount: number };
  assets: {
    status: StoryProductionStageStatus;
    currentCount: number;
    staleCount: number;
  };
  storyboard: {
    status: StoryProductionStageStatus;
    sequenceCount: number;
    staleCount: number;
    missingPlotNodeIds: string[];
  };
  ready: boolean;
}

@Injectable()
export class StoryProductionPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: StoryPermissionService,
    private readonly writeGuard: StoryProjectWriteGuardService,
  ) {}

  async getProductionState(
    user: AuthUser,
    projectId: string,
    chapterId: string,
  ): Promise<StoryProductionStateDto> {
    await this.requireScope(user, projectId, chapterId, 'story.read');
    return this.prisma.$transaction((tx) =>
      this.getProductionStateInTransaction(tx, projectId, chapterId),
    );
  }

  /**
   * Canonical transaction-local projection used by both story.read and the
   * authoring admission planner. No caller-supplied mode can bypass it.
   */
  async getProductionStateInTransaction(
    tx: Prisma.TransactionClient,
    projectId: string,
    chapterId: string,
  ): Promise<StoryProductionStateDto> {
    const [
      project,
      chapter,
      draft,
      assetRows,
      sequenceRows,
      scriptHead,
      approvedAssetPlanMarker,
    ] = await Promise.all([
      tx.storyProject.findUniqueOrThrow({ where: { id: projectId } }),
      tx.storyChapter.findFirstOrThrow({
        where: { id: chapterId, storyProjectId: projectId, archivedAt: null },
      }),
      tx.storyDraft.findUniqueOrThrow({
        where: { storyProjectId: projectId },
      }),
      tx.storyAssetSpec.findMany({
        where: {
          storyProjectId: projectId,
          storyChapterId: chapterId,
          status: { not: StoryProductionSpecStatus.archived },
        },
        select: {
          stableKey: true,
          status: true,
          planDisposition: true,
        },
      }),
      tx.storyStoryboardSequence.findMany({
        where: {
          storyProjectId: projectId,
          storyChapterId: chapterId,
          status: { not: StoryProductionSpecStatus.archived },
        },
        select: { plotNodeId: true, status: true },
      }),
      readStoryScriptHead(tx, projectId, chapterId),
      this.readApprovedAssetPlanMarkerInTransaction(tx, projectId, chapterId),
    ]);
    const parsedDraft = InteractiveStoryDraftContentSchema.parse(draft.content);
    const ownedNodeIds = new Set(jsonStringArray(chapter.nodeIds));
    const plotNodeIds = parsedDraft.graph.nodes
      .filter((node) => node.kind === 'clip' && ownedNodeIds.has(node.nodeId))
      .map((node) => node.nodeId);
    const sequenceByPlotNode = new Map(
      sequenceRows.map((sequence) => [sequence.plotNodeId, sequence]),
    );
    const missingPlotNodeIds = plotNodeIds.filter(
      (nodeId) => !sequenceByPlotNode.has(nodeId),
    );
    const staleSequenceCount = sequenceRows.filter(
      (sequence) => sequence.status === StoryProductionSpecStatus.stale,
    ).length;
    const currentAssetRows = assetRows.filter(
      (row) => row.status === StoryProductionSpecStatus.current,
    );
    const staleAssetRows = assetRows.filter(
      (row) => row.status === StoryProductionSpecStatus.stale,
    );
    const assetCurrent = currentAssetRows.length;
    const assetStale = staleAssetRows.length;
    const lineageMatchesHead =
      chapter.sourceScriptDocumentId === scriptHead.documentId &&
      chapter.sourceScriptSequence === scriptHead.sequence &&
      chapter.sourceScriptHash === scriptHead.hash;
    const [currentScreenplay, approvedPlotScreenplay] = await Promise.all([
      readCurrentStoryScreenplaySnapshot(tx, projectId, chapterId),
      lineageMatchesHead
        ? readApprovedStoryScreenplaySnapshot(tx, projectId, chapterId)
        : Promise.resolve(null),
    ]);
    const scriptStatus: StoryProductionStageStatus = !scriptHead.hasContent
      ? 'missing'
      : currentScreenplay !== null &&
          currentScreenplay.documentId === scriptHead.documentId &&
          currentScreenplay.sequence === scriptHead.sequence
        ? 'current'
        : 'stale';
    const plotStatus: StoryProductionStageStatus =
      plotNodeIds.length === 0
        ? 'missing'
        : scriptStatus === 'current' &&
            approvedPlotScreenplay !== null &&
            approvedPlotScreenplay.versionId === currentScreenplay?.versionId &&
            plotMatchesApprovedScreenplay(
              approvedPlotScreenplay.screenplay,
              parsedDraft,
              chapter.entryNodeId,
              ownedNodeIds,
            )
          ? 'current'
          : 'stale';
    const plotSourceFingerprint = chapterPlotFingerprint(
      parsedDraft,
      chapter.entryNodeId,
      ownedNodeIds,
    );
    const ownStoryboardStatus =
      sequenceRows.length === 0
        ? 'missing'
        : staleSequenceCount > 0 || missingPlotNodeIds.length > 0
          ? 'stale'
          : 'current';
    const assetMarkerMatchesPlot =
      approvedAssetPlanMarker !== null &&
      plotStatus === 'current' &&
      approvedAssetPlanMarker.sourceFingerprint === plotSourceFingerprint;
    const assetMarkerIsStale =
      approvedAssetPlanMarker !== null && !assetMarkerMatchesPlot;
    const expectedAssetKeys = assetMarkerMatchesPlot
      ? new Set(
          approvedAssetPlanMarker.plan.assetSpecs.map(
            (asset) => asset.stableKey,
          ),
        )
      : null;
    const currentAssetKeys = new Set(
      currentAssetRows.map((asset) => asset.stableKey),
    );
    const expectedAssetMissing =
      expectedAssetKeys !== null &&
      [...expectedAssetKeys].some(
        (stableKey) => !currentAssetKeys.has(stableKey),
      );
    const unexpectedPlannedAsset =
      expectedAssetKeys !== null &&
      currentAssetRows.some(
        (asset) =>
          !expectedAssetKeys.has(asset.stableKey) &&
          asset.planDisposition !==
            StoryProductionPlanDisposition.user_override,
      );
    const ownAssetStatus: StoryProductionStageStatus = assetMarkerIsStale
      ? 'stale'
      : expectedAssetKeys !== null
        ? assetStale === 0 && !expectedAssetMissing && !unexpectedPlannedAsset
          ? 'current'
          : 'stale'
        : assetRows.length > 0
          ? 'stale'
          : 'missing';
    const assetStatus =
      ownAssetStatus === 'missing'
        ? 'missing'
        : plotStatus === 'current' && ownAssetStatus === 'current'
          ? 'current'
          : 'stale';
    const storyboardStatus =
      ownStoryboardStatus === 'missing'
        ? 'missing'
        : plotStatus === 'current' &&
            assetStatus === 'current' &&
            ownStoryboardStatus === 'current'
          ? 'current'
          : 'stale';
    const profileStatus = project.creativeProfileConfirmedAt
      ? 'current'
      : 'missing';
    return {
      projectId,
      chapterId,
      profile: { status: profileStatus },
      script: {
        status: scriptStatus,
        documentId: scriptHead.documentId,
        sequence: scriptHead.documentId ? scriptHead.sequence : null,
      },
      plotTree: { status: plotStatus, nodeCount: plotNodeIds.length },
      assets: {
        status: assetStatus,
        currentCount: assetCurrent,
        staleCount: assetStale,
      },
      storyboard: {
        status: storyboardStatus,
        sequenceCount: sequenceRows.length,
        staleCount: staleSequenceCount,
        missingPlotNodeIds,
      },
      ready:
        profileStatus === 'current' &&
        scriptStatus === 'current' &&
        plotStatus === 'current' &&
        assetStatus === 'current' &&
        storyboardStatus === 'current',
    };
  }

  async listAssetSpecs(user: AuthUser, projectId: string, chapterId: string) {
    await this.requireScope(user, projectId, chapterId, 'story.read');
    const rows = await this.prisma.storyAssetSpec.findMany({
      where: {
        storyProjectId: projectId,
        storyChapterId: chapterId,
        status: { not: StoryProductionSpecStatus.archived },
      },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      include: ASSET_SPEC_INCLUDE,
    });
    return rows.map(toAssetSpecDto);
  }

  async getStoryboard(user: AuthUser, projectId: string, chapterId: string) {
    await this.requireScope(user, projectId, chapterId, 'story.read');
    const [chapter, draft, rows] = await Promise.all([
      this.prisma.storyChapter.findFirstOrThrow({
        where: { id: chapterId, storyProjectId: projectId, archivedAt: null },
        select: { nodeIds: true },
      }),
      this.prisma.storyDraft.findUniqueOrThrow({
        where: { storyProjectId: projectId },
        select: { content: true },
      }),
      this.prisma.storyStoryboardSequence.findMany({
        where: {
          storyProjectId: projectId,
          storyChapterId: chapterId,
          status: { not: StoryProductionSpecStatus.archived },
        },
        include: STORYBOARD_INCLUDE,
      }),
    ]);
    const content = InteractiveStoryDraftContentSchema.parse(draft.content);
    const ownedNodeIds = jsonStringArray(chapter.nodeIds);
    const ownedPlotNodes = content.graph.nodes
      .filter((node) => node.kind === 'clip')
      .filter((node) => ownedNodeIds.includes(node.nodeId));
    const sequenceByNode = new Map(
      rows.map((row) => [row.plotNodeId, row] as const),
    );
    const missingPlotNodeIds = ownedPlotNodes
      .filter((node) => !sequenceByNode.has(node.nodeId))
      .map((node) => node.nodeId);
    if (missingPlotNodeIds.length > 0) {
      throw new ConflictException({
        code: 'STORYBOARD_NODE_IDENTITY_CONFLICT',
        message:
          'The Plot tree and Storyboard are not one-to-one. Run the Storyboard identity repair before reading this chapter.',
        missingPlotNodeIds,
      });
    }
    return ownedPlotNodes.map((node) => {
      const row = sequenceByNode.get(node.nodeId);
      // Guarded above. Keeping this assertion local prevents a future query
      // refactor from silently reintroducing a graph-only scene.
      if (!row)
        throw new InternalServerErrorException(
          'Storyboard identity invariant failed.',
        );
      // Shared identity and title come only from StoryDraft. The relational
      // row owns timed shots, prompts and media, not a second scene name.
      return {
        ...toStoryboardSequenceDto(row),
        title: node.name?.trim() || node.clipKey,
      };
    });
  }

  async resolveAssetSpecConflict(
    user: AuthUser,
    projectId: string,
    chapterId: string,
    assetSpecId: string,
    idempotencyKey: string,
    input: ResolveStoryProductionConflictInput,
  ) {
    return this.mutateWithReceipt({
      user,
      projectId,
      chapterId,
      idempotencyKey,
      operation: 'asset-spec.conflict-resolution',
      request: { assetSpecId, input },
      mutate: async (tx, now) => {
        const current = await tx.storyAssetSpec.findFirst({
          where: {
            id: assetSpecId,
            storyProjectId: projectId,
            storyChapterId: chapterId,
          },
          include: { pendingPlanSnapshot: true },
        });
        if (!current) throw productionNotFound('Asset Spec', assetSpecId);
        const pending = readPendingConflict(current, input, 'Asset Spec');
        const pendingAssetPlan = assetPlanFromSnapshot(pending.plan);
        const item = pendingAssetPlan.assetSpecs.find(
          (candidate) => candidate.stableKey === current.stableKey,
        );
        const expectedFingerprint = item
          ? planFingerprint(pending.sourceFingerprint, 'asset', item)
          : planFingerprint(pending.sourceFingerprint, 'asset-removed', {
              stableKey: current.stableKey,
            });
        assertPendingFingerprint(current, expectedFingerprint);

        let outcome: 'kept_current' | 'applied_latest' | 'archived';
        if (input.resolution === 'keep_current') {
          const updated = await tx.storyAssetSpec.updateMany({
            where: pendingConflictCasWhere(current, input),
            data: {
              sourceFingerprint: expectedFingerprint,
              pendingSourceFingerprint: null,
              pendingPlanSnapshotId: null,
              planDisposition: StoryProductionPlanDisposition.user_override,
              status: StoryProductionSpecStatus.current,
              userModifiedAt: current.userModifiedAt ?? now,
              userModifiedByUserId: current.userModifiedByUserId ?? user.userId,
              version: { increment: 1 },
            },
          });
          if (updated.count !== 1) throw productionCasConflict('Asset Spec');
          outcome = 'kept_current';
        } else if (item) {
          const updated = await tx.storyAssetSpec.updateMany({
            where: pendingConflictCasWhere(current, input),
            data: {
              kind: item.kind,
              sourceCharacterId: item.sourceCharacterId ?? null,
              sourceNodeIds: item.sourceNodeIds,
              name: item.name,
              description: item.description,
              imagePrompt: item.imagePrompt,
              videoPrompt: item.videoPrompt ?? null,
              negativePrompt: item.negativePrompt ?? null,
              sourceFingerprint: expectedFingerprint,
              pendingSourceFingerprint: null,
              pendingPlanSnapshotId: null,
              planDisposition: StoryProductionPlanDisposition.planned,
              status: StoryProductionSpecStatus.current,
              userModifiedAt: null,
              userModifiedByUserId: null,
              lastPlannedAt: now,
              version: { increment: 1 },
            },
          });
          if (updated.count !== 1) throw productionCasConflict('Asset Spec');
          outcome = 'applied_latest';
        } else {
          const activeBindingCount =
            await tx.storyStoryboardClipAssetBinding.count({
              where: {
                assetSpecId: current.id,
                status: { not: StoryProductionSpecStatus.archived },
                storyboardClip: {
                  status: { not: StoryProductionSpecStatus.archived },
                  sequence: {
                    status: { not: StoryProductionSpecStatus.archived },
                  },
                },
              },
            });
          if (activeBindingCount > 0) {
            throw new ConflictException({
              code: 'STORY_PRODUCTION_ASSET_STILL_REFERENCED',
              message:
                'Resolve the affected Storyboard sequence with the latest plan before removing this Asset Spec, or keep the Asset Spec override.',
            });
          }
          const updated = await tx.storyAssetSpec.updateMany({
            where: pendingConflictCasWhere(current, input),
            data: {
              sourceFingerprint: expectedFingerprint,
              pendingSourceFingerprint: null,
              pendingPlanSnapshotId: null,
              planDisposition: StoryProductionPlanDisposition.planned,
              status: StoryProductionSpecStatus.archived,
              userModifiedAt: null,
              userModifiedByUserId: null,
              lastPlannedAt: now,
              version: { increment: 1 },
            },
          });
          if (updated.count !== 1) throw productionCasConflict('Asset Spec');
          outcome = 'archived';
        }

        const resolved = await tx.storyAssetSpec.findUniqueOrThrow({
          where: { id: current.id },
          include: ASSET_SPEC_INCLUDE,
        });
        return {
          targetKind: 'asset_spec' as const,
          targetId: resolved.id,
          resolution: input.resolution,
          outcome,
          item: toAssetSpecDto(resolved),
          productionState: await this.getProductionStateInTransaction(
            tx,
            projectId,
            chapterId,
          ),
        };
      },
    });
  }

  async resolveStoryboardSequenceConflict(
    user: AuthUser,
    projectId: string,
    chapterId: string,
    sequenceId: string,
    idempotencyKey: string,
    input: ResolveStoryProductionConflictInput,
  ) {
    return this.mutateWithReceipt({
      user,
      projectId,
      chapterId,
      idempotencyKey,
      operation: 'storyboard-sequence.conflict-resolution',
      request: { sequenceId, input },
      mutate: async (tx, now) => {
        const current = await tx.storyStoryboardSequence.findFirst({
          where: {
            id: sequenceId,
            storyProjectId: projectId,
            storyChapterId: chapterId,
          },
          include: { pendingPlanSnapshot: true },
        });
        if (!current) {
          throw productionNotFound('Storyboard sequence', sequenceId);
        }
        const pending = readPendingConflict(
          current,
          input,
          'Storyboard sequence',
        );
        const pendingStoryboardPlan = storyboardPlanFromSnapshot(pending.plan);
        const item = pendingStoryboardPlan.storyboardSequences.find(
          (candidate) => candidate.plotNodeId === current.plotNodeId,
        );
        const expectedFingerprint = item
          ? planFingerprint(pending.sourceFingerprint, 'sequence', item)
          : planFingerprint(pending.sourceFingerprint, 'sequence-removed', {
              plotNodeId: current.plotNodeId,
            });
        assertPendingFingerprint(current, expectedFingerprint);

        let outcome: 'kept_current' | 'applied_latest' | 'archived';
        if (input.resolution === 'keep_current') {
          if (!item) {
            throw new ConflictException({
              code: 'STORY_PRODUCTION_REMOVED_SEQUENCE_OVERRIDE_UNSUPPORTED',
              message:
                'A Storyboard sequence whose Plot node was removed cannot remain as an override. Use the latest plan to archive it.',
            });
          }
          const updated = await tx.storyStoryboardSequence.updateMany({
            where: pendingConflictCasWhere(current, input),
            data: {
              sourceFingerprint: expectedFingerprint,
              pendingSourceFingerprint: null,
              pendingPlanSnapshotId: null,
              planDisposition: StoryProductionPlanDisposition.user_override,
              status: StoryProductionSpecStatus.current,
              userModifiedAt: current.userModifiedAt ?? now,
              userModifiedByUserId: current.userModifiedByUserId ?? user.userId,
              version: { increment: 1 },
            },
          });
          if (updated.count !== 1) {
            throw productionCasConflict('Storyboard sequence');
          }
          outcome = 'kept_current';
        } else if (!item) {
          await this.archiveSequenceChildren(tx, current.id);
          const updated = await tx.storyStoryboardSequence.updateMany({
            where: pendingConflictCasWhere(current, input),
            data: {
              sourceFingerprint: expectedFingerprint,
              pendingSourceFingerprint: null,
              pendingPlanSnapshotId: null,
              planDisposition: StoryProductionPlanDisposition.planned,
              status: StoryProductionSpecStatus.archived,
              userModifiedAt: null,
              userModifiedByUserId: null,
              lastPlannedAt: now,
              version: { increment: 1 },
            },
          });
          if (updated.count !== 1) {
            throw productionCasConflict('Storyboard sequence');
          }
          outcome = 'archived';
        } else {
          const assetRows = await tx.storyAssetSpec.findMany({
            where: {
              storyProjectId: projectId,
              storyChapterId: chapterId,
            },
          });
          const updated = await tx.storyStoryboardSequence.updateMany({
            where: pendingConflictCasWhere(current, input),
            data: {
              stableKey: item.plotNodeId,
              description: item.description,
              suggestedDurationMs: item.durationMs,
              durationMs: item.durationMs,
              sourceFingerprint: expectedFingerprint,
              pendingSourceFingerprint: null,
              pendingPlanSnapshotId: null,
              planDisposition: StoryProductionPlanDisposition.planned,
              status: StoryProductionSpecStatus.current,
              userModifiedAt: null,
              userModifiedByUserId: null,
              lastPlannedAt: now,
              version: { increment: 1 },
            },
          });
          if (updated.count !== 1) {
            throw productionCasConflict('Storyboard sequence');
          }
          await this.reconcileSequenceChildren(
            tx,
            {
              storyProjectId: projectId,
              storyChapterId: chapterId,
              actorUserId: user.userId,
              sourceFingerprint: pending.sourceFingerprint,
            },
            item,
            { ...current, version: current.version + 1 },
            new Map(assetRows.map((asset) => [asset.stableKey, asset])),
            now,
            {
              clearUserModifications: true,
              preserveCompatibleBindings: true,
            },
          );
          outcome = 'applied_latest';
        }

        const resolved = await tx.storyStoryboardSequence.findUniqueOrThrow({
          where: { id: current.id },
          include: STORYBOARD_INCLUDE,
        });
        return {
          targetKind: 'storyboard_sequence' as const,
          targetId: resolved.id,
          resolution: input.resolution,
          outcome,
          item: toStoryboardSequenceDto(resolved),
          productionState: await this.getProductionStateInTransaction(
            tx,
            projectId,
            chapterId,
          ),
        };
      },
    });
  }

  async patchAssetSpec(
    user: AuthUser,
    projectId: string,
    chapterId: string,
    assetSpecId: string,
    idempotencyKey: string,
    input: PatchStoryAssetSpecInput,
  ) {
    return this.mutateWithReceipt({
      user,
      projectId,
      chapterId,
      idempotencyKey,
      operation: 'asset-spec.patch',
      request: { assetSpecId, input },
      mutate: async (tx, now) => {
        const current = await tx.storyAssetSpec.findFirst({
          where: {
            id: assetSpecId,
            storyProjectId: projectId,
            storyChapterId: chapterId,
          },
        });
        if (!current) throw productionNotFound('Asset Spec', assetSpecId);
        if (input.selectedMediaVersionId) {
          await requireAssetMediaVersion(
            tx,
            input.selectedMediaVersionId,
            current.id,
            projectId,
            chapterId,
          );
        }
        let importedMediaVersionId: string | null = null;
        if (input.sourceMediaAssetId) {
          const source = await requireAssetSpecCandidateImage(
            tx,
            projectId,
            input.sourceMediaAssetId,
          );
          const latest = await tx.storyAssetMediaVersion.findFirst({
            where: { assetSpecId: current.id },
            orderBy: { versionNumber: 'desc' },
            select: { versionNumber: true },
          });
          const imported = await tx.storyAssetMediaVersion.create({
            data: {
              storyProjectId: projectId,
              storyChapterId: chapterId,
              assetSpecId: current.id,
              versionNumber: (latest?.versionNumber ?? 0) + 1,
              mediaAssetId: source.id,
              sourceFingerprint: current.sourceFingerprint,
              generationSnapshot: {
                version: 1,
                source: 'user_media',
                mediaAssetId: source.id,
              },
              createdByUserId: user.userId,
            },
            select: { id: true },
          });
          importedMediaVersionId = imported.id;
        }
        const semanticModified = storyAssetSemanticPatch(input);
        const updated = await tx.storyAssetSpec.updateMany({
          where: { id: current.id, version: input.expectedVersion },
          data: {
            ...defined(input, 'name'),
            ...defined(input, 'description'),
            ...defined(input, 'imagePrompt'),
            ...defined(input, 'videoPrompt'),
            ...defined(input, 'negativePrompt'),
            ...(importedMediaVersionId
              ? { selectedMediaVersionId: importedMediaVersionId }
              : defined(input, 'selectedMediaVersionId')),
            ...(semanticModified
              ? {
                  userModifiedAt: now,
                  userModifiedByUserId: user.userId,
                }
              : {}),
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) throw productionCasConflict('Asset Spec');
        return toAssetSpecDto(
          await tx.storyAssetSpec.findUniqueOrThrow({
            where: { id: current.id },
            include: ASSET_SPEC_INCLUDE,
          }),
        );
      },
    });
  }

  async patchSequence(
    user: AuthUser,
    projectId: string,
    chapterId: string,
    sequenceId: string,
    idempotencyKey: string,
    input: PatchStoryStoryboardSequenceInput,
  ) {
    return this.mutateWithReceipt({
      user,
      projectId,
      chapterId,
      idempotencyKey,
      operation: 'storyboard-sequence.patch',
      request: { sequenceId, input },
      mutate: async (tx, now) => {
        const sequence = await tx.storyStoryboardSequence.findFirst({
          where: {
            id: sequenceId,
            storyProjectId: projectId,
            storyChapterId: chapterId,
          },
        });
        if (!sequence)
          throw productionNotFound('Storyboard sequence', sequenceId);
        const updated = await tx.storyStoryboardSequence.updateMany({
          where: { id: sequence.id, version: input.expectedVersion },
          data: {
            ...defined(input, 'description'),
            userModifiedAt: now,
            userModifiedByUserId: user.userId,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1)
          throw productionCasConflict('Storyboard sequence');
        return toStoryboardSequenceDto(
          await tx.storyStoryboardSequence.findUniqueOrThrow({
            where: { id: sequence.id },
            include: STORYBOARD_INCLUDE,
          }),
        );
      },
    });
  }

  /**
   * Replace one complete visual timeline atomically. Existing bindings and
   * creative media stay attached to retained clip ids; omitted clips and their
   * bindings are archived. This command is deliberately separate from clip
   * metadata PATCH because no sequence of independent coordinate writes can
   * preserve the database's continuous-coverage invariant.
   */
  async putTimeline(
    user: AuthUser,
    projectId: string,
    chapterId: string,
    sequenceId: string,
    idempotencyKey: string,
    input: PutStoryStoryboardTimelineInput,
  ) {
    return this.mutateWithReceipt({
      user,
      projectId,
      chapterId,
      idempotencyKey,
      operation: 'storyboard-timeline.put',
      request: { sequenceId, input },
      mutate: async (tx, now) => {
        const sequence = await tx.storyStoryboardSequence.findFirst({
          where: {
            id: sequenceId,
            storyProjectId: projectId,
            storyChapterId: chapterId,
            status: { not: StoryProductionSpecStatus.archived },
          },
        });
        if (!sequence) {
          throw productionNotFound('Storyboard sequence', sequenceId);
        }
        if (sequence.version !== input.expectedVersion) {
          throw productionCasConflict('Storyboard sequence');
        }

        const [allClips, cues] = await Promise.all([
          tx.storyStoryboardClip.findMany({
            where: {
              sequenceId,
              storyProjectId: projectId,
              storyChapterId: chapterId,
            },
            orderBy: [{ rank: 'asc' }, { id: 'asc' }],
          }),
          tx.storyStoryboardCue.findMany({
            where: {
              sequenceId,
              storyProjectId: projectId,
              storyChapterId: chapterId,
              status: { not: StoryProductionSpecStatus.archived },
            },
            select: { id: true, atMs: true, version: true },
          }),
        ]);
        if (
          cues.some(
            (cue) =>
              storyboardCueTimeAfterTimelineResize(
                cue.atMs,
                sequence.durationMs,
                input.durationMs,
              ) > input.durationMs,
          )
        ) {
          throw new BadRequestException({
            code: 'STORYBOARD_CUE_OUT_OF_RANGE',
            message:
              'Every Storyboard cue must remain within the replacement timeline duration.',
          });
        }

        const activeClips = allClips.filter(
          (clip) => clip.status !== StoryProductionSpecStatus.archived,
        );
        const activeById = new Map(activeClips.map((clip) => [clip.id, clip]));
        const everyStableKey = new Map(
          allClips.map((clip) => [clip.stableKey, clip]),
        );
        const retainedIds = new Set<string>();
        const importedMedia = new Map<
          string,
          { id: string; kind: MediaAssetKind }
        >();

        for (const clipInput of input.clips) {
          if (!clipInput.id) {
            if (everyStableKey.has(clipInput.stableKey)) {
              throw new ConflictException({
                code: 'STORYBOARD_CLIP_STABLE_KEY_CONFLICT',
                message:
                  'A new Storyboard clip must use a stable key that has never belonged to this sequence.',
              });
            }
            if (clipInput.sourceMediaAssetId) {
              const source = await requireStoryboardCandidateMedia(
                tx,
                projectId,
                clipInput.sourceMediaAssetId,
                clipInput.kind,
              );
              importedMedia.set(source.id, source);
            }
            continue;
          }
          const existing = activeById.get(clipInput.id);
          if (!existing) {
            throw productionNotFound('Storyboard clip', clipInput.id);
          }
          if (existing.version !== clipInput.expectedVersion) {
            throw productionCasConflict('Storyboard clip');
          }
          if (existing.stableKey !== clipInput.stableKey) {
            throw new BadRequestException({
              code: 'STORYBOARD_CLIP_STABLE_KEY_IMMUTABLE',
              message:
                'An existing Storyboard clip stable key cannot be changed.',
            });
          }
          retainedIds.add(existing.id);
        }

        // Move every rank into a disjoint range first. The ordinary unique
        // index is immediate, so a naive rank+constant rewrite can collide
        // with another row's old rank. The offset band must clear BOTH the
        // old ranks and the new compact ranks 0..n-1 written below, because
        // omitted rows keep their shifted slots until they are archived after
        // the write loop.
        if (allClips.length > 0) {
          const maximumRank = Math.max(...allClips.map((clip) => clip.rank));
          const offset = Math.max(maximumRank, input.clips.length - 1) + 1;
          if (maximumRank + offset > 2_147_483_647) {
            throw new InternalServerErrorException({
              code: 'STORYBOARD_TIMELINE_RANK_EXHAUSTED',
              message: 'The Storyboard timeline rank space is exhausted.',
            });
          }
          await tx.storyStoryboardClip.updateMany({
            where: { sequenceId },
            data: { rank: { increment: offset } },
          });
        }

        for (const [rank, clipInput] of input.clips.entries()) {
          assertClipPromptShape(
            clipInput.kind,
            clipInput.imagePrompt,
            clipInput.videoPrompt,
          );
          if (!clipInput.id) {
            const sourceFingerprint = canonicalJsonHash({
              kind: 'human-storyboard-clip',
              projectId,
              chapterId,
              sequenceId,
              stableKey: clipInput.stableKey,
            });
            const created = await tx.storyStoryboardClip.create({
              data: {
                storyProjectId: projectId,
                storyChapterId: chapterId,
                sequenceId,
                stableKey: clipInput.stableKey,
                title: clipInput.title,
                rank,
                kind: clipInput.kind,
                track: 'visual',
                startMs: clipInput.startMs,
                durationMs: clipInput.durationMs,
                description: clipInput.description,
                imagePrompt: clipInput.imagePrompt,
                videoPrompt: clipInput.videoPrompt,
                negativePrompt: clipInput.negativePrompt,
                sourceFingerprint,
                createdByUserId: user.userId,
                userModifiedAt: now,
                userModifiedByUserId: user.userId,
              },
              select: { id: true },
            });
            if (clipInput.sourceMediaAssetId) {
              const source = importedMedia.get(clipInput.sourceMediaAssetId);
              if (!source) {
                throw new InternalServerErrorException({
                  code: 'STORYBOARD_CLIP_SOURCE_MEDIA_UNRESOLVED',
                  message:
                    'The validated imported media could not be resolved.',
                });
              }
              const mediaVersion =
                await tx.storyStoryboardClipMediaVersion.create({
                  data: {
                    storyProjectId: projectId,
                    storyChapterId: chapterId,
                    storyboardClipId: created.id,
                    versionNumber: 1,
                    mediaAssetId: source.id,
                    sourceFingerprint,
                    generationSnapshot: {
                      version: 1,
                      source: 'user_media',
                      mediaAssetId: source.id,
                    },
                    createdByUserId: user.userId,
                  },
                  select: { id: true },
                });
              await tx.storyStoryboardClip.update({
                where: { id: created.id },
                data: { selectedMediaVersionId: mediaVersion.id },
              });
            }
            continue;
          }
          const existing = activeById.get(clipInput.id)!;
          const updated = await tx.storyStoryboardClip.updateMany({
            where: { id: existing.id, version: clipInput.expectedVersion },
            data: {
              title: clipInput.title,
              rank,
              kind: clipInput.kind,
              track: 'visual',
              startMs: clipInput.startMs,
              durationMs: clipInput.durationMs,
              description: clipInput.description,
              imagePrompt: clipInput.imagePrompt,
              videoPrompt: clipInput.videoPrompt,
              negativePrompt: clipInput.negativePrompt,
              ...(existing.kind === clipInput.kind
                ? {}
                : { selectedMediaVersionId: null }),
              userModifiedAt: now,
              userModifiedByUserId: user.userId,
              version: { increment: 1 },
            },
          });
          if (updated.count !== 1) {
            throw productionCasConflict('Storyboard clip');
          }
        }

        const omitted = activeClips.filter((clip) => !retainedIds.has(clip.id));
        let archivedRank = input.clips.length;
        for (const clip of omitted) {
          await tx.storyStoryboardClipAssetBinding.updateMany({
            where: { storyboardClipId: clip.id },
            data: {
              status: StoryProductionSpecStatus.archived,
              pendingSourceFingerprint: null,
            },
          });
          await tx.storyStoryboardCue.updateMany({
            where: { storyboardClipId: clip.id },
            data: {
              storyboardClipId: null,
              userModifiedAt: now,
              userModifiedByUserId: user.userId,
              version: { increment: 1 },
            },
          });
          const archived = await tx.storyStoryboardClip.updateMany({
            where: { id: clip.id, version: clip.version },
            data: {
              rank: archivedRank++,
              status: StoryProductionSpecStatus.archived,
              pendingSourceFingerprint: null,
              userModifiedAt: now,
              userModifiedByUserId: user.userId,
              version: { increment: 1 },
            },
          });
          if (archived.count !== 1) {
            throw productionCasConflict('Storyboard clip');
          }
        }
        for (const clip of allClips) {
          if (clip.status !== StoryProductionSpecStatus.archived) continue;
          await tx.storyStoryboardClip.update({
            where: { id: clip.id },
            data: { rank: archivedRank++ },
          });
        }

        // Cues exactly on the old tail are semantically end-anchored. Keep a
        // decision/interaction at the end when a creator appends or removes
        // footage; otherwise appended clips would become unreachable during
        // playback. Mid-timeline cues retain their absolute coordinates.
        if (sequence.durationMs !== input.durationMs) {
          for (const cue of cues) {
            const nextAtMs = storyboardCueTimeAfterTimelineResize(
              cue.atMs,
              sequence.durationMs,
              input.durationMs,
            );
            if (nextAtMs === cue.atMs) continue;
            const updatedCue = await tx.storyStoryboardCue.updateMany({
              where: { id: cue.id, version: cue.version },
              data: {
                atMs: nextAtMs,
                userModifiedAt: now,
                userModifiedByUserId: user.userId,
                version: { increment: 1 },
              },
            });
            if (updatedCue.count !== 1) {
              throw productionCasConflict('Storyboard cue');
            }
          }
        }

        const updatedSequence = await tx.storyStoryboardSequence.updateMany({
          where: { id: sequence.id, version: input.expectedVersion },
          data: {
            durationMs: input.durationMs,
            userModifiedAt: now,
            userModifiedByUserId: user.userId,
            version: { increment: 1 },
          },
        });
        if (updatedSequence.count !== 1) {
          throw productionCasConflict('Storyboard sequence');
        }
        return toStoryboardSequenceDto(
          await tx.storyStoryboardSequence.findUniqueOrThrow({
            where: { id: sequence.id },
            include: STORYBOARD_INCLUDE,
          }),
        );
      },
    });
  }

  async patchClip(
    user: AuthUser,
    projectId: string,
    chapterId: string,
    sequenceId: string,
    clipId: string,
    idempotencyKey: string,
    input: PatchStoryStoryboardClipInput,
  ) {
    return this.mutateWithReceipt({
      user,
      projectId,
      chapterId,
      idempotencyKey,
      operation: 'storyboard-clip.patch',
      request: { sequenceId, clipId, input },
      mutate: async (tx, now) => {
        const clip = await tx.storyStoryboardClip.findFirst({
          where: {
            id: clipId,
            sequenceId,
            storyProjectId: projectId,
            storyChapterId: chapterId,
          },
        });
        if (!clip) throw productionNotFound('Storyboard clip', clipId);
        const nextKind = input.kind ?? clip.kind;
        if (input.selectedMediaVersionId) {
          await requireClipMediaVersion(
            tx,
            input.selectedMediaVersionId,
            clip.id,
            projectId,
            chapterId,
            nextKind,
          );
        }
        let importedMediaVersionId: string | null = null;
        if (input.sourceMediaAssetId) {
          const source = await requireStoryboardCandidateMedia(
            tx,
            projectId,
            input.sourceMediaAssetId,
            nextKind,
          );
          const latest = await tx.storyStoryboardClipMediaVersion.findFirst({
            where: { storyboardClipId: clip.id },
            orderBy: { versionNumber: 'desc' },
            select: { versionNumber: true },
          });
          const imported = await tx.storyStoryboardClipMediaVersion.create({
            data: {
              storyProjectId: projectId,
              storyChapterId: chapterId,
              storyboardClipId: clip.id,
              versionNumber: (latest?.versionNumber ?? 0) + 1,
              mediaAssetId: source.id,
              sourceFingerprint: clip.sourceFingerprint,
              generationSnapshot: {
                version: 1,
                source: 'user_media',
                mediaAssetId: source.id,
              },
              createdByUserId: user.userId,
            },
            select: { id: true },
          });
          importedMediaVersionId = imported.id;
        }
        const nextImagePrompt =
          input.imagePrompt === undefined
            ? clip.imagePrompt
            : input.imagePrompt;
        const nextVideoPrompt =
          input.videoPrompt === undefined
            ? clip.videoPrompt
            : input.videoPrompt;
        assertClipPromptShape(nextKind, nextImagePrompt, nextVideoPrompt);
        const semanticModified = storyboardClipSemanticPatch(input);
        const updated = await tx.storyStoryboardClip.updateMany({
          where: { id: clip.id, version: input.expectedVersion },
          data: {
            ...defined(input, 'kind'),
            ...defined(input, 'title'),
            ...defined(input, 'description'),
            ...defined(input, 'imagePrompt'),
            ...defined(input, 'videoPrompt'),
            ...defined(input, 'negativePrompt'),
            ...(importedMediaVersionId
              ? { selectedMediaVersionId: importedMediaVersionId }
              : input.selectedMediaVersionId !== undefined
                ? { selectedMediaVersionId: input.selectedMediaVersionId }
                : nextKind !== clip.kind
                  ? { selectedMediaVersionId: null }
                  : {}),
            ...(semanticModified
              ? {
                  userModifiedAt: now,
                  userModifiedByUserId: user.userId,
                }
              : {}),
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) throw productionCasConflict('Storyboard clip');
        const sequence = toStoryboardSequenceDto(
          await tx.storyStoryboardSequence.findUniqueOrThrow({
            where: { id: sequenceId },
            include: STORYBOARD_INCLUDE,
          }),
        );
        const patchedClip = sequence.clips.find((item) => item.id === clip.id);
        if (!patchedClip) {
          throw new InternalServerErrorException({
            code: 'STORYBOARD_CLIP_PATCH_RESULT_MISSING',
            message: 'The updated Storyboard clip could not be loaded.',
          });
        }
        return patchedClip;
      },
    });
  }

  async putBinding(
    user: AuthUser,
    projectId: string,
    chapterId: string,
    sequenceId: string,
    clipId: string,
    assetSpecId: string,
    idempotencyKey: string,
    input: PutStoryStoryboardBindingInput,
  ) {
    return this.mutateWithReceipt({
      user,
      projectId,
      chapterId,
      idempotencyKey,
      operation: 'storyboard-binding.put',
      request: { sequenceId, clipId, assetSpecId, input },
      mutate: async (tx, now) => {
        const [clip, assetSpec] = await Promise.all([
          tx.storyStoryboardClip.findFirst({
            where: {
              id: clipId,
              sequenceId,
              storyProjectId: projectId,
              storyChapterId: chapterId,
            },
          }),
          tx.storyAssetSpec.findFirst({
            where: {
              id: assetSpecId,
              storyProjectId: projectId,
              storyChapterId: chapterId,
            },
          }),
        ]);
        if (!clip) throw productionNotFound('Storyboard clip', clipId);
        if (!assetSpec) throw productionNotFound('Asset Spec', assetSpecId);
        if (input.pinnedMediaVersionId) {
          await requireAssetMediaVersion(
            tx,
            input.pinnedMediaVersionId,
            assetSpec.id,
            projectId,
            chapterId,
          );
        }
        const existing = await tx.storyStoryboardClipAssetBinding.findUnique({
          where: {
            storyboardClipId_assetSpecId_role: {
              storyboardClipId: clip.id,
              assetSpecId: assetSpec.id,
              role: input.role,
            },
          },
        });
        const fingerprint = canonicalJsonHash({
          kind: 'human-binding',
          clipId,
          assetSpecId,
          role: input.role,
        });
        if (!existing) {
          if (input.expectedVersion !== 0)
            throw productionCasConflict('Storyboard binding');
          await tx.storyStoryboardClipAssetBinding.create({
            data: {
              storyProjectId: projectId,
              storyChapterId: chapterId,
              storyboardClipId: clip.id,
              assetSpecId: assetSpec.id,
              role: input.role,
              mode: input.mode,
              pinnedMediaVersionId: input.pinnedMediaVersionId ?? null,
              required: input.required,
              rank: input.rank,
              sourceFingerprint: fingerprint,
              createdByUserId: user.userId,
              userModifiedAt: now,
              userModifiedByUserId: user.userId,
            },
          });
        } else {
          const updated = await tx.storyStoryboardClipAssetBinding.updateMany({
            where: { id: existing.id, version: input.expectedVersion },
            data: {
              mode: input.mode,
              pinnedMediaVersionId: input.pinnedMediaVersionId ?? null,
              required: input.required,
              rank: input.rank,
              status: StoryProductionSpecStatus.current,
              pendingSourceFingerprint: null,
              userModifiedAt: now,
              userModifiedByUserId: user.userId,
              version: { increment: 1 },
            },
          });
          if (updated.count !== 1)
            throw productionCasConflict('Storyboard binding');
        }
        return toStoryboardSequenceDto(
          await tx.storyStoryboardSequence.findUniqueOrThrow({
            where: { id: sequenceId },
            include: STORYBOARD_INCLUDE,
          }),
        );
      },
    });
  }

  async patchCue(
    user: AuthUser,
    projectId: string,
    chapterId: string,
    sequenceId: string,
    cueId: string,
    idempotencyKey: string,
    input: PatchStoryStoryboardCueInput,
  ) {
    return this.mutateWithReceipt({
      user,
      projectId,
      chapterId,
      idempotencyKey,
      operation: 'storyboard-cue.patch',
      request: { sequenceId, cueId, input },
      mutate: async (tx, now) => {
        const sequence = await tx.storyStoryboardSequence.findFirst({
          where: {
            id: sequenceId,
            storyProjectId: projectId,
            storyChapterId: chapterId,
          },
        });
        if (!sequence)
          throw productionNotFound('Storyboard sequence', sequenceId);
        if (input.atMs > sequence.durationMs) {
          throw new BadRequestException({
            code: 'STORYBOARD_CUE_OUT_OF_RANGE',
            message:
              'A Storyboard cue must occur within its sequence duration.',
          });
        }
        const updated = await tx.storyStoryboardCue.updateMany({
          where: {
            id: cueId,
            sequenceId,
            storyProjectId: projectId,
            storyChapterId: chapterId,
            version: input.expectedVersion,
          },
          data: {
            atMs: input.atMs,
            userModifiedAt: now,
            userModifiedByUserId: user.userId,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) throw productionCasConflict('Storyboard cue');
        return toStoryboardSequenceDto(
          await tx.storyStoryboardSequence.findUniqueOrThrow({
            where: { id: sequenceId },
            include: STORYBOARD_INCLUDE,
          }),
        );
      },
    });
  }

  /**
   * Reconcile one approved plan into chapter-owned production specifications.
   * Legacy whole-plan helper: new authoring runs call the independent Asset and
   * Storyboard methods below so neither stage can pre-generate the next one.
   */
  async applyApprovedProductionPlanInTransaction(
    tx: Prisma.TransactionClient,
    rawInput: ApplyApprovedProductionPlanInput,
  ): Promise<StoryProductionReconcileResult> {
    const productionPlan = StoryProductionPlanSchema.parse(
      rawInput.productionPlan,
    );
    assertProductionSourceFingerprint(rawInput.sourceFingerprint);
    const [chapter, draftRow] = await Promise.all([
      tx.storyChapter.findFirst({
        where: {
          id: rawInput.storyChapterId,
          storyProjectId: rawInput.storyProjectId,
        },
      }),
      tx.storyDraft.findUnique({
        where: { storyProjectId: rawInput.storyProjectId },
      }),
    ]);
    if (!chapter || !draftRow) {
      throw new NotFoundException({
        code: 'STORY_CHAPTER_NOT_FOUND',
        message: 'Story chapter not found.',
      });
    }
    this.validateApprovedProductionPlan({
      productionPlan,
      draft: draftRow.content,
      chapterNodeIds: jsonStringArray(chapter.nodeIds),
      canonicalCharacterIds: rawInput.canonicalCharacterIds,
    });

    const result = emptyReconcileResult();
    const now = new Date();
    const planSnapshot = await this.ensurePlanSnapshot(
      tx,
      rawInput,
      productionPlan,
    );
    await this.pinApprovedAssetPlanSnapshotInTransaction(
      tx,
      rawInput.storyProjectId,
      rawInput.storyChapterId,
      planSnapshot.id,
    );
    const assetPlan = StoryAssetPlanSchema.parse({
      assetSpecs: productionPlan.assetSpecs,
    });
    const storyboardPlan = StoryStoryboardPlanSchema.parse({
      storyboardSequences: productionPlan.storyboardSequences,
    });
    const assetByKey = await this.reconcileAssetSpecs(
      tx,
      rawInput,
      assetPlan,
      planSnapshot.id,
      now,
      result,
    );
    await this.reconcileStoryboard(
      tx,
      rawInput,
      storyboardPlan,
      planSnapshot.id,
      assetByKey,
      now,
      result,
    );
    return result;
  }

  /**
   * Apply only approved logical Asset Specs. Any existing Storyboard becomes
   * stale when the approved Asset set changes; no Storyboard is generated or
   * reconciled in this stage.
   */
  async applyApprovedAssetPlanInTransaction(
    tx: Prisma.TransactionClient,
    rawInput: ApplyApprovedAssetPlanInput,
  ): Promise<StoryProductionReconcileResult> {
    const assetPlan = StoryAssetPlanSchema.parse(rawInput.assetPlan);
    assertProductionSourceFingerprint(rawInput.sourceFingerprint);
    const [chapter, beforeAssetPlan] = await Promise.all([
      tx.storyChapter.findFirst({
        where: {
          id: rawInput.storyChapterId,
          storyProjectId: rawInput.storyProjectId,
        },
      }),
      this.readCurrentAssetPlanInTransaction(
        tx,
        rawInput.storyProjectId,
        rawInput.storyChapterId,
      ),
    ]);
    if (!chapter) {
      throw new NotFoundException({
        code: 'STORY_CHAPTER_NOT_FOUND',
        message: 'Story chapter not found.',
      });
    }
    this.validateApprovedAssetPlan({
      assetPlan,
      canonicalNodeIds: rawInput.canonicalNodeIds,
      canonicalCharacterIds: rawInput.canonicalCharacterIds,
    });

    const result = emptyReconcileResult();
    const now = new Date();
    const snapshot = await this.ensurePlanSnapshot(tx, rawInput, assetPlan);
    await this.pinApprovedAssetPlanSnapshotInTransaction(
      tx,
      rawInput.storyProjectId,
      rawInput.storyChapterId,
      snapshot.id,
    );
    await this.reconcileAssetSpecs(
      tx,
      rawInput,
      assetPlan,
      snapshot.id,
      now,
      result,
    );
    const afterAssetPlan = await this.readCurrentAssetPlanInTransaction(
      tx,
      rawInput.storyProjectId,
      rawInput.storyChapterId,
    );
    const beforeFingerprint = beforeAssetPlan
      ? storyAssetPlanFingerprint(beforeAssetPlan)
      : null;
    const afterFingerprint = afterAssetPlan
      ? storyAssetPlanFingerprint(afterAssetPlan)
      : null;
    if (
      result.assetSpecsMarkedStale > 0 ||
      beforeFingerprint !== afterFingerprint
    ) {
      result.sequencesMarkedStale +=
        await this.invalidateStoryboardForAssetPlan(
          tx,
          rawInput,
          storyAssetPlanFingerprint(assetPlan),
          now,
        );
    }
    return result;
  }

  /**
   * Apply only approved Storyboard sequences. The proposal's embedded Asset
   * source must still exactly match the current approved Asset Specs.
   */
  async applyApprovedStoryboardPlanInTransaction(
    tx: Prisma.TransactionClient,
    rawInput: ApplyApprovedStoryboardPlanInput,
  ): Promise<StoryProductionReconcileResult> {
    const storyboardPlan = StoryStoryboardPlanSchema.parse(
      rawInput.storyboardPlan,
    );
    const proposalAssetPlan = StoryAssetPlanSchema.parse(rawInput.assetPlan);
    assertProductionSourceFingerprint(rawInput.sourceFingerprint);
    const [chapter, draftRow, currentAssetPlan] = await Promise.all([
      tx.storyChapter.findFirst({
        where: {
          id: rawInput.storyChapterId,
          storyProjectId: rawInput.storyProjectId,
        },
      }),
      tx.storyDraft.findUnique({
        where: { storyProjectId: rawInput.storyProjectId },
      }),
      this.readCurrentAssetPlanInTransaction(
        tx,
        rawInput.storyProjectId,
        rawInput.storyChapterId,
      ),
    ]);
    if (!chapter || !draftRow) {
      throw new NotFoundException({
        code: 'STORY_CHAPTER_NOT_FOUND',
        message: 'Story chapter not found.',
      });
    }
    if (
      currentAssetPlan === null ||
      storyAssetPlanFingerprint(currentAssetPlan) !==
        storyAssetPlanFingerprint(proposalAssetPlan)
    ) {
      throw new ConflictException({
        code: 'STORY_PRODUCTION_ASSET_PLAN_STALE',
        message:
          'The approved Asset Specs changed after this Storyboard proposal was authored. Create a fresh Storyboard proposal.',
      });
    }
    this.validateApprovedStoryboardPlan({
      storyboardPlan,
      assetPlan: currentAssetPlan,
      draft: draftRow.content,
      chapterNodeIds: jsonStringArray(chapter.nodeIds),
    });

    const result = emptyReconcileResult();
    const now = new Date();
    const snapshot = await this.ensurePlanSnapshot(
      tx,
      rawInput,
      storyboardPlan,
    );
    const assetRows = await tx.storyAssetSpec.findMany({
      where: {
        storyProjectId: rawInput.storyProjectId,
        storyChapterId: rawInput.storyChapterId,
        status: StoryProductionSpecStatus.current,
      },
    });
    await this.reconcileStoryboard(
      tx,
      rawInput,
      storyboardPlan,
      snapshot.id,
      new Map(assetRows.map((asset) => [asset.stableKey, asset])),
      now,
      result,
    );
    return result;
  }

  /**
   * Invalidate only true downstream stages. Script and Plot both invalidate
   * Assets and Storyboard; Asset approval independently invalidates Storyboard
   * when its semantic plan changes. Stale rows receive deterministic pending
   * fingerprints required by the database lifecycle checks.
   */
  async invalidateDownstreamAfterUpstreamApprovalInTransaction(
    tx: Prisma.TransactionClient,
    input: InvalidateStoryProductionDownstreamInput,
  ): Promise<void> {
    assertProductionSourceFingerprint(input.sourceFingerprint);
    const now = new Date();
    const storyboardInvalidationFingerprint = planFingerprint(
      input.sourceFingerprint,
      'storyboard-invalidated-by-upstream',
      {
        upstreamStage: input.upstreamStage,
        upstreamRunId: input.upstreamRunId,
      },
    );

    if (input.upstreamStage === 'script' || input.upstreamStage === 'plot') {
      const chapter = await tx.storyChapter.findFirst({
        where: {
          id: input.storyChapterId,
          storyProjectId: input.storyProjectId,
        },
        select: { approvedAssetPlanSnapshotId: true },
      });
      if (!chapter) {
        throw new NotFoundException({
          code: 'STORY_CHAPTER_NOT_FOUND',
          message: 'Story chapter not found.',
        });
      }
      const assetInvalidationFingerprint = planFingerprint(
        input.sourceFingerprint,
        'asset-invalidated-by-upstream',
        {
          upstreamStage: input.upstreamStage,
          upstreamRunId: input.upstreamRunId,
        },
      );
      if (chapter.approvedAssetPlanSnapshotId !== null) {
        // Pin an explicit mismatching marker so a previously-approved empty
        // Asset plan also becomes stale; row counts alone cannot represent it.
        const invalidationSnapshot = await this.ensurePlanSnapshot(
          tx,
          {
            storyProjectId: input.storyProjectId,
            storyChapterId: input.storyChapterId,
            actorUserId: input.actorUserId,
            sourceFingerprint: assetInvalidationFingerprint,
          },
          StoryAssetPlanSchema.parse({ assetSpecs: [] }),
        );
        await this.pinApprovedAssetPlanSnapshotInTransaction(
          tx,
          input.storyProjectId,
          input.storyChapterId,
          invalidationSnapshot.id,
        );
      }
      await tx.storyAssetSpec.updateMany({
        where: {
          storyProjectId: input.storyProjectId,
          storyChapterId: input.storyChapterId,
          status: { not: StoryProductionSpecStatus.archived },
        },
        data: {
          status: StoryProductionSpecStatus.stale,
          pendingSourceFingerprint: assetInvalidationFingerprint,
          pendingPlanSnapshotId: null,
          lastPlannedAt: now,
          version: { increment: 1 },
        },
      });
    }
    await tx.storyStoryboardSequence.updateMany({
      where: {
        storyProjectId: input.storyProjectId,
        storyChapterId: input.storyChapterId,
        status: { not: StoryProductionSpecStatus.archived },
      },
      data: {
        status: StoryProductionSpecStatus.stale,
        pendingSourceFingerprint: storyboardInvalidationFingerprint,
        pendingPlanSnapshotId: null,
        lastPlannedAt: now,
        version: { increment: 1 },
      },
    });
  }

  /** Exact Plot-derived Asset source used to author and fence Storyboards. */
  async readCurrentAssetPlanInTransaction(
    tx: Prisma.TransactionClient,
    storyProjectId: string,
    storyChapterId: string,
  ): Promise<StoryAssetPlan | null> {
    const [
      rows,
      marker,
      scriptHead,
      chapter,
      draft,
      currentScreenplay,
      approvedPlotScreenplay,
    ] = await Promise.all([
      tx.storyAssetSpec.findMany({
        where: {
          storyProjectId,
          storyChapterId,
          status: { not: StoryProductionSpecStatus.archived },
        },
        orderBy: [{ stableKey: 'asc' }, { id: 'asc' }],
      }),
      this.readApprovedAssetPlanMarkerInTransaction(
        tx,
        storyProjectId,
        storyChapterId,
      ),
      readStoryScriptHead(tx, storyProjectId, storyChapterId),
      tx.storyChapter.findFirst({
        where: {
          id: storyChapterId,
          storyProjectId,
          archivedAt: null,
        },
      }),
      tx.storyDraft.findUnique({ where: { storyProjectId } }),
      readCurrentStoryScreenplaySnapshot(tx, storyProjectId, storyChapterId),
      readApprovedStoryScreenplaySnapshot(tx, storyProjectId, storyChapterId),
    ]);
    if (marker === null || !chapter || !draft || !scriptHead.hasContent) {
      return null;
    }
    const parsedDraft = InteractiveStoryDraftContentSchema.parse(draft.content);
    const ownedNodeIds = new Set(jsonStringArray(chapter.nodeIds));
    const lineageMatchesHead =
      chapter.sourceScriptDocumentId === scriptHead.documentId &&
      chapter.sourceScriptSequence === scriptHead.sequence &&
      chapter.sourceScriptHash === scriptHead.hash;
    const plotIsCurrent =
      ownedNodeIds.size > 0 &&
      lineageMatchesHead &&
      currentScreenplay !== null &&
      currentScreenplay.documentId === scriptHead.documentId &&
      currentScreenplay.sequence === scriptHead.sequence &&
      approvedPlotScreenplay !== null &&
      approvedPlotScreenplay.versionId === currentScreenplay.versionId &&
      plotMatchesApprovedScreenplay(
        approvedPlotScreenplay.screenplay,
        parsedDraft,
        chapter.entryNodeId,
        ownedNodeIds,
      );
    const plotSourceFingerprint = chapterPlotFingerprint(
      parsedDraft,
      chapter.entryNodeId,
      ownedNodeIds,
    );
    if (!plotIsCurrent || marker.sourceFingerprint !== plotSourceFingerprint) {
      return null;
    }
    if (rows.some((row) => row.status !== StoryProductionSpecStatus.current)) {
      return null;
    }
    if (rows.length === 0) {
      return marker.plan.assetSpecs.length === 0 ? marker.plan : null;
    }
    const expectedKeys = new Set(
      marker.plan.assetSpecs.map((asset) => asset.stableKey),
    );
    const currentKeys = new Set(rows.map((row) => row.stableKey));
    if (
      [...expectedKeys].some((stableKey) => !currentKeys.has(stableKey)) ||
      rows.some(
        (row) =>
          !expectedKeys.has(row.stableKey) &&
          row.planDisposition !== StoryProductionPlanDisposition.user_override,
      )
    ) {
      return null;
    }
    return StoryAssetPlanSchema.parse({
      assetSpecs: rows.map((row) => ({
        stableKey: row.stableKey,
        kind: row.kind,
        name: row.name,
        // The editable row permits null; retain an explicit, deterministic
        // human-readable source without inventing planner content.
        description: row.description ?? row.name,
        imagePrompt: row.imagePrompt,
        ...(row.videoPrompt ? { videoPrompt: row.videoPrompt } : {}),
        ...(row.negativePrompt ? { negativePrompt: row.negativePrompt } : {}),
        ...(row.sourceCharacterId
          ? { sourceCharacterId: row.sourceCharacterId }
          : {}),
        sourceNodeIds: jsonStringArray(row.sourceNodeIds),
      })),
    });
  }

  /**
   * The chapter-pinned approved Asset-only (or legacy combined) snapshot is
   * the durable stage marker. Unlike row counts it can represent an
   * intentionally empty Asset plan without confusing it with a stage that
   * never ran.
   */
  private async readApprovedAssetPlanMarkerInTransaction(
    tx: Prisma.TransactionClient,
    storyProjectId: string,
    storyChapterId: string,
  ): Promise<{ sourceFingerprint: string; plan: StoryAssetPlan } | null> {
    const chapter = await tx.storyChapter.findFirst({
      where: {
        id: storyChapterId,
        storyProjectId,
        archivedAt: null,
      },
      select: { approvedAssetPlanSnapshotId: true },
    });
    if (!chapter?.approvedAssetPlanSnapshotId) return null;
    const snapshot = await tx.storyProductionPlanSnapshot.findFirst({
      where: {
        id: chapter.approvedAssetPlanSnapshotId,
        storyProjectId,
        storyChapterId,
      },
      select: {
        sourceFingerprint: true,
        planFingerprint: true,
        productionPlan: true,
      },
    });
    if (!snapshot) return null;
    return {
      sourceFingerprint: snapshot.sourceFingerprint,
      plan: assetPlanFromSnapshot(parsePlanSnapshot(snapshot)),
    };
  }

  private async pinApprovedAssetPlanSnapshotInTransaction(
    tx: Prisma.TransactionClient,
    storyProjectId: string,
    storyChapterId: string,
    snapshotId: string,
  ): Promise<void> {
    const pinned = await tx.storyChapter.updateMany({
      where: { id: storyChapterId, storyProjectId },
      data: { approvedAssetPlanSnapshotId: snapshotId },
    });
    if (pinned.count !== 1) {
      throw productionCasConflict('Approved Asset plan marker');
    }
  }

  private async ensurePlanSnapshot(
    tx: Prisma.TransactionClient,
    input: StoryProductionApplyContext,
    productionPlan: StoryProductionSnapshotPlan,
  ) {
    const planFingerprint = canonicalJsonHash({
      sourceFingerprint: input.sourceFingerprint,
      productionPlan,
    });
    const snapshot = await tx.storyProductionPlanSnapshot.upsert({
      where: {
        storyChapterId_planFingerprint: {
          storyChapterId: input.storyChapterId,
          planFingerprint,
        },
      },
      update: {},
      create: {
        storyProjectId: input.storyProjectId,
        storyChapterId: input.storyChapterId,
        sourceFingerprint: input.sourceFingerprint,
        planFingerprint,
        productionPlan: productionPlan as Prisma.InputJsonValue,
        createdByUserId: input.actorUserId,
      },
    });
    const parsed = parseProductionSnapshotPayload(snapshot.productionPlan);
    if (
      snapshot.storyProjectId !== input.storyProjectId ||
      snapshot.sourceFingerprint !== input.sourceFingerprint ||
      canonicalJsonHash({
        sourceFingerprint: snapshot.sourceFingerprint,
        productionPlan: parsed,
      }) !== snapshot.planFingerprint
    ) {
      throw productionSnapshotCorrupt();
    }
    return snapshot;
  }

  /** Pure preflight used before Script/Plot writes begin. */
  validateApprovedProductionPlan(
    rawInput: ValidateApprovedProductionPlanInput,
  ): StoryProductionPlan {
    const productionPlan = StoryProductionPlanSchema.parse(
      rawInput.productionPlan,
    );
    const assetPlan = this.validateApprovedAssetPlan({
      assetPlan: { assetSpecs: productionPlan.assetSpecs },
      canonicalNodeIds: rawInput.chapterNodeIds,
      canonicalCharacterIds: rawInput.canonicalCharacterIds,
    });
    this.validateApprovedStoryboardPlan({
      storyboardPlan: {
        storyboardSequences: productionPlan.storyboardSequences,
      },
      assetPlan,
      draft: rawInput.draft,
      chapterNodeIds: rawInput.chapterNodeIds,
    });
    return productionPlan;
  }

  validateApprovedAssetPlan(
    rawInput: ValidateApprovedAssetPlanInput,
  ): StoryAssetPlan {
    const assetPlan = StoryAssetPlanSchema.parse(rawInput.assetPlan);
    const canonicalNodeIds = new Set(rawInput.canonicalNodeIds);
    const screenplayCharacters = new Set(rawInput.canonicalCharacterIds);
    for (const asset of assetPlan.assetSpecs) {
      for (const nodeId of asset.sourceNodeIds) {
        if (!canonicalNodeIds.has(nodeId))
          throw productionCrossChapter('Asset Spec source', nodeId);
      }
      const sourceCharacterId = asset.sourceCharacterId;
      if (
        asset.kind === 'character' &&
        (!sourceCharacterId || !screenplayCharacters.has(sourceCharacterId))
      ) {
        throw new BadRequestException({
          code: 'STORY_PRODUCTION_CHARACTER_INVALID',
          message: `Character Asset Spec ${asset.stableKey} does not reference a canonical character in the approved Script.`,
        });
      }
    }
    return assetPlan;
  }

  validateApprovedStoryboardPlan(
    rawInput: ValidateApprovedStoryboardPlanInput,
  ): StoryStoryboardPlan {
    const storyboardPlan = StoryStoryboardPlanSchema.parse(
      rawInput.storyboardPlan,
    );
    const assetPlan = StoryAssetPlanSchema.parse(rawInput.assetPlan);
    const draft = InteractiveStoryDraftContentSchema.parse(rawInput.draft);
    const ownedNodeIds = new Set(rawInput.chapterNodeIds);
    const clipNodeById = new Map(
      draft.graph.nodes
        .filter((node) => node.kind === 'clip' && ownedNodeIds.has(node.nodeId))
        .map((node) => [node.nodeId, node]),
    );
    const assetByKey = new Map(
      assetPlan.assetSpecs.map((asset) => [asset.stableKey, asset]),
    );
    for (const sequence of storyboardPlan.storyboardSequences) {
      const node = clipNodeById.get(sequence.plotNodeId);
      if (!node)
        throw productionCrossChapter(
          'Storyboard Plot node',
          sequence.plotNodeId,
        );
      const validDecisionIds =
        node.exit.kind === 'choice'
          ? new Set([node.exit.decisionId])
          : new Set<string>();
      for (const cue of sequence.cues) {
        if (!validDecisionIds.has(cue.decisionId)) {
          throw new BadRequestException({
            code: 'STORY_PRODUCTION_DECISION_INVALID',
            message: `Storyboard cue ${cue.stableKey} references a decision not owned by Plot node ${sequence.plotNodeId}.`,
          });
        }
      }
      for (const clip of sequence.clips) {
        for (const mention of storyClipAssetMentions(clip)) {
          const asset = assetByKey.get(mention);
          if (!asset) {
            throw new BadRequestException({
              code: 'STORY_PRODUCTION_ASSET_REFERENCE_INVALID',
              message: `Storyboard clip ${clip.stableKey} references missing approved Asset Spec @${mention}.`,
            });
          }
          if (!asset.sourceNodeIds.includes(sequence.plotNodeId)) {
            throw new BadRequestException({
              code: 'STORY_PRODUCTION_ASSET_LINEAGE_INVALID',
              message: `Storyboard clip ${clip.stableKey} cannot bind Asset Spec @${mention} outside its Plot node lineage ${sequence.plotNodeId}.`,
            });
          }
        }
      }
    }
    const plannedNodeIds = new Set(
      storyboardPlan.storyboardSequences.map((sequence) => sequence.plotNodeId),
    );
    const missingSequenceNodeIds = [...clipNodeById.keys()].filter(
      (nodeId) => !plannedNodeIds.has(nodeId),
    );
    if (missingSequenceNodeIds.length > 0) {
      throw new BadRequestException({
        code: 'STORY_PRODUCTION_STORYBOARD_INCOMPLETE',
        message: `Every chapter Plot node requires exactly one Storyboard sequence. Missing: ${missingSequenceNodeIds.join(', ')}.`,
      });
    }
    return storyboardPlan;
  }

  private async invalidateStoryboardForAssetPlan(
    tx: Prisma.TransactionClient,
    input: StoryProductionApplyContext,
    assetPlanFingerprint: string,
    now: Date,
  ): Promise<number> {
    const invalidationFingerprint = planFingerprint(
      input.sourceFingerprint,
      'storyboard-invalidated-by-assets',
      { assetPlanFingerprint },
    );
    const invalidated = await tx.storyStoryboardSequence.updateMany({
      where: {
        storyProjectId: input.storyProjectId,
        storyChapterId: input.storyChapterId,
        status: { not: StoryProductionSpecStatus.archived },
      },
      data: {
        status: StoryProductionSpecStatus.stale,
        pendingSourceFingerprint: invalidationFingerprint,
        // An Asset change invalidates any older pending Storyboard candidate;
        // a fresh explicit Storyboard proposal must be authored and approved.
        pendingPlanSnapshotId: null,
        lastPlannedAt: now,
        version: { increment: 1 },
      },
    });
    return invalidated.count;
  }

  private async reconcileAssetSpecs(
    tx: Prisma.TransactionClient,
    input: StoryProductionApplyContext,
    plan: StoryAssetPlan,
    planSnapshotId: string,
    now: Date,
    result: StoryProductionReconcileResult,
  ): Promise<Map<string, StoryAssetSpec>> {
    const existing = await tx.storyAssetSpec.findMany({
      where: {
        storyProjectId: input.storyProjectId,
        storyChapterId: input.storyChapterId,
      },
    });
    const existingByKey = new Map(existing.map((row) => [row.stableKey, row]));
    const plannedKeys = new Set(
      plan.assetSpecs.map((asset) => asset.stableKey),
    );
    for (const item of plan.assetSpecs) {
      const fingerprint = planFingerprint(
        input.sourceFingerprint,
        'asset',
        item,
      );
      const current = existingByKey.get(item.stableKey);
      if (!current) {
        const created = await tx.storyAssetSpec.create({
          data: {
            storyProjectId: input.storyProjectId,
            storyChapterId: input.storyChapterId,
            stableKey: item.stableKey,
            kind: item.kind,
            sourceCharacterId: item.sourceCharacterId ?? null,
            sourceNodeIds: item.sourceNodeIds,
            name: item.name,
            description: item.description,
            imagePrompt: item.imagePrompt,
            videoPrompt: item.videoPrompt ?? null,
            negativePrompt: item.negativePrompt ?? null,
            sourceFingerprint: fingerprint,
            createdByUserId: input.actorUserId,
            lastPlannedAt: now,
          },
        });
        existingByKey.set(item.stableKey, created);
        result.assetSpecsCreated += 1;
        continue;
      }
      if (
        current.sourceFingerprint === fingerprint &&
        current.status === StoryProductionSpecStatus.current
      ) {
        await tx.storyAssetSpec.update({
          where: { id: current.id },
          data: { lastPlannedAt: now },
        });
        continue;
      }
      if (current.userModifiedAt) {
        if (
          current.status === StoryProductionSpecStatus.stale &&
          current.pendingSourceFingerprint === fingerprint &&
          current.pendingPlanSnapshotId === planSnapshotId
        ) {
          await tx.storyAssetSpec.update({
            where: { id: current.id },
            data: { lastPlannedAt: now },
          });
          continue;
        }
        const stale = await tx.storyAssetSpec.update({
          where: { id: current.id },
          data: {
            status: StoryProductionSpecStatus.stale,
            pendingSourceFingerprint: fingerprint,
            pendingPlanSnapshotId: planSnapshotId,
            lastPlannedAt: now,
            version: { increment: 1 },
          },
        });
        existingByKey.set(item.stableKey, stale);
        result.assetSpecsMarkedStale += 1;
        continue;
      }
      const updated = await tx.storyAssetSpec.update({
        where: { id: current.id },
        data: {
          kind: item.kind,
          sourceCharacterId: item.sourceCharacterId ?? null,
          sourceNodeIds: item.sourceNodeIds,
          name: item.name,
          description: item.description,
          imagePrompt: item.imagePrompt,
          videoPrompt: item.videoPrompt ?? null,
          negativePrompt: item.negativePrompt ?? null,
          sourceFingerprint: fingerprint,
          pendingSourceFingerprint: null,
          pendingPlanSnapshotId: null,
          planDisposition: StoryProductionPlanDisposition.planned,
          status: StoryProductionSpecStatus.current,
          lastPlannedAt: now,
          version: { increment: 1 },
        },
      });
      existingByKey.set(item.stableKey, updated);
      result.assetSpecsUpdated += 1;
    }
    for (const current of existing) {
      if (
        plannedKeys.has(current.stableKey) ||
        current.status === StoryProductionSpecStatus.archived
      )
        continue;
      const removalFingerprint = planFingerprint(
        input.sourceFingerprint,
        'asset-removed',
        {
          stableKey: current.stableKey,
        },
      );
      if (
        current.userModifiedAt &&
        current.status === StoryProductionSpecStatus.stale &&
        current.pendingSourceFingerprint === removalFingerprint &&
        current.pendingPlanSnapshotId === planSnapshotId
      ) {
        await tx.storyAssetSpec.update({
          where: { id: current.id },
          data: { lastPlannedAt: now },
        });
        continue;
      }
      const updated = await tx.storyAssetSpec.update({
        where: { id: current.id },
        data: current.userModifiedAt
          ? {
              status: StoryProductionSpecStatus.stale,
              pendingSourceFingerprint: removalFingerprint,
              pendingPlanSnapshotId: planSnapshotId,
              lastPlannedAt: now,
              version: { increment: 1 },
            }
          : {
              status: StoryProductionSpecStatus.archived,
              pendingSourceFingerprint: null,
              pendingPlanSnapshotId: null,
              planDisposition: StoryProductionPlanDisposition.planned,
              lastPlannedAt: now,
              version: { increment: 1 },
            },
      });
      existingByKey.set(current.stableKey, updated);
      if (current.userModifiedAt) result.assetSpecsMarkedStale += 1;
      else result.assetSpecsUpdated += 1;
    }
    return existingByKey;
  }

  private async reconcileStoryboard(
    tx: Prisma.TransactionClient,
    input: StoryProductionApplyContext,
    plan: StoryStoryboardPlan,
    planSnapshotId: string,
    assetByKey: Map<string, StoryAssetSpec>,
    now: Date,
    result: StoryProductionReconcileResult,
  ): Promise<void> {
    const existing = await tx.storyStoryboardSequence.findMany({
      where: {
        storyProjectId: input.storyProjectId,
        storyChapterId: input.storyChapterId,
      },
      include: { clips: { include: { assetBindings: true } }, cues: true },
    });
    const existingByNode = new Map(
      existing.map((row) => [row.plotNodeId, row]),
    );
    const plannedNodeIds = new Set(
      plan.storyboardSequences.map((row) => row.plotNodeId),
    );
    for (const item of plan.storyboardSequences) {
      const fingerprint = planFingerprint(
        input.sourceFingerprint,
        'sequence',
        item,
      );
      const current = existingByNode.get(item.plotNodeId);
      // Archived children are dead history: their userModifiedAt stamps must
      // not keep re-conflicting a sequence the creator already reconciled.
      const subtreeWasModified =
        current?.userModifiedAt !== null &&
        current?.userModifiedAt !== undefined
          ? true
          : Boolean(
              current?.clips.some(
                (clip) =>
                  clip.status !== StoryProductionSpecStatus.archived &&
                  (clip.userModifiedAt ||
                    clip.assetBindings.some(
                      (binding) =>
                        binding.status !== StoryProductionSpecStatus.archived &&
                        binding.userModifiedAt,
                    )),
              ) ||
              current?.cues.some(
                (cue) =>
                  cue.status !== StoryProductionSpecStatus.archived &&
                  cue.userModifiedAt,
              ),
            );
      if (
        current &&
        current.sourceFingerprint !== fingerprint &&
        subtreeWasModified
      ) {
        if (
          current.status === StoryProductionSpecStatus.stale &&
          current.pendingSourceFingerprint === fingerprint &&
          current.pendingPlanSnapshotId === planSnapshotId
        ) {
          await tx.storyStoryboardSequence.update({
            where: { id: current.id },
            data: { lastPlannedAt: now },
          });
          continue;
        }
        await tx.storyStoryboardSequence.update({
          where: { id: current.id },
          data: {
            status: StoryProductionSpecStatus.stale,
            pendingSourceFingerprint: fingerprint,
            pendingPlanSnapshotId: planSnapshotId,
            lastPlannedAt: now,
            version: { increment: 1 },
          },
        });
        result.sequencesMarkedStale += 1;
        continue;
      }
      let sequence: StoryStoryboardSequence;
      if (!current) {
        sequence = await tx.storyStoryboardSequence.create({
          data: {
            storyProjectId: input.storyProjectId,
            storyChapterId: input.storyChapterId,
            plotNodeId: item.plotNodeId,
            stableKey: item.plotNodeId,
            title: null,
            description: item.description,
            suggestedDurationMs: item.durationMs,
            durationMs: item.durationMs,
            sourceFingerprint: fingerprint,
            createdByUserId: input.actorUserId,
            lastPlannedAt: now,
          },
        });
        result.sequencesCreated += 1;
      } else if (
        current.sourceFingerprint === fingerprint &&
        current.status === StoryProductionSpecStatus.current
      ) {
        await tx.storyStoryboardSequence.update({
          where: { id: current.id },
          data: { lastPlannedAt: now },
        });
        continue;
      } else {
        sequence = await tx.storyStoryboardSequence.update({
          where: { id: current.id },
          data: {
            stableKey: item.plotNodeId,
            description: item.description,
            suggestedDurationMs: item.durationMs,
            durationMs: item.durationMs,
            sourceFingerprint: fingerprint,
            pendingSourceFingerprint: null,
            pendingPlanSnapshotId: null,
            planDisposition: StoryProductionPlanDisposition.planned,
            status: StoryProductionSpecStatus.current,
            lastPlannedAt: now,
            version: { increment: 1 },
          },
        });
        result.sequencesUpdated += 1;
      }
      await this.reconcileSequenceChildren(
        tx,
        input,
        item,
        sequence,
        assetByKey,
        now,
      );
    }
    for (const current of existing) {
      if (
        plannedNodeIds.has(current.plotNodeId) ||
        current.status === StoryProductionSpecStatus.archived
      )
        continue;
      const subtreeWasModified =
        Boolean(current.userModifiedAt) ||
        current.clips.some(
          (clip) =>
            clip.status !== StoryProductionSpecStatus.archived &&
            (clip.userModifiedAt ||
              clip.assetBindings.some(
                (binding) =>
                  binding.status !== StoryProductionSpecStatus.archived &&
                  binding.userModifiedAt,
              )),
        ) ||
        current.cues.some(
          (cue) =>
            cue.status !== StoryProductionSpecStatus.archived &&
            cue.userModifiedAt,
        );
      if (subtreeWasModified) {
        const removalFingerprint = planFingerprint(
          input.sourceFingerprint,
          'sequence-removed',
          { plotNodeId: current.plotNodeId },
        );
        if (
          current.status === StoryProductionSpecStatus.stale &&
          current.pendingSourceFingerprint === removalFingerprint &&
          current.pendingPlanSnapshotId === planSnapshotId
        ) {
          await tx.storyStoryboardSequence.update({
            where: { id: current.id },
            data: { lastPlannedAt: now },
          });
          continue;
        }
        await tx.storyStoryboardSequence.update({
          where: { id: current.id },
          data: {
            status: StoryProductionSpecStatus.stale,
            pendingSourceFingerprint: removalFingerprint,
            pendingPlanSnapshotId: planSnapshotId,
            lastPlannedAt: now,
            version: { increment: 1 },
          },
        });
        result.sequencesMarkedStale += 1;
      } else {
        await Promise.all([
          tx.storyStoryboardClipAssetBinding.updateMany({
            where: { storyboardClip: { sequenceId: current.id } },
            data: {
              status: StoryProductionSpecStatus.archived,
              pendingSourceFingerprint: null,
            },
          }),
          tx.storyStoryboardCue.updateMany({
            where: { sequenceId: current.id },
            data: {
              status: StoryProductionSpecStatus.archived,
              pendingSourceFingerprint: null,
            },
          }),
          tx.storyStoryboardClip.updateMany({
            where: { sequenceId: current.id },
            data: {
              status: StoryProductionSpecStatus.archived,
              pendingSourceFingerprint: null,
            },
          }),
        ]);
        await tx.storyStoryboardSequence.update({
          where: { id: current.id },
          data: {
            status: StoryProductionSpecStatus.archived,
            pendingSourceFingerprint: null,
            pendingPlanSnapshotId: null,
            planDisposition: StoryProductionPlanDisposition.planned,
            lastPlannedAt: now,
            version: { increment: 1 },
          },
        });
        result.sequencesUpdated += 1;
      }
    }
  }

  private async reconcileSequenceChildren(
    tx: Prisma.TransactionClient,
    input: StoryProductionApplyContext,
    item: StoryStoryboardPlan['storyboardSequences'][number],
    sequence: StoryStoryboardSequence,
    assetByKey: Map<string, StoryAssetSpec>,
    now: Date,
    options: {
      clearUserModifications?: boolean;
      preserveCompatibleBindings?: boolean;
    } = {},
  ): Promise<void> {
    const existingClips = await tx.storyStoryboardClip.findMany({
      where: { sequenceId: sequence.id },
      include: { assetBindings: true },
    });
    const byKey = new Map(existingClips.map((row) => [row.stableKey, row]));
    const plannedClipKeys = new Set(item.clips.map((clip) => clip.stableKey));
    // Move old ranks out of the way before a planned reorder; all surviving
    // clips receive their canonical rank below in this same transaction.
    await tx.storyStoryboardClip.updateMany({
      where: { sequenceId: sequence.id },
      data: { rank: { increment: 1_000_000 } },
    });
    for (const [rank, clipPlan] of item.clips.entries()) {
      const fingerprint = planFingerprint(
        input.sourceFingerprint,
        'clip',
        clipPlan,
      );
      const current = byKey.get(clipPlan.stableKey);
      const clipData = {
        title: clipPlan.title,
        rank,
        kind: clipPlan.kind,
        track: 'visual',
        startMs: clipPlan.startMs,
        durationMs: clipPlan.durationMs,
        description: clipPlan.description,
        imagePrompt: clipPlan.kind === 'image' ? clipPlan.imagePrompt : null,
        videoPrompt: clipPlan.kind === 'video' ? clipPlan.videoPrompt : null,
        negativePrompt: clipPlan.negativePrompt ?? null,
        sourceFingerprint: fingerprint,
        pendingSourceFingerprint: null,
        status: StoryProductionSpecStatus.current,
        lastPlannedAt: now,
        ...(options.clearUserModifications
          ? { userModifiedAt: null, userModifiedByUserId: null }
          : {}),
      } as const;
      let clip: StoryStoryboardClip;
      if (!current) {
        clip = await tx.storyStoryboardClip.create({
          data: {
            storyProjectId: input.storyProjectId,
            storyChapterId: input.storyChapterId,
            sequenceId: sequence.id,
            stableKey: clipPlan.stableKey,
            ...clipData,
            createdByUserId: input.actorUserId,
          },
        });
      } else {
        clip = await tx.storyStoryboardClip.update({
          where: { id: current.id },
          data: {
            ...clipData,
            ...(current.kind === clipPlan.kind
              ? {}
              : { selectedMediaVersionId: null }),
            ...(current.sourceFingerprint === fingerprint &&
            !(options.clearUserModifications && current.userModifiedAt)
              ? {}
              : { version: { increment: 1 } }),
          },
        });
      }
      await this.reconcileBindings(
        tx,
        input,
        clipPlan,
        clip,
        assetByKey,
        now,
        options,
      );
    }
    for (const current of existingClips) {
      if (plannedClipKeys.has(current.stableKey)) continue;
      await tx.storyStoryboardClipAssetBinding.updateMany({
        where: { storyboardClipId: current.id },
        data: {
          status: StoryProductionSpecStatus.archived,
          pendingSourceFingerprint: null,
          ...(options.clearUserModifications
            ? { userModifiedAt: null, userModifiedByUserId: null }
            : {}),
        },
      });
      await tx.storyStoryboardClip.update({
        where: { id: current.id },
        data: {
          status: StoryProductionSpecStatus.archived,
          pendingSourceFingerprint: null,
          version: { increment: 1 },
        },
      });
    }
    await this.reconcileCues(tx, input, item, sequence, now, options);
  }

  private async archiveSequenceChildren(
    tx: Prisma.TransactionClient,
    sequenceId: string,
  ): Promise<void> {
    await Promise.all([
      tx.storyStoryboardClipAssetBinding.updateMany({
        where: { storyboardClip: { sequenceId } },
        data: {
          status: StoryProductionSpecStatus.archived,
          pendingSourceFingerprint: null,
        },
      }),
      tx.storyStoryboardCue.updateMany({
        where: { sequenceId },
        data: {
          status: StoryProductionSpecStatus.archived,
          pendingSourceFingerprint: null,
        },
      }),
      tx.storyStoryboardClip.updateMany({
        where: { sequenceId },
        data: {
          status: StoryProductionSpecStatus.archived,
          pendingSourceFingerprint: null,
        },
      }),
    ]);
  }

  private async reconcileBindings(
    tx: Prisma.TransactionClient,
    input: StoryProductionApplyContext,
    clipPlan: StoryStoryboardPlan['storyboardSequences'][number]['clips'][number],
    clip: StoryStoryboardClip,
    assetByKey: Map<string, StoryAssetSpec>,
    now: Date,
    options: {
      clearUserModifications?: boolean;
      preserveCompatibleBindings?: boolean;
    } = {},
  ): Promise<void> {
    const existing = await tx.storyStoryboardClipAssetBinding.findMany({
      where: { storyboardClipId: clip.id },
    });
    const plannedSpecIds = new Set<string>();
    // The prompt text is the authoritative reference carrier: binding rows are
    // a derived index over the @stableKey mentions, ranked by first appearance.
    for (const [rank, assetKey] of storyClipAssetMentions(clipPlan).entries()) {
      const assetSpec = assetByKey.get(assetKey);
      if (
        !assetSpec ||
        assetSpec.status === StoryProductionSpecStatus.archived
      ) {
        throw new InternalServerErrorException({
          code: 'STORY_PRODUCTION_ASSET_RECONCILE_MISSING',
          message: `Storyboard references missing Asset Spec ${assetKey}.`,
        });
      }
      plannedSpecIds.add(assetSpec.id);
      const fingerprint = planFingerprint(input.sourceFingerprint, 'binding', {
        clip: clipPlan.stableKey,
        assetKey,
        rank,
      });
      const current = existing.find(
        (row) => row.assetSpecId === assetSpec.id && row.role === 'reference',
      );
      if (!current) {
        await tx.storyStoryboardClipAssetBinding.create({
          data: {
            storyProjectId: input.storyProjectId,
            storyChapterId: input.storyChapterId,
            storyboardClipId: clip.id,
            assetSpecId: assetSpec.id,
            role: 'reference',
            mode: StoryStoryboardBindingMode.follow_selected,
            // Mentions resolve best-effort: without media the mention still
            // contributes the asset's identity textually and never blocks
            // generation, mirroring the platform prompt composer.
            required: false,
            rank,
            sourceFingerprint: fingerprint,
            createdByUserId: input.actorUserId,
            lastPlannedAt: now,
          },
        });
      } else {
        await tx.storyStoryboardClipAssetBinding.update({
          where: { id: current.id },
          data: {
            // Planner resets restore the create-path defaults: mentions are
            // best-effort references and never block generation.
            mode: options.preserveCompatibleBindings
              ? current.mode
              : StoryStoryboardBindingMode.follow_selected,
            pinnedMediaVersionId: options.preserveCompatibleBindings
              ? current.pinnedMediaVersionId
              : null,
            required: options.preserveCompatibleBindings
              ? current.required
              : false,
            rank,
            sourceFingerprint: fingerprint,
            pendingSourceFingerprint: null,
            status: StoryProductionSpecStatus.current,
            lastPlannedAt: now,
            ...(options.clearUserModifications &&
            !options.preserveCompatibleBindings
              ? { userModifiedAt: null, userModifiedByUserId: null }
              : {}),
            ...(current.sourceFingerprint === fingerprint &&
            !(options.clearUserModifications && current.userModifiedAt)
              ? {}
              : { version: { increment: 1 } }),
          },
        });
      }
    }
    await tx.storyStoryboardClipAssetBinding.updateMany({
      where: {
        storyboardClipId: clip.id,
        role: 'reference',
        assetSpecId: { notIn: [...plannedSpecIds] },
      },
      data: {
        status: StoryProductionSpecStatus.archived,
        pendingSourceFingerprint: null,
      },
    });
  }

  private async reconcileCues(
    tx: Prisma.TransactionClient,
    input: StoryProductionApplyContext,
    item: StoryStoryboardPlan['storyboardSequences'][number],
    sequence: StoryStoryboardSequence,
    now: Date,
    options: { clearUserModifications?: boolean } = {},
  ): Promise<void> {
    const existing = await tx.storyStoryboardCue.findMany({
      where: { sequenceId: sequence.id },
    });
    const byKey = new Map(existing.map((row) => [row.stableKey, row]));
    const plannedKeys = new Set(item.cues.map((cue) => cue.stableKey));
    for (const cue of item.cues) {
      const fingerprint = planFingerprint(input.sourceFingerprint, 'cue', cue);
      const current = byKey.get(cue.stableKey);
      if (!current) {
        await tx.storyStoryboardCue.create({
          data: {
            storyProjectId: input.storyProjectId,
            storyChapterId: input.storyChapterId,
            sequenceId: sequence.id,
            stableKey: cue.stableKey,
            kind: cue.kind,
            plotDecisionId: cue.decisionId,
            atMs: cue.atMs,
            sourceFingerprint: fingerprint,
            createdByUserId: input.actorUserId,
            lastPlannedAt: now,
          },
        });
      } else {
        await tx.storyStoryboardCue.update({
          where: { id: current.id },
          data: {
            kind: cue.kind,
            plotDecisionId: cue.decisionId,
            atMs: cue.atMs,
            sourceFingerprint: fingerprint,
            pendingSourceFingerprint: null,
            status: StoryProductionSpecStatus.current,
            lastPlannedAt: now,
            ...(options.clearUserModifications
              ? { userModifiedAt: null, userModifiedByUserId: null }
              : {}),
            ...(current.sourceFingerprint === fingerprint &&
            !(options.clearUserModifications && current.userModifiedAt)
              ? {}
              : { version: { increment: 1 } }),
          },
        });
      }
    }
    await tx.storyStoryboardCue.updateMany({
      where: {
        sequenceId: sequence.id,
        stableKey: { notIn: [...plannedKeys] },
      },
      data: {
        status: StoryProductionSpecStatus.archived,
        pendingSourceFingerprint: null,
      },
    });
  }

  private async mutateWithReceipt<T>(input: {
    user: AuthUser;
    projectId: string;
    chapterId: string;
    idempotencyKey: string;
    operation: string;
    request: unknown;
    mutate: (tx: Prisma.TransactionClient, now: Date) => Promise<T>;
  }): Promise<T> {
    await this.requireScope(
      input.user,
      input.projectId,
      input.chapterId,
      'story.edit',
    );
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
    const requestFingerprint = canonicalJsonHash({
      operation: input.operation,
      projectId: input.projectId,
      chapterId: input.chapterId,
      request: input.request,
    });
    return this.prisma.$transaction(async (tx) => {
      await this.writeGuard.assertHumanWriteAllowed(tx, input.projectId);
      await this.permissions.requireProjectInTransaction(
        tx,
        input.user.userId,
        input.projectId,
        'story.edit',
      );
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtext(${`story-production:${input.chapterId}:${input.user.userId}:${idempotencyKey}`})::bigint
        )
      `;
      const replay = await tx.storyProductionMutationReceipt.findUnique({
        where: {
          storyChapterId_actorUserId_idempotencyKey: {
            storyChapterId: input.chapterId,
            actorUserId: input.user.userId,
            idempotencyKey,
          },
        },
      });
      if (replay) {
        if (
          replay.storyProjectId !== input.projectId ||
          replay.operation !== input.operation ||
          replay.requestFingerprint !== requestFingerprint
        ) {
          throw new ConflictException({
            code: 'STORY_PRODUCTION_IDEMPOTENCY_CONFLICT',
            message:
              'This idempotency key was already used for another production edit.',
          });
        }
        return replay.response as T;
      }
      const chapter = await tx.storyChapter.findFirst({
        where: { id: input.chapterId, storyProjectId: input.projectId },
        select: { id: true },
      });
      if (!chapter) throw productionNotFound('Story chapter', input.chapterId);
      const nowRows = await tx.$queryRaw<Array<{ now: Date }>>`
        SELECT transaction_timestamp() AS "now"
      `;
      const value = await input.mutate(tx, nowRows[0]?.now ?? new Date());
      await tx.storyProductionMutationReceipt.create({
        data: {
          storyProjectId: input.projectId,
          storyChapterId: input.chapterId,
          actorUserId: input.user.userId,
          idempotencyKey,
          operation: input.operation,
          requestFingerprint,
          response: value as Prisma.InputJsonValue,
        },
      });
      return value;
    });
  }

  private async requireScope(
    user: AuthUser,
    projectId: string,
    chapterId: string,
    capability: 'story.read' | 'story.edit',
  ): Promise<void> {
    await this.permissions.requireProject(user.userId, projectId, capability);
    const chapter = await this.prisma.storyChapter.findFirst({
      where: { id: chapterId, storyProjectId: projectId, archivedAt: null },
      select: { id: true },
    });
    if (!chapter) throw productionNotFound('Story chapter', chapterId);
  }
}

function planFingerprint(source: string, kind: string, value: unknown): string {
  return canonicalJsonHash({ source, kind, value });
}

/** Stable semantic identity for the Asset source embedded by Storyboard. */
export function storyAssetPlanFingerprint(value: unknown): string {
  const plan = StoryAssetPlanSchema.parse(value);
  return canonicalJsonHash({
    assetSpecs: [...plan.assetSpecs]
      .map((asset) => ({
        ...asset,
        sourceNodeIds: [...asset.sourceNodeIds].sort(),
      }))
      .sort((left, right) => left.stableKey.localeCompare(right.stableKey)),
  });
}

function emptyReconcileResult(): StoryProductionReconcileResult {
  return {
    assetSpecsCreated: 0,
    assetSpecsUpdated: 0,
    assetSpecsMarkedStale: 0,
    sequencesCreated: 0,
    sequencesUpdated: 0,
    sequencesMarkedStale: 0,
  };
}

function assertProductionSourceFingerprint(value: string): void {
  if (/^[0-9a-f]{64}$/.test(value)) return;
  throw new BadRequestException({
    code: 'STORY_PRODUCTION_SOURCE_INVALID',
    message:
      'The production plan source fingerprint must be a lowercase SHA-256 hash.',
  });
}

type PendingPlanSnapshotValue = {
  sourceFingerprint: string;
  planFingerprint: string;
  productionPlan: Prisma.JsonValue;
};

type StoryProductionSnapshotPlan =
  | StoryProductionPlan
  | StoryAssetPlan
  | StoryStoryboardPlan;

type PendingConflictTarget = {
  id: string;
  version: number;
  status: StoryProductionSpecStatus;
  pendingSourceFingerprint: string | null;
  pendingPlanSnapshotId: string | null;
  pendingPlanSnapshot: PendingPlanSnapshotValue | null;
};

function parsePlanSnapshot(
  snapshot: PendingPlanSnapshotValue,
): StoryProductionSnapshotPlan {
  const parsed = parseProductionSnapshotPayload(snapshot.productionPlan);
  if (
    canonicalJsonHash({
      sourceFingerprint: snapshot.sourceFingerprint,
      productionPlan: parsed,
    }) !== snapshot.planFingerprint
  ) {
    throw productionSnapshotCorrupt();
  }
  return parsed;
}

function parseProductionSnapshotPayload(
  value: Prisma.JsonValue,
): StoryProductionSnapshotPlan {
  const combined = StoryProductionPlanSchema.safeParse(value);
  if (combined.success) return combined.data;
  const assets = StoryAssetPlanSchema.safeParse(value);
  if (assets.success) return assets.data;
  const storyboard = StoryStoryboardPlanSchema.safeParse(value);
  if (storyboard.success) return storyboard.data;
  throw productionSnapshotCorrupt();
}

function assetPlanFromSnapshot(
  plan: StoryProductionSnapshotPlan,
): StoryAssetPlan {
  if (!('assetSpecs' in plan)) throw productionSnapshotCorrupt();
  return StoryAssetPlanSchema.parse({ assetSpecs: plan.assetSpecs });
}

function storyboardPlanFromSnapshot(
  plan: StoryProductionSnapshotPlan,
): StoryStoryboardPlan {
  if (!('storyboardSequences' in plan)) throw productionSnapshotCorrupt();
  return StoryStoryboardPlanSchema.parse({
    storyboardSequences: plan.storyboardSequences,
  });
}

function readPendingConflict(
  row: PendingConflictTarget,
  input: ResolveStoryProductionConflictInput,
  resource: string,
): {
  plan: StoryProductionSnapshotPlan;
  sourceFingerprint: string;
} {
  if (row.version !== input.expectedVersion) {
    throw productionCasConflict(resource);
  }
  if (
    row.status !== StoryProductionSpecStatus.stale ||
    !row.pendingSourceFingerprint
  ) {
    throw new ConflictException({
      code: 'STORY_PRODUCTION_CONFLICT_NOT_PENDING',
      message: `${resource} has no pending planner conflict to resolve.`,
    });
  }
  if (row.pendingSourceFingerprint !== input.expectedPendingSourceFingerprint) {
    throw new ConflictException({
      code: 'STORY_PRODUCTION_PENDING_CHANGED',
      message: `${resource} received a newer pending plan. Reload and choose again.`,
    });
  }
  if (!row.pendingPlanSnapshotId || !row.pendingPlanSnapshot) {
    throw new ConflictException({
      code: 'STORY_PRODUCTION_PENDING_SNAPSHOT_MISSING',
      message:
        'This legacy conflict predates durable plan snapshots. Re-run Story planning once, then resolve the refreshed conflict.',
    });
  }
  return {
    plan: parsePlanSnapshot(row.pendingPlanSnapshot),
    sourceFingerprint: row.pendingPlanSnapshot.sourceFingerprint,
  };
}

function assertPendingFingerprint(
  row: { pendingSourceFingerprint: string | null },
  expected: string,
): void {
  if (row.pendingSourceFingerprint !== expected) {
    throw productionSnapshotCorrupt();
  }
}

function pendingConflictCasWhere(
  row: PendingConflictTarget,
  input: ResolveStoryProductionConflictInput,
) {
  return {
    id: row.id,
    version: input.expectedVersion,
    status: StoryProductionSpecStatus.stale,
    pendingSourceFingerprint: input.expectedPendingSourceFingerprint,
    pendingPlanSnapshotId: row.pendingPlanSnapshotId,
  };
}

function productionSnapshotCorrupt(): InternalServerErrorException {
  return new InternalServerErrorException({
    code: 'STORY_PRODUCTION_PLAN_SNAPSHOT_CORRUPT',
    message: 'The pending production plan snapshot failed its integrity check.',
  });
}

function normalizeIdempotencyKey(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 160) {
    throw new BadRequestException({
      code: 'INVALID_IDEMPOTENCY_KEY',
      message: 'Idempotency-Key must contain between 1 and 160 characters.',
    });
  }
  return normalized;
}

function defined<T extends object, K extends keyof T>(
  value: T,
  key: K,
): Partial<Pick<T, K>> {
  return value[key] === undefined
    ? {}
    : ({ [key]: value[key] } as Partial<Pick<T, K>>);
}

function productionNotFound(resource: string, id: string): NotFoundException {
  return new NotFoundException({
    code: 'STORY_PRODUCTION_RESOURCE_NOT_FOUND',
    message: `${resource} not found.`,
    id,
  });
}

function productionCrossChapter(
  resource: string,
  id: string,
): BadRequestException {
  return new BadRequestException({
    code: 'STORY_PRODUCTION_SCOPE_INVALID',
    message: `${resource} ${id} is not owned by this Story chapter.`,
  });
}

function productionCasConflict(resource: string): ConflictException {
  return new ConflictException({
    code: 'STORY_PRODUCTION_VERSION_CONFLICT',
    message: `${resource} changed after it was loaded. Reload and retry.`,
  });
}

async function requireAssetMediaVersion(
  tx: Prisma.TransactionClient,
  id: string,
  assetSpecId: string,
  projectId: string,
  chapterId: string,
): Promise<void> {
  const row = await tx.storyAssetMediaVersion.findFirst({
    where: {
      id,
      assetSpecId,
      storyProjectId: projectId,
      storyChapterId: chapterId,
      archivedAt: null,
    },
    select: { id: true },
  });
  if (!row) throw productionNotFound('Asset creative media version', id);
}

async function requireClipMediaVersion(
  tx: Prisma.TransactionClient,
  id: string,
  storyboardClipId: string,
  projectId: string,
  chapterId: string,
  clipKind: StoryStoryboardClip['kind'],
): Promise<void> {
  const row = await tx.storyStoryboardClipMediaVersion.findFirst({
    where: {
      id,
      storyboardClipId,
      storyProjectId: projectId,
      storyChapterId: chapterId,
      archivedAt: null,
    },
    select: { id: true, mediaAsset: { select: { kind: true } } },
  });
  if (!row) throw productionNotFound('Storyboard creative media version', id);
  assertStoryboardClipMediaKind(clipKind, row.mediaAsset.kind);
}

async function requireStoryboardCandidateMedia(
  tx: Prisma.TransactionClient,
  projectId: string,
  mediaAssetId: string,
  clipKind: StoryStoryboardClip['kind'],
): Promise<{ id: string; kind: MediaAssetKind }> {
  return requireStoryCandidateMedia(
    tx,
    projectId,
    mediaAssetId,
    clipKind,
    'storyboard_clip',
  );
}

async function requireAssetSpecCandidateImage(
  tx: Prisma.TransactionClient,
  projectId: string,
  mediaAssetId: string,
): Promise<{ id: string; kind: MediaAssetKind }> {
  return requireStoryCandidateMedia(
    tx,
    projectId,
    mediaAssetId,
    'image',
    'asset_spec',
  );
}

async function requireStoryCandidateMedia(
  tx: Prisma.TransactionClient,
  projectId: string,
  mediaAssetId: string,
  expectedKind: StoryStoryboardClip['kind'],
  target: 'asset_spec' | 'storyboard_clip',
): Promise<{ id: string; kind: MediaAssetKind }> {
  const candidate = await tx.storyCandidateAsset.findUnique({
    where: {
      storyProjectId_mediaAssetId: {
        storyProjectId: projectId,
        mediaAssetId,
      },
    },
    select: {
      asset: {
        select: {
          id: true,
          kind: true,
          status: true,
          moderationStatus: true,
          deletedAt: true,
        },
      },
    },
  });
  if (!candidate || candidate.asset.deletedAt) {
    throw new BadRequestException({
      code:
        target === 'asset_spec'
          ? 'ASSET_SPEC_SOURCE_MEDIA_INVALID'
          : 'STORYBOARD_CLIP_SOURCE_MEDIA_INVALID',
      message:
        target === 'asset_spec'
          ? 'The imported Asset image must belong to this project candidate library.'
          : 'The imported media must belong to this project candidate library.',
    });
  }
  if (candidate.asset.status !== MediaAssetStatus.ready) {
    throw new BadRequestException({
      code:
        target === 'asset_spec'
          ? 'ASSET_SPEC_SOURCE_MEDIA_NOT_READY'
          : 'STORYBOARD_CLIP_SOURCE_MEDIA_NOT_READY',
      message:
        target === 'asset_spec'
          ? 'The imported Asset image is not ready yet.'
          : 'The imported media is not ready yet.',
    });
  }
  if (candidate.asset.moderationStatus === MediaAssetModerationStatus.blocked) {
    throw new BadRequestException({
      code:
        target === 'asset_spec'
          ? 'ASSET_SPEC_SOURCE_MEDIA_BLOCKED'
          : 'STORYBOARD_CLIP_SOURCE_MEDIA_BLOCKED',
      message:
        target === 'asset_spec'
          ? 'The imported Asset image was blocked by moderation and cannot be used.'
          : 'The imported media was blocked by moderation and cannot be used.',
    });
  }
  if (target === 'asset_spec') {
    assertAssetSpecImageKind(candidate.asset.kind);
  } else {
    assertStoryboardClipMediaKind(expectedKind, candidate.asset.kind);
  }
  return candidate.asset;
}

function assertAssetSpecImageKind(mediaKind: MediaAssetKind): void {
  if (String(mediaKind) === 'image') return;
  throw new BadRequestException({
    code: 'ASSET_SPEC_MEDIA_KIND_MISMATCH',
    message: 'An Asset Spec can only select image media.',
    mediaKind,
  });
}

export function assertStoryboardClipMediaKind(
  clipKind: StoryStoryboardClip['kind'],
  mediaKind: MediaAssetKind,
): void {
  if (String(clipKind) === String(mediaKind)) return;
  throw new BadRequestException({
    code: 'STORYBOARD_CLIP_MEDIA_KIND_MISMATCH',
    message: `A ${clipKind} Storyboard clip can only select ${clipKind} media.`,
    clipKind,
    mediaKind,
  });
}

function assertClipPromptShape(
  kind: StoryStoryboardClip['kind'],
  imagePrompt: string | null,
  videoPrompt: string | null,
): void {
  if (kind === 'image' && (!imagePrompt?.trim() || videoPrompt !== null)) {
    throw new BadRequestException({
      code: 'STORYBOARD_CLIP_PROMPT_INVALID',
      message:
        'An image clip requires an image prompt and cannot have a video prompt.',
    });
  }
  if (kind === 'video' && (!videoPrompt?.trim() || imagePrompt !== null)) {
    throw new BadRequestException({
      code: 'STORYBOARD_CLIP_PROMPT_INVALID',
      message:
        'A video clip requires a video prompt and cannot have an image prompt.',
    });
  }
}

function jsonStringArray(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new InternalServerErrorException({
      code: 'STORY_CHAPTER_SCOPE_CORRUPT',
      message: 'Story chapter node ownership is invalid.',
    });
  }
  return value as string[];
}

/** Chapter-scoped semantic Plot version used as the Asset upstream fence. */
function chapterPlotFingerprint(
  draft: InteractiveStoryDraftContent,
  chapterEntryNodeId: string | null,
  ownedNodeIds: ReadonlySet<string>,
): string {
  return canonicalJsonHash(
    InteractiveStoryDraftContentSchema.parse({
      ...draft,
      graph: {
        entryNodeId: chapterEntryNodeId,
        nodes: draft.graph.nodes.filter((node) =>
          ownedNodeIds.has(node.nodeId),
        ),
      },
    }),
  );
}

function plotMatchesApprovedScreenplay(
  screenplay: StoryScreenplay,
  draft: InteractiveStoryDraftContent,
  chapterEntryNodeId: string | null,
  ownedNodeIds: ReadonlySet<string>,
): boolean {
  const expected = {
    entryNodeId: screenplay.entrySceneId,
    nodes: screenplay.scenes.map((scene) => ({
      kind: 'clip' as const,
      nodeId: scene.nodeId,
      clipKey: scene.clipKey,
      ...(scene.name ? { name: scene.name } : {}),
      description: [scene.heading, scene.action].join('\n\n'),
      interactions: [],
      exit: scene.exit,
    })),
  };
  const actual = {
    entryNodeId: chapterEntryNodeId,
    nodes: draft.graph.nodes.filter((node) => ownedNodeIds.has(node.nodeId)),
  };
  return canonicalJsonHash(actual) === canonicalJsonHash(expected);
}

function toAssetSpecDto(row: AssetSpecRow) {
  return {
    id: row.id,
    projectId: row.storyProjectId,
    chapterId: row.storyChapterId,
    stableKey: row.stableKey,
    kind: row.kind,
    sourceCharacterId: row.sourceCharacterId,
    sourceNodeIds: jsonStringArray(row.sourceNodeIds),
    name: row.name,
    description: row.description,
    imagePrompt: row.imagePrompt,
    videoPrompt: row.videoPrompt,
    negativePrompt: row.negativePrompt,
    generationConfig: row.generationConfig,
    sourceFingerprint: row.sourceFingerprint,
    pendingSourceFingerprint: row.pendingSourceFingerprint,
    planDisposition: row.planDisposition,
    conflict: toAssetSpecConflictDto(row),
    status: row.status,
    version: row.version,
    selectedMediaVersionId: row.selectedMediaVersionId,
    selectedMediaVersion: row.selectedMediaVersion
      ? toCreativeMediaVersionDto(row.selectedMediaVersion)
      : null,
    mediaVersions: row.mediaVersions.map(toCreativeMediaVersionDto),
    latestGeneration: row.generations[0]
      ? toLatestGenerationDto(row.generations[0], {
          projectId: row.storyProjectId,
          chapterId: row.storyChapterId,
          kind: 'asset_spec',
          targetId: row.id,
        })
      : null,
    userModifiedAt: row.userModifiedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toCreativeMediaVersionDto(row: CreativeMediaVersionRow) {
  const previewUrl = resolveMediaPublicUrl(row.mediaAsset);
  const preferredKey =
    row.preferredVariant?.status === MediaAssetVariantStatus.ready &&
    !row.preferredVariant.deletedAt
      ? row.preferredVariant.variantKey
      : undefined;
  const thumbnail = row.mediaAsset.variants.find(
    (variant) => variant.kind === MediaAssetVariantKind.thumbnail,
  );
  const thumbnailUrl = preferredKey
    ? resolveMediaPublicVariantUrl(row.mediaAsset, preferredKey)
    : thumbnail
      ? resolveMediaPublicVariantUrl(row.mediaAsset, thumbnail.variantKey)
      : null;
  return {
    id: row.id,
    versionNumber: row.versionNumber,
    mediaAssetId: row.mediaAssetId,
    mediaKind: row.mediaAsset.kind,
    mediaStatus: row.mediaAsset.status,
    preferredVariantId: row.preferredVariantId,
    preferredVariantStatus: row.preferredVariant?.status ?? null,
    previewUrl,
    thumbnailUrl: thumbnailUrl ?? previewUrl,
    width: row.mediaAsset.width,
    height: row.mediaAsset.height,
    durationSeconds: row.mediaAsset.durationSeconds,
    mimeType: row.mediaAsset.contentType,
    sourceFingerprint: row.sourceFingerprint,
    createdAt: row.createdAt.toISOString(),
  };
}

function toStoryboardSequenceDto(row: StoryboardSequenceRow) {
  return {
    id: row.id,
    projectId: row.storyProjectId,
    chapterId: row.storyChapterId,
    plotNodeId: row.plotNodeId,
    stableKey: row.stableKey,
    title: row.title,
    description: row.description,
    suggestedDurationMs: row.suggestedDurationMs,
    durationMs: row.durationMs,
    sourceFingerprint: row.sourceFingerprint,
    pendingSourceFingerprint: row.pendingSourceFingerprint,
    planDisposition: row.planDisposition,
    conflict: toStoryboardConflictDto(row),
    status: row.status,
    version: row.version,
    userModifiedAt: row.userModifiedAt?.toISOString() ?? null,
    clips: row.clips.map((clip) => ({
      id: clip.id,
      stableKey: clip.stableKey,
      title: clip.title,
      rank: clip.rank,
      kind: clip.kind,
      track: clip.track,
      startMs: clip.startMs,
      durationMs: clip.durationMs,
      description: clip.description,
      imagePrompt: clip.imagePrompt,
      videoPrompt: clip.videoPrompt,
      negativePrompt: clip.negativePrompt,
      generationConfig: clip.generationConfig,
      status: clip.status,
      version: clip.version,
      selectedMediaVersionId: clip.selectedMediaVersionId,
      selectedMediaVersion: clip.selectedMediaVersion
        ? toCreativeMediaVersionDto(clip.selectedMediaVersion)
        : null,
      mediaVersions: clip.mediaVersions.map(toCreativeMediaVersionDto),
      latestGeneration: clip.generations[0]
        ? toLatestGenerationDto(clip.generations[0], {
            projectId: row.storyProjectId,
            chapterId: row.storyChapterId,
            kind: 'storyboard_clip',
            targetId: clip.id,
            sequenceId: row.id,
          })
        : null,
      userModifiedAt: clip.userModifiedAt?.toISOString() ?? null,
      assetBindings: clip.assetBindings.map((binding) => {
        const resolved =
          binding.mode === StoryStoryboardBindingMode.pinned
            ? binding.pinnedMediaVersion
            : binding.assetSpec.selectedMediaVersion;
        return {
          id: binding.id,
          assetSpecId: binding.assetSpecId,
          assetStableKey: binding.assetSpec.stableKey,
          role: binding.role,
          mode: binding.mode,
          required: binding.required,
          rank: binding.rank,
          status: binding.status,
          version: binding.version,
          pinnedMediaVersionId: binding.pinnedMediaVersionId,
          resolvedMediaVersion: resolved
            ? toCreativeMediaVersionDto(resolved)
            : null,
          assetSpec: toAssetSpecDto(binding.assetSpec),
          userModifiedAt: binding.userModifiedAt?.toISOString() ?? null,
        };
      }),
    })),
    cues: row.cues.map((cue) => ({
      id: cue.id,
      stableKey: cue.stableKey,
      kind: cue.kind,
      plotDecisionId: cue.plotDecisionId,
      atMs: cue.atMs,
      durationMs: cue.durationMs,
      payload: cue.payload,
      status: cue.status,
      version: cue.version,
      userModifiedAt: cue.userModifiedAt?.toISOString() ?? null,
    })),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toAssetSpecConflictDto(row: AssetSpecRow) {
  if (!row.pendingSourceFingerprint || !row.pendingPlanSnapshot) return null;
  const plan = assetPlanFromSnapshot(
    parsePlanSnapshot(row.pendingPlanSnapshot),
  );
  const pendingItem = plan.assetSpecs.find(
    (item) => item.stableKey === row.stableKey,
  );
  const expected = pendingItem
    ? planFingerprint(
        row.pendingPlanSnapshot.sourceFingerprint,
        'asset',
        pendingItem,
      )
    : planFingerprint(
        row.pendingPlanSnapshot.sourceFingerprint,
        'asset-removed',
        { stableKey: row.stableKey },
      );
  assertPendingFingerprint(row, expected);
  return {
    pendingSourceFingerprint: row.pendingSourceFingerprint,
    pendingPlanFingerprint: row.pendingPlanSnapshot.planFingerprint,
    removed: !pendingItem,
    pendingItem: pendingItem ?? null,
  };
}

function toStoryboardConflictDto(row: StoryboardSequenceRow) {
  if (!row.pendingSourceFingerprint || !row.pendingPlanSnapshot) return null;
  const plan = storyboardPlanFromSnapshot(
    parsePlanSnapshot(row.pendingPlanSnapshot),
  );
  const pendingItem = plan.storyboardSequences.find(
    (item) => item.plotNodeId === row.plotNodeId,
  );
  const expected = pendingItem
    ? planFingerprint(
        row.pendingPlanSnapshot.sourceFingerprint,
        'sequence',
        pendingItem,
      )
    : planFingerprint(
        row.pendingPlanSnapshot.sourceFingerprint,
        'sequence-removed',
        { plotNodeId: row.plotNodeId },
      );
  assertPendingFingerprint(row, expected);
  return {
    pendingSourceFingerprint: row.pendingSourceFingerprint,
    pendingPlanFingerprint: row.pendingPlanSnapshot.planFingerprint,
    removed: !pendingItem,
    pendingItem: pendingItem ?? null,
  };
}

type LatestGenerationRow = AssetSpecRow['generations'][number];

/**
 * Creative-media selection is presentation state, not a semantic edit to the
 * logical production specification. Keeping this distinction explicit lets a
 * later approved Script/plan reconcile update prompts and topology normally,
 * while still protecting genuine creator-authored spec changes as stale.
 */
export function storyAssetSemanticPatch(
  input: PatchStoryAssetSpecInput,
): boolean {
  return (
    input.name !== undefined ||
    input.description !== undefined ||
    input.imagePrompt !== undefined ||
    input.videoPrompt !== undefined ||
    input.negativePrompt !== undefined
  );
}

export function storyboardClipSemanticPatch(
  input: PatchStoryStoryboardClipInput,
): boolean {
  return (
    input.kind !== undefined ||
    input.title !== undefined ||
    input.description !== undefined ||
    input.imagePrompt !== undefined ||
    input.videoPrompt !== undefined ||
    input.negativePrompt !== undefined
  );
}

/**
 * Preserve the semantic meaning of a cue placed exactly at a sequence tail.
 * Other cues are absolute timeline coordinates and do not drift on resize.
 */
export function storyboardCueTimeAfterTimelineResize(
  cueAtMs: number,
  previousDurationMs: number,
  nextDurationMs: number,
): number {
  return cueAtMs === previousDurationMs ? nextDurationMs : cueAtMs;
}

function toLatestGenerationDto(
  generation: LatestGenerationRow,
  target:
    | {
        projectId: string;
        chapterId: string;
        kind: 'asset_spec';
        targetId: string;
      }
    | {
        projectId: string;
        chapterId: string;
        kind: 'storyboard_clip';
        targetId: string;
        sequenceId: string;
      },
) {
  const basePath = storyProductionGenerationBasePath({
    projectId: target.projectId,
    chapterId: target.chapterId,
    generationId: generation.id,
    target:
      target.kind === 'asset_spec'
        ? { kind: 'asset_spec', id: target.targetId }
        : {
            kind: 'storyboard_clip',
            id: target.targetId,
            sequenceId: target.sequenceId,
          },
  });
  return {
    id: generation.id,
    outputKind: generation.generationKind,
    targetVersion: generation.targetVersion,
    targetSourceFingerprint: generation.targetSourceFingerprint,
    retryOfGenerationId: generation.retryOfGenerationId,
    ...toStoryProductionGenerationProgressDto(generation),
    materialization: {
      ...toStoryProductionGenerationProgressDto(generation).materialization,
      retryUrl: `${basePath}/materialization/retry`,
    },
    statusUrl: basePath,
    cancelUrl: `${basePath}/cancel`,
    retryUrl: `${basePath}/retry`,
    createdAt: generation.createdAt.toISOString(),
    updatedAt: generation.updatedAt.toISOString(),
  };
}
