import {
  requireStoryCandidateMedia,
  assertStoryboardClipMediaKind,
  type StoryCandidateMedia,
} from './story-candidate-media';
export { assertStoryboardClipMediaKind } from './story-candidate-media';
import { STORY_CHAPTER_ASSETS_MAX } from '@repo/shared/story-production';
import { StorySubtitleTracksSchema } from '@repo/shared/story-subtitles';
import { parseStorySubtitleFile } from './story-subtitle-file';
import { storySubtitleTimeline } from './story-subtitle-tracks';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  MediaAssetStatus,
  MediaAssetVariantKind,
  MediaAssetVariantStatus,
  Prisma,
  StoryAssetGenerationPurpose,
  StoryProductionSpecStatus,
  StoryStoryboardBindingMode,
  type StoryAssetSpec,
  type StoryStoryboardClip,
  type StoryStoryboardSequence,
} from '@prisma/client';
import {
  normalizeStoryboardAssetMentions,
  StoryAssetPlanSchema,
  StoryProductionPlanSchema,
  StoryStoryboardPlanSchema,
  storyClipAssetMentions,
  type StoryAssetPlan,
  type StoryProductionPlan,
  type StoryStoryboardPlan,
} from '@repo/shared/story-production';
import { storyAutoFallbackNodeId } from '@repo/shared/story-stats';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import {
  resolveMediaPublicUrl,
  resolveMediaPublicVariantUrl,
} from '../infra/storage/media-asset-url-resolver.service';
import { canonicalJsonHash } from './canonical-json';
import { InteractiveStoryDraftContentSchema } from './dto';
import { StoryPermissionService } from './story-permission.service';
import {
  storyProductionGenerationBasePath,
  toStoryProductionGenerationProgressDto,
} from './story-production-generation.dto';
import { StoryProjectWriteGuardService } from './story-project-write-guard.service';
import { readStoryScriptHead } from './story-script-stage';
import type {
  ArchiveStoryAssetSpecInput,
  CreateStoryAssetSpecInput,
  PatchStoryAssetSpecInput,
  PatchStoryStoryboardClipInput,
  PatchStoryStoryboardCueInput,
  PatchStoryStoryboardSequenceInput,
  PutStoryStoryboardBindingInput,
  PutStoryStoryboardTimelineInput,
} from './story-production-plan.schema';
import { PutStoryStoryboardTimelineSchema } from './story-production-plan.schema';

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
    distinct: ['purpose'],
    take: 2,
    include: { aiJob: true },
  },
});

const STORYBOARD_INCLUDE =
  Prisma.validator<Prisma.StoryStoryboardSequenceInclude>()({
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

/** Agent-facing slim projection: no media versions, generations, bindings. */
const STORYBOARD_AGENT_INCLUDE =
  Prisma.validator<Prisma.StoryStoryboardSequenceInclude>()({
    clips: {
      where: { status: { not: StoryProductionSpecStatus.archived } },
      orderBy: [{ rank: 'asc' }, { id: 'asc' }],
    },
    cues: {
      where: { status: { not: StoryProductionSpecStatus.archived } },
      orderBy: [{ atMs: 'asc' }, { id: 'asc' }],
    },
  });

const STORYBOARD_TIMELINE_MIN_CLIP_DURATION_MS = 250;
const STORYBOARD_TIMELINE_MAX_DURATION_MS = 3_600_000;

// ── Version-free Agent storyboard commands ─────────────────────────────────
//
// The Agent tool contract deliberately omits CAS version tokens: clip ids are
// globally unique and writes are last-write-wins. The write fence serializes
// writers, so resolving against the current rows inside the mutation
// transaction is the honest head.

export type AgentStoryboardTimelineClipInput =
  | {
      clipId?: string;
      stableKey: string;
      title: string;
      description: string | null;
      startMs: number;
      durationMs: number;
      negativePrompt?: string | null;
      kind: 'image';
      imagePrompt: string;
    }
  | {
      clipId?: string;
      stableKey: string;
      title: string;
      description: string | null;
      startMs: number;
      durationMs: number;
      negativePrompt?: string | null;
      kind: 'video';
      videoPrompt: string;
    };

export interface AgentStoryboardTimelineInput {
  durationMs: number;
  clips: AgentStoryboardTimelineClipInput[];
}

export interface AgentStoryboardClipPatchInput {
  kind?: 'image' | 'video';
  title?: string;
  description?: string | null;
  imagePrompt?: string | null;
  videoPrompt?: string | null;
  negativePrompt?: string | null;
}

function isAgentStoryboardTimelineInput(
  input: PutStoryStoryboardTimelineInput | AgentStoryboardTimelineInput,
): input is AgentStoryboardTimelineInput {
  return !('expectedVersion' in input);
}

function isAgentStoryboardClipPatchInput(
  input: PatchStoryStoryboardClipInput | AgentStoryboardClipPatchInput,
): input is AgentStoryboardClipPatchInput {
  return !('expectedVersion' in input);
}

/**
 * Map a version-free Agent timeline command onto the shared editor contract,
 * resolving every CAS token from the current rows. Continuity and prompt
 * shape are re-validated through {@link PutStoryStoryboardTimelineSchema} so
 * manual, Agent, and pipeline writes share one validation source.
 */
export function resolveAgentStoryboardTimelineInput(
  sequenceVersion: number,
  allClips: Array<{
    id: string;
    version: number;
    status: StoryProductionSpecStatus;
  }>,
  input: AgentStoryboardTimelineInput,
): PutStoryStoryboardTimelineInput {
  const activeById = new Map(
    allClips
      .filter((clip) => clip.status !== StoryProductionSpecStatus.archived)
      .map((clip) => [clip.id, clip] as const),
  );
  const mapped = {
    expectedVersion: sequenceVersion,
    durationMs: input.durationMs,
    clips: input.clips.map((clip) => {
      const base = {
        kind: clip.kind,
        stableKey: clip.stableKey,
        title: clip.title,
        description: clip.description ?? null,
        startMs: clip.startMs,
        durationMs: clip.durationMs,
        negativePrompt: clip.negativePrompt ?? null,
        ...(clip.kind === 'image'
          ? { imagePrompt: clip.imagePrompt, videoPrompt: null }
          : { imagePrompt: null, videoPrompt: clip.videoPrompt }),
      };
      if (!clip.clipId) return { ...base, expectedVersion: 0 };
      const existing = activeById.get(clip.clipId);
      if (!existing) {
        throw productionNotFound('Storyboard clip', clip.clipId);
      }
      return { ...base, id: clip.clipId, expectedVersion: existing.version };
    }),
  };
  const parsed = PutStoryStoryboardTimelineSchema.safeParse(mapped);
  if (!parsed.success) {
    throw new BadRequestException({
      code: 'STORYBOARD_TIMELINE_INVALID',
      message: parsed.error.issues.map((issue) => issue.message).join(' '),
    });
  }
  return parsed.data;
}

interface StoryboardClipTiming {
  id: string;
  rank: number;
  startMs: number;
  durationMs: number;
}

interface StoryboardTimelineResizeContext {
  sequenceVersion: number;
  previousDurationMs: number;
  durationMs: number;
  previousClips: Array<StoryboardClipTiming & { version: number }>;
  clips: StoryboardClipTiming[];
  cues: Array<{
    id: string;
    storyboardClipId: string | null;
    atMs: number;
    version: number;
  }>;
}

/**
 * Resize one clip and rebuild the continuous visual track around it. Media
 * selection is a server-owned mutation, so every affected timestamp is
 * derived here rather than patched independently by the browser.
 */
export function resizeStoryboardTimelineClip(
  clips: readonly StoryboardClipTiming[],
  clipId: string,
  durationMs: number,
): { durationMs: number; clips: StoryboardClipTiming[] } {
  if (
    !Number.isInteger(durationMs) ||
    durationMs < STORYBOARD_TIMELINE_MIN_CLIP_DURATION_MS
  ) {
    throw new RangeError('A Storyboard clip duration must be at least 250ms.');
  }
  const ordered = [...clips].sort(
    (left, right) => left.rank - right.rank || left.id.localeCompare(right.id),
  );
  if (!ordered.some((clip) => clip.id === clipId)) {
    throw new RangeError(
      'The resized Storyboard clip is not on this timeline.',
    );
  }
  let cursor = 0;
  const resized = ordered.map((clip) => {
    const next = {
      ...clip,
      startMs: cursor,
      durationMs: clip.id === clipId ? durationMs : clip.durationMs,
    };
    cursor += next.durationMs;
    return next;
  });
  if (cursor > STORYBOARD_TIMELINE_MAX_DURATION_MS) {
    throw new RangeError('A Storyboard timeline cannot exceed one hour.');
  }
  return { durationMs: cursor, clips: resized };
}

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
  storyboardPlan: StoryStoryboardPlan;
}

/** Legacy whole-plan helper retained for old proposals and tests. */
export interface ApplyApprovedProductionPlanInput extends StoryProductionApplyContext {
  canonicalCharacterIds: readonly string[];
  productionPlan: StoryProductionPlan;
}

export interface StoryProductionReconcileResult {
  assetSpecsCreated: number;
  assetSpecsUpdated: number;
  sequencesCreated: number;
  sequencesUpdated: number;
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

export type StoryProductionStageStatus = 'missing' | 'current';

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
  };
  storyboard: {
    status: StoryProductionStageStatus;
    sequenceCount: number;
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
    ] = [
      await tx.storyProject.findUniqueOrThrow({ where: { id: projectId } }),
      await tx.storyChapter.findFirstOrThrow({
        where: { id: chapterId, storyProjectId: projectId, archivedAt: null },
        select: { nodeIds: true },
      }),
      await tx.storyDraft.findUniqueOrThrow({
        where: { storyProjectId: projectId },
      }),
      await tx.storyAssetSpec.findMany({
        where: {
          storyProjectId: projectId,
          storyChapterId: chapterId,
          status: { not: StoryProductionSpecStatus.archived },
        },
        select: {
          stableKey: true,
          status: true,
        },
      }),
      await tx.storyStoryboardSequence.findMany({
        where: {
          storyProjectId: projectId,
          storyChapterId: chapterId,
          status: { not: StoryProductionSpecStatus.archived },
        },
        select: {
          plotNodeId: true,
          clips: {
            where: { status: { not: StoryProductionSpecStatus.archived } },
            select: { id: true },
          },
        },
      }),
      await readStoryScriptHead(tx, projectId, chapterId),
      await this.readApprovedAssetPlanMarkerInTransaction(
        tx,
        projectId,
        chapterId,
      ),
    ];
    const parsedDraft = InteractiveStoryDraftContentSchema.parse(draft.content);
    const ownedNodeIds = new Set(jsonStringArray(chapter.nodeIds));
    const plotNodeIds = parsedDraft.graph.nodes
      .filter((node) => node.kind === 'clip' && ownedNodeIds.has(node.nodeId))
      .map((node) => node.nodeId);
    const sequenceByPlotNode = new Map(
      sequenceRows.map((sequence) => [sequence.plotNodeId, sequence]),
    );
    // Saving a Plot draft pre-creates one empty identity sequence per node
    // (reconcileStoryTimelinesWithDraft); those shells carry no clips. A
    // sequence counts as planned only once it holds at least one live clip —
    // otherwise the storyboard stage would report itself complete while no
    // clip spec was ever authored.
    const missingPlotNodeIds = plotNodeIds.filter((nodeId) => {
      const sequence = sequenceByPlotNode.get(nodeId);
      return sequence === undefined || sequence.clips.length === 0;
    });
    const assetCurrent = assetRows.length;
    const scriptStatus: StoryProductionStageStatus = scriptHead.hasContent
      ? 'current'
      : 'missing';
    const plotStatus: StoryProductionStageStatus =
      plotNodeIds.length > 0 ? 'current' : 'missing';
    const assetStatus: StoryProductionStageStatus =
      approvedAssetPlanMarker !== null || assetRows.length > 0
        ? 'current'
        : 'missing';
    const storyboardStatus: StoryProductionStageStatus =
      sequenceRows.length > 0 && missingPlotNodeIds.length === 0
        ? 'current'
        : 'missing';
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
      },
      storyboard: {
        status: storyboardStatus,
        sequenceCount: sequenceRows.length,
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

  /** Read exact generation receipts even after a target is archived or reselected. */
  async listGenerationMedia(
    user: AuthUser,
    projectId: string,
    chapterId: string,
    generationIds: string[],
  ) {
    await this.requireScope(user, projectId, chapterId, 'story.read');
    if (!generationIds.length) return [];
    const where = {
      storyProjectId: projectId,
      storyChapterId: chapterId,
      generationId: { in: generationIds },
      archivedAt: null,
      mediaAsset: { status: MediaAssetStatus.ready, deletedAt: null },
    };
    const [assets, clips] = await Promise.all([
      this.prisma.storyAssetMediaVersion.findMany({
        where,
        orderBy: [{ versionNumber: 'desc' }, { id: 'asc' }],
        include: {
          ...CREATIVE_MEDIA_VERSION_INCLUDE,
          assetSpec: { select: { name: true } },
        },
      }),
      this.prisma.storyStoryboardClipMediaVersion.findMany({
        where,
        orderBy: [{ versionNumber: 'desc' }, { id: 'asc' }],
        include: {
          ...CREATIVE_MEDIA_VERSION_INCLUDE,
          storyboardClip: { select: { title: true } },
        },
      }),
    ]);
    return [
      ...assets.map((row) => ({
        title: row.assetSpec.name,
        media: toCreativeMediaVersionDto(row),
      })),
      ...clips.map((row) => ({
        title: row.storyboardClip.title,
        media: toCreativeMediaVersionDto(row),
      })),
    ];
  }

  async createAssetSpec(
    user: AuthUser,
    projectId: string,
    chapterId: string,
    idempotencyKey: string,
    input: CreateStoryAssetSpecInput,
  ) {
    return this.mutateWithReceipt({
      user,
      projectId,
      chapterId,
      idempotencyKey,
      operation: 'asset-spec.create',
      request: input,
      mutate: async (tx, now) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtext(${`story-production-asset-create:${chapterId}`})::bigint
          )
        `;
        const activeCount = await tx.storyAssetSpec.count({
          where: {
            storyProjectId: projectId,
            storyChapterId: chapterId,
            status: { not: StoryProductionSpecStatus.archived },
          },
        });
        if (activeCount >= STORY_CHAPTER_ASSETS_MAX) {
          throw new BadRequestException({
            code: 'STORY_PRODUCTION_ASSET_LIMIT_REACHED',
            message: `A chapter can contain at most ${STORY_CHAPTER_ASSETS_MAX} Asset Specs.`,
          });
        }
        const stableKey = `manual.${input.kind}.${randomUUID()}`;
        const sourceFingerprint = canonicalJsonHash({
          kind: 'human-asset-spec',
          projectId,
          chapterId,
          stableKey,
        });
        const created = await tx.storyAssetSpec.create({
          data: {
            storyProjectId: projectId,
            storyChapterId: chapterId,
            stableKey,
            kind: input.kind,
            sourceCharacterId: null,
            sourceNodeIds: [],
            name: input.name,
            description: input.description ?? null,
            imagePrompt: input.imagePrompt,
            videoPrompt: input.videoPrompt ?? null,
            negativePrompt: input.negativePrompt ?? null,
            sourceFingerprint,
            status: StoryProductionSpecStatus.current,
            createdByUserId: user.userId,
            userModifiedAt: now,
            userModifiedByUserId: user.userId,
            lastPlannedAt: now,
          },
          include: ASSET_SPEC_INCLUDE,
        });
        return toAssetSpecDto(created);
      },
    });
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

  /**
   * Slim, version-free Storyboard projection for the Agent tools: identities,
   * timings, and prompts only — no media versions, generations, or asset
   * bindings. Reuses getStoryboard's Plot↔Storyboard 1:1 identity guard so a
   * repair-required chapter still fails loud.
   */
  async getStoryboardForAgent(
    user: AuthUser,
    projectId: string,
    chapterId: string,
  ) {
    await this.requireScope(user, projectId, chapterId, 'story.read');
    const [chapter, draft, rows] = await Promise.all([
      this.prisma.storyChapter.findFirstOrThrow({
        where: {
          id: chapterId,
          storyProjectId: projectId,
          archivedAt: null,
        },
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
        include: STORYBOARD_AGENT_INCLUDE,
      }),
    ]);
    const content = InteractiveStoryDraftContentSchema.parse(draft.content);
    const ownedNodeIds = new Set(jsonStringArray(chapter.nodeIds));
    const ownedPlotNodes = content.graph.nodes
      .filter((node) => node.kind === 'clip')
      .filter((node) => ownedNodeIds.has(node.nodeId));
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
    return {
      chapterId,
      sequences: ownedPlotNodes.map((node) => {
        const row = sequenceByNode.get(node.nodeId);
        // Guarded above; kept local so a future query refactor cannot
        // silently reintroduce a graph-only scene.
        if (!row) {
          throw new InternalServerErrorException(
            'Storyboard identity invariant failed.',
          );
        }
        return {
          sequenceId: row.id,
          plotNodeId: row.plotNodeId,
          description: row.description,
          durationMs: row.durationMs,
          suggestedDurationMs: row.suggestedDurationMs,
          userModifiedAt: row.userModifiedAt?.toISOString() ?? null,
          clips: row.clips.map((clip) => ({
            clipId: clip.id,
            stableKey: clip.stableKey,
            kind: clip.kind,
            title: clip.title,
            description: clip.description,
            startMs: clip.startMs,
            durationMs: clip.durationMs,
            imagePrompt: clip.imagePrompt,
            videoPrompt: clip.videoPrompt,
            negativePrompt: clip.negativePrompt,
            userModifiedAt: clip.userModifiedAt?.toISOString() ?? null,
          })),
          cues: row.cues.map((cue) => ({
            cueId: cue.id,
            stableKey: cue.stableKey,
            kind: cue.kind,
            atMs: cue.atMs,
            decisionId: cue.plotDecisionId,
          })),
        };
      }),
    };
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
        if (
          input.sourceMediaPurpose === 'turnaround' &&
          current.kind !== 'character'
        ) {
          throw new BadRequestException({
            code: 'STORY_PRODUCTION_ASSET_MEDIA_PURPOSE_UNSUPPORTED',
            message:
              'Three-view media can only be added to character Asset Specs.',
          });
        }
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
          // Use the same target lock as AI materialization so uploads and
          // concurrently completed generations share one version sequence.
          await tx.$executeRaw`
            SELECT pg_advisory_xact_lock(
              hashtext(${`story-production-media-version:asset_spec:${current.id}`})::bigint
            )
          `;
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
                purpose: input.sourceMediaPurpose ?? 'primary',
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
            ...(importedMediaVersionId &&
            (input.sourceMediaPurpose ?? 'primary') === 'primary'
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

  async archiveAssetSpec(
    user: AuthUser,
    projectId: string,
    chapterId: string,
    assetSpecId: string,
    idempotencyKey: string,
    input: ArchiveStoryAssetSpecInput,
  ) {
    return this.mutateWithReceipt({
      user,
      projectId,
      chapterId,
      idempotencyKey,
      operation: 'asset-spec.archive',
      request: { assetSpecId, input },
      mutate: async (tx, now) => {
        const current = await tx.storyAssetSpec.findFirst({
          where: {
            id: assetSpecId,
            storyProjectId: projectId,
            storyChapterId: chapterId,
            status: { not: StoryProductionSpecStatus.archived },
          },
        });
        if (!current) throw productionNotFound('Asset Spec', assetSpecId);
        const sourceFingerprint = canonicalJsonHash({
          kind: 'human-asset-spec-archived',
          projectId,
          chapterId,
          assetSpecId,
          previousSourceFingerprint: current.sourceFingerprint,
        });
        const archived = await tx.storyAssetSpec.updateMany({
          where: {
            id: current.id,
            version: input.expectedVersion,
            status: { not: StoryProductionSpecStatus.archived },
          },
          data: {
            sourceFingerprint,
            status: StoryProductionSpecStatus.archived,
            userModifiedAt: now,
            userModifiedByUserId: user.userId,
            version: { increment: 1 },
          },
        });
        if (archived.count !== 1) throw productionCasConflict('Asset Spec');
        await tx.storyStoryboardClipAssetBinding.updateMany({
          where: {
            assetSpecId: current.id,
            status: { not: StoryProductionSpecStatus.archived },
          },
          data: {
            status: StoryProductionSpecStatus.archived,
            version: { increment: 1 },
          },
        });
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
            status: { not: StoryProductionSpecStatus.archived },
          },
          include: STORYBOARD_INCLUDE,
        });
        if (!sequence)
          throw productionNotFound('Storyboard sequence', sequenceId);
        let subtitleTracks: Prisma.InputJsonValue | undefined;
        if (input.subtitleUpload || input.removeSubtitleLanguage) {
          const tracks = StorySubtitleTracksSchema.parse(
            sequence.subtitleTracks,
          );
          if (input.subtitleUpload) {
            const upload = input.subtitleUpload;
            const timeline = storySubtitleTimeline(sequence);
            if (upload.timelineFingerprint !== timeline.fingerprint)
              throw new ConflictException({
                code: 'STORY_SUBTITLE_TIMELINE_CHANGED',
                message:
                  'The storyboard node timeline changed. Refresh before uploading subtitles.',
              });
            if (!timeline.ready)
              throw new BadRequestException({
                code: 'STORY_SUBTITLE_TIMELINE_REQUIRED',
                message:
                  'Select playable media with known durations for every segment before uploading node subtitles.',
              });
            const cues = parseStorySubtitleFile(upload.content, upload.format);
            if (cues.some((cue) => cue.endMs > timeline.durationMs!))
              throw new BadRequestException({
                code: 'STORY_SUBTITLE_DURATION',
                message:
                  'A subtitle extends beyond this storyboard node. Check its timecodes.',
              });
            subtitleTracks = StorySubtitleTracksSchema.parse([
              ...tracks.filter((track) => track.language !== upload.language),
              {
                language: upload.language,
                timelineFingerprint: timeline.fingerprint,
                fileName: upload.fileName,
                format: upload.format,
                cues,
              },
            ]);
          } else {
            subtitleTracks = tracks.filter(
              (track) => track.language !== input.removeSubtitleLanguage,
            );
          }
        }
        const updated = await tx.storyStoryboardSequence.updateMany({
          where: { id: sequence.id, version: input.expectedVersion },
          data: {
            ...defined(input, 'description'),
            ...(subtitleTracks !== undefined ? { subtitleTracks } : {}),
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
    input: PutStoryStoryboardTimelineInput | AgentStoryboardTimelineInput,
  ) {
    const agentInput = isAgentStoryboardTimelineInput(input);
    return this.mutateWithReceipt({
      user,
      projectId,
      chapterId,
      idempotencyKey,
      operation: 'storyboard-timeline.put',
      request: { sequenceId, input },
      mutationFence: agentInput ? 'agent_os' : 'human',
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

        const [allClips, cues] = [
          await tx.storyStoryboardClip.findMany({
            where: {
              sequenceId,
              storyProjectId: projectId,
              storyChapterId: chapterId,
            },
            orderBy: [{ rank: 'asc' }, { id: 'asc' }],
          }),
          await tx.storyStoryboardCue.findMany({
            where: {
              sequenceId,
              storyProjectId: projectId,
              storyChapterId: chapterId,
              status: { not: StoryProductionSpecStatus.archived },
            },
            select: { id: true, atMs: true, version: true },
          }),
        ];
        // Agent commands are version-free: resolve them against the current
        // rows inside this mutation transaction (last-write-wins; the write
        // fence serializes writers) and re-validate continuity through the
        // shared editor contract.
        const effective: PutStoryStoryboardTimelineInput =
          isAgentStoryboardTimelineInput(input)
            ? resolveAgentStoryboardTimelineInput(
                sequence.version,
                allClips,
                input,
              )
            : input;
        if (sequence.version !== effective.expectedVersion) {
          throw productionCasConflict('Storyboard sequence');
        }
        if (
          cues.some(
            (cue) =>
              storyboardCueTimeAfterTimelineResize(
                cue.atMs,
                sequence.durationMs,
                effective.durationMs,
              ) > effective.durationMs,
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
        const importedMedia = new Map<string, StoryCandidateMedia>();

        for (const clipInput of effective.clips) {
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
          const offset = storyboardRankOffset(allClips, effective.clips.length);
          await tx.storyStoryboardClip.updateMany({
            where: { sequenceId },
            data: { rank: { increment: offset } },
          });
        }

        for (const [rank, clipInput] of effective.clips.entries()) {
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
        let archivedRank = effective.clips.length;
        for (const clip of omitted) {
          await tx.storyStoryboardClipAssetBinding.updateMany({
            where: { storyboardClipId: clip.id },
            data: {
              status: StoryProductionSpecStatus.archived,
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
          where: { id: sequence.id, version: effective.expectedVersion },
          data: {
            durationMs: effective.durationMs,
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

  async prepareStoryboardTimelineResizeInTransaction(
    tx: Prisma.TransactionClient,
    input: {
      projectId: string;
      chapterId: string;
      sequenceId: string;
      clipId: string;
      durationMs: number;
    },
  ): Promise<StoryboardTimelineResizeContext> {
    const timeline = await tx.storyStoryboardSequence.findFirst({
      where: {
        id: input.sequenceId,
        storyProjectId: input.projectId,
        storyChapterId: input.chapterId,
        status: { not: StoryProductionSpecStatus.archived },
      },
      select: {
        version: true,
        durationMs: true,
        clips: {
          where: { status: { not: StoryProductionSpecStatus.archived } },
          orderBy: [{ rank: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            rank: true,
            startMs: true,
            durationMs: true,
            version: true,
          },
        },
        cues: {
          where: { status: { not: StoryProductionSpecStatus.archived } },
          select: {
            id: true,
            storyboardClipId: true,
            atMs: true,
            version: true,
          },
        },
      },
    });
    if (!timeline) {
      throw productionNotFound('Storyboard sequence', input.sequenceId);
    }
    try {
      const resized = resizeStoryboardTimelineClip(
        timeline.clips,
        input.clipId,
        input.durationMs,
      );
      return {
        sequenceVersion: timeline.version,
        previousDurationMs: timeline.durationMs,
        durationMs: resized.durationMs,
        previousClips: timeline.clips,
        clips: resized.clips,
        cues: timeline.cues,
      };
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      throw new BadRequestException({
        code: 'STORYBOARD_CLIP_SOURCE_DURATION_INVALID',
        message: error.message,
      });
    }
  }

  async applyStoryboardTimelineResizeInTransaction(
    tx: Prisma.TransactionClient,
    input: {
      sequenceId: string;
      clipId: string;
      resize: StoryboardTimelineResizeContext;
    },
  ): Promise<void> {
    const previousById = new Map(
      input.resize.previousClips.map((clip) => [clip.id, clip]),
    );
    const nextById = new Map(input.resize.clips.map((clip) => [clip.id, clip]));
    for (const nextClip of input.resize.clips) {
      if (nextClip.id === input.clipId) continue;
      const previousClip = previousById.get(nextClip.id);
      if (!previousClip || previousClip.startMs === nextClip.startMs) continue;
      const shifted = await tx.storyStoryboardClip.updateMany({
        where: { id: nextClip.id, version: previousClip.version },
        data: { startMs: nextClip.startMs, version: { increment: 1 } },
      });
      if (shifted.count !== 1) throw productionCasConflict('Storyboard clip');
    }
    for (const cue of input.resize.cues) {
      let nextAtMs = storyboardCueTimeAfterTimelineResize(
        cue.atMs,
        input.resize.previousDurationMs,
        input.resize.durationMs,
      );
      if (cue.storyboardClipId) {
        const previousClip = previousById.get(cue.storyboardClipId);
        const nextClip = nextById.get(cue.storyboardClipId);
        if (previousClip && nextClip) {
          const localOffsetMs = Math.max(0, cue.atMs - previousClip.startMs);
          nextAtMs =
            nextClip.startMs +
            (localOffsetMs === previousClip.durationMs
              ? nextClip.durationMs
              : Math.min(localOffsetMs, nextClip.durationMs));
        }
      }
      if (nextAtMs === cue.atMs) continue;
      const shifted = await tx.storyStoryboardCue.updateMany({
        where: { id: cue.id, version: cue.version },
        data: { atMs: nextAtMs, version: { increment: 1 } },
      });
      if (shifted.count !== 1) throw productionCasConflict('Storyboard cue');
    }
    if (input.resize.durationMs === input.resize.previousDurationMs) return;
    const resized = await tx.storyStoryboardSequence.updateMany({
      where: {
        id: input.sequenceId,
        version: input.resize.sequenceVersion,
      },
      data: { durationMs: input.resize.durationMs, version: { increment: 1 } },
    });
    if (resized.count !== 1) {
      throw productionCasConflict('Storyboard sequence');
    }
  }

  async patchClip(
    user: AuthUser,
    projectId: string,
    chapterId: string,
    /** Null for Agent tool calls, which address the clip by its unique id. */
    sequenceId: string | null,
    clipId: string,
    idempotencyKey: string,
    input: PatchStoryStoryboardClipInput | AgentStoryboardClipPatchInput,
  ) {
    const agentInput = isAgentStoryboardClipPatchInput(input);
    return this.mutateWithReceipt({
      user,
      projectId,
      chapterId,
      idempotencyKey,
      operation: 'storyboard-clip.patch',
      request: { sequenceId, clipId, input },
      mutationFence: agentInput ? 'agent_os' : 'human',
      mutate: async (tx, now) => {
        const clip = await tx.storyStoryboardClip.findFirst({
          where: {
            id: clipId,
            ...(sequenceId ? { sequenceId } : {}),
            storyProjectId: projectId,
            storyChapterId: chapterId,
          },
        });
        if (!clip) throw productionNotFound('Storyboard clip', clipId);
        // Version-free Agent commands resolve against the current row inside
        // this mutation transaction: last-write-wins by design.
        const effective: PatchStoryStoryboardClipInput =
          isAgentStoryboardClipPatchInput(input)
            ? { ...input, expectedVersion: clip.version }
            : input;
        const nextKind = effective.kind ?? clip.kind;
        if (effective.selectedMediaVersionId) {
          await requireClipMediaVersion(
            tx,
            effective.selectedMediaVersionId,
            clip.id,
            projectId,
            chapterId,
            nextKind,
          );
        }
        let importedMediaVersionId: string | null = null;
        let timelineResize: StoryboardTimelineResizeContext | null = null;
        if (effective.sourceMediaAssetId) {
          const source = await requireStoryboardCandidateMedia(
            tx,
            projectId,
            effective.sourceMediaAssetId,
            nextKind,
          );
          if (nextKind === 'video') {
            if (
              source.durationMs === null ||
              !Number.isInteger(source.durationMs) ||
              source.durationMs < STORYBOARD_TIMELINE_MIN_CLIP_DURATION_MS
            ) {
              throw new BadRequestException({
                code: 'STORYBOARD_CLIP_SOURCE_DURATION_REQUIRED',
                message:
                  'The uploaded video has no valid duration metadata and cannot be placed on the Storyboard timeline.',
              });
            }
            timelineResize =
              await this.prepareStoryboardTimelineResizeInTransaction(tx, {
                projectId,
                chapterId,
                sequenceId: clip.sequenceId,
                clipId: clip.id,
                durationMs: source.durationMs,
              });
          }
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
          effective.imagePrompt === undefined
            ? clip.imagePrompt
            : effective.imagePrompt;
        const nextVideoPrompt =
          effective.videoPrompt === undefined
            ? clip.videoPrompt
            : effective.videoPrompt;
        assertClipPromptShape(nextKind, nextImagePrompt, nextVideoPrompt);
        if (
          nextImagePrompt !== clip.imagePrompt ||
          nextVideoPrompt !== clip.videoPrompt
        ) {
          const promptSpec = {
            stableKey: clip.stableKey,
            imagePrompt: nextImagePrompt,
            videoPrompt: nextVideoPrompt,
          };
          const mentionKeys = storyClipAssetMentions(promptSpec);
          const assets = mentionKeys.length
            ? await tx.storyAssetSpec.findMany({
                where: {
                  storyProjectId: projectId,
                  storyChapterId: chapterId,
                  stableKey: { in: mentionKeys },
                  status: { not: StoryProductionSpecStatus.archived },
                },
              })
            : [];
          const assetByKey = new Map(
            assets.map((asset) => [asset.stableKey, asset]),
          );
          const missingKey = mentionKeys.find((key) => !assetByKey.has(key));
          if (missingKey) {
            throw new BadRequestException({
              code: 'STORYBOARD_CLIP_ASSET_NOT_FOUND',
              message: `The referenced Asset @${missingKey} is not available in this chapter.`,
            });
          }
          // The composer saves @stableKey tokens. Keep their derived binding
          // rows in the same transaction so Generate uses the saved references.
          await this.reconcileBindings(
            tx,
            {
              storyProjectId: projectId,
              storyChapterId: chapterId,
              actorUserId: user.userId,
              sourceFingerprint: clip.sourceFingerprint,
            },
            promptSpec,
            clip,
            assetByKey,
            now,
            { preserveCompatibleBindings: true },
          );
        }
        const semanticModified = storyboardClipSemanticPatch(effective);
        const resizedClip = timelineResize?.clips.find(
          (candidate) => candidate.id === clip.id,
        );
        const updated = await tx.storyStoryboardClip.updateMany({
          where: { id: clip.id, version: effective.expectedVersion },
          data: {
            ...defined(effective, 'kind'),
            ...defined(effective, 'title'),
            ...defined(effective, 'description'),
            ...defined(effective, 'imagePrompt'),
            ...defined(effective, 'videoPrompt'),
            ...defined(effective, 'negativePrompt'),
            ...(resizedClip ? { durationMs: resizedClip.durationMs } : {}),
            ...(importedMediaVersionId
              ? { selectedMediaVersionId: importedMediaVersionId }
              : effective.selectedMediaVersionId !== undefined
                ? { selectedMediaVersionId: effective.selectedMediaVersionId }
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
        if (timelineResize) {
          await this.applyStoryboardTimelineResizeInTransaction(tx, {
            sequenceId: clip.sequenceId,
            clipId: clip.id,
            resize: timelineResize,
          });
        }
        const sequence = toStoryboardSequenceDto(
          await tx.storyStoryboardSequence.findUniqueOrThrow({
            where: { id: clip.sequenceId },
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
        const [clip, assetSpec] = [
          await tx.storyStoryboardClip.findFirst({
            where: {
              id: clipId,
              sequenceId,
              storyProjectId: projectId,
              storyChapterId: chapterId,
            },
          }),
          await tx.storyAssetSpec.findFirst({
            where: {
              id: assetSpecId,
              storyProjectId: projectId,
              storyChapterId: chapterId,
            },
          }),
        ];
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
    const [chapter, draftRow] = [
      await tx.storyChapter.findFirst({
        where: {
          id: rawInput.storyChapterId,
          storyProjectId: rawInput.storyProjectId,
        },
      }),
      await tx.storyDraft.findUnique({
        where: { storyProjectId: rawInput.storyProjectId },
      }),
    ];
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
      now,
      result,
    );
    await this.reconcileStoryboard(
      tx,
      rawInput,
      storyboardPlan,
      assetByKey,
      now,
      result,
    );
    return result;
  }

  /** Apply an approved logical Asset plan without invalidating creator work. */
  async applyApprovedAssetPlanInTransaction(
    tx: Prisma.TransactionClient,
    rawInput: ApplyApprovedAssetPlanInput,
  ): Promise<StoryProductionReconcileResult> {
    const assetPlan = StoryAssetPlanSchema.parse(rawInput.assetPlan);
    assertProductionSourceFingerprint(rawInput.sourceFingerprint);
    const chapter = await tx.storyChapter.findFirst({
      where: {
        id: rawInput.storyChapterId,
        storyProjectId: rawInput.storyProjectId,
      },
    });
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
    await this.reconcileAssetSpecs(tx, rawInput, assetPlan, now, result);
    return result;
  }

  /** Apply a Storyboard proposal against the chapter state visible now. */
  async applyApprovedStoryboardPlanInTransaction(
    tx: Prisma.TransactionClient,
    rawInput: ApplyApprovedStoryboardPlanInput,
  ): Promise<StoryProductionReconcileResult> {
    const storyboardPlan = StoryStoryboardPlanSchema.parse(
      rawInput.storyboardPlan,
    );
    assertProductionSourceFingerprint(rawInput.sourceFingerprint);
    const [chapter, draftRow, currentAssetPlan] = [
      await tx.storyChapter.findFirst({
        where: {
          id: rawInput.storyChapterId,
          storyProjectId: rawInput.storyProjectId,
        },
      }),
      await tx.storyDraft.findUnique({
        where: { storyProjectId: rawInput.storyProjectId },
      }),
      await this.readCurrentAssetPlanInTransaction(
        tx,
        rawInput.storyProjectId,
        rawInput.storyChapterId,
      ),
    ];
    if (!chapter || !draftRow) {
      throw new NotFoundException({
        code: 'STORY_CHAPTER_NOT_FOUND',
        message: 'Story chapter not found.',
      });
    }
    const liveAssetPlan =
      currentAssetPlan ?? StoryAssetPlanSchema.parse({ assetSpecs: [] });
    const normalizedStoryboardPlan = StoryStoryboardPlanSchema.parse({
      storyboardSequences: storyboardPlan.storyboardSequences.map((sequence) =>
        normalizeStoryboardAssetMentions(sequence, liveAssetPlan.assetSpecs),
      ),
    });
    this.validateApprovedStoryboardPlan({
      storyboardPlan: normalizedStoryboardPlan,
      assetPlan: liveAssetPlan,
      draft: draftRow.content,
      chapterNodeIds: jsonStringArray(chapter.nodeIds),
    });

    const result = emptyReconcileResult();
    const now = new Date();
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
      normalizedStoryboardPlan,
      new Map(assetRows.map((asset) => [asset.stableKey, asset])),
      now,
      result,
    );
    return result;
  }

  /** Current chapter assets are the source used for the next Agent turn. */
  async readCurrentAssetPlanInTransaction(
    tx: Prisma.TransactionClient,
    storyProjectId: string,
    storyChapterId: string,
  ): Promise<StoryAssetPlan | null> {
    const [rows, marker] = [
      await tx.storyAssetSpec.findMany({
        where: {
          storyProjectId,
          storyChapterId,
          status: { not: StoryProductionSpecStatus.archived },
        },
        orderBy: [{ stableKey: 'asc' }, { id: 'asc' }],
      }),
      await this.readApprovedAssetPlanMarkerInTransaction(
        tx,
        storyProjectId,
        storyChapterId,
      ),
    ];
    if (marker === null && rows.length === 0) {
      return null;
    }
    if (rows.length === 0) {
      return marker?.plan ?? StoryAssetPlanSchema.parse({ assetSpecs: [] });
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
      if (asset.kind === 'character' && sourceCharacterId === undefined) {
        throw new BadRequestException({
          code: 'STORY_PRODUCTION_CHARACTER_SOURCE_REQUIRED',
          message: `Character Asset Spec ${asset.stableKey} must reference its canonical Script character.`,
        });
      }
      if (
        sourceCharacterId !== undefined &&
        !screenplayCharacters.has(sourceCharacterId)
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
      const nextNodeId =
        node.exit.kind === 'auto' ? storyAutoFallbackNodeId(node.exit) : null;
      const nextNode = nextNodeId
        ? draft.graph.nodes.find((candidate) => candidate.nodeId === nextNodeId)
        : undefined;
      const choiceExit =
        node.exit.kind === 'choice'
          ? node.exit
          : nextNode?.kind === 'decision' && nextNode.exit.kind === 'choice'
            ? nextNode.exit
            : null;
      const validDecisionIds = new Set(
        choiceExit ? [choiceExit.decisionId] : [],
      );
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

  private async reconcileAssetSpecs(
    tx: Prisma.TransactionClient,
    input: StoryProductionApplyContext,
    plan: StoryAssetPlan,
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
      if (current.userModifiedAt) continue;
      if (current.sourceFingerprint === fingerprint) {
        await tx.storyAssetSpec.update({
          where: { id: current.id },
          data: { lastPlannedAt: now },
        });
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
      if (current.userModifiedAt) continue;
      const updated = await tx.storyAssetSpec.update({
        where: { id: current.id },
        data: {
          status: StoryProductionSpecStatus.archived,
          lastPlannedAt: now,
          version: { increment: 1 },
        },
      });
      existingByKey.set(current.stableKey, updated);
      result.assetSpecsUpdated += 1;
    }
    return existingByKey;
  }

  private async reconcileStoryboard(
    tx: Prisma.TransactionClient,
    input: StoryProductionApplyContext,
    plan: StoryStoryboardPlan,
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
      if (current && subtreeWasModified) continue;
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
      } else if (current.sourceFingerprint === fingerprint) {
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
      await tx.storyStoryboardClipAssetBinding.updateMany({
        where: { storyboardClip: { sequenceId: current.id } },
        data: { status: StoryProductionSpecStatus.archived },
      });
      await tx.storyStoryboardCue.updateMany({
        where: { sequenceId: current.id },
        data: { status: StoryProductionSpecStatus.archived },
      });
      await tx.storyStoryboardClip.updateMany({
        where: { sequenceId: current.id },
        data: { status: StoryProductionSpecStatus.archived },
      });
      await tx.storyStoryboardSequence.update({
        where: { id: current.id },
        data: {
          status: StoryProductionSpecStatus.archived,
          lastPlannedAt: now,
          version: { increment: 1 },
        },
      });
      result.sequencesUpdated += 1;
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
    if (existingClips.length > 0)
      await tx.storyStoryboardClip.updateMany({
        where: { sequenceId: sequence.id },
        data: {
          rank: {
            increment: storyboardRankOffset(existingClips, item.clips.length),
          },
        },
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
    let archivedRank = item.clips.length;
    for (const current of existingClips) {
      if (plannedClipKeys.has(current.stableKey)) continue;
      await tx.storyStoryboardClipAssetBinding.updateMany({
        where: { storyboardClipId: current.id },
        data: {
          status: StoryProductionSpecStatus.archived,
          ...(options.clearUserModifications
            ? { userModifiedAt: null, userModifiedByUserId: null }
            : {}),
        },
      });
      await tx.storyStoryboardClip.update({
        where: { id: current.id },
        data: {
          rank: archivedRank++,
          status: StoryProductionSpecStatus.archived,
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
    await tx.storyStoryboardClipAssetBinding.updateMany({
      where: { storyboardClip: { sequenceId } },
      data: {
        status: StoryProductionSpecStatus.archived,
      },
    });
    await tx.storyStoryboardCue.updateMany({
      where: { sequenceId },
      data: {
        status: StoryProductionSpecStatus.archived,
      },
    });
    await tx.storyStoryboardClip.updateMany({
      where: { sequenceId },
      data: {
        status: StoryProductionSpecStatus.archived,
      },
    });
  }

  private async reconcileBindings(
    tx: Prisma.TransactionClient,
    input: StoryProductionApplyContext,
    clipPlan: {
      stableKey: string;
      imagePrompt?: string | null;
      videoPrompt?: string | null;
    },
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
    /**
     * Agent OS tool calls serialize against the Agent mutation fence so they
     * order with story-authoring apply like every other agent write; the
     * default human fence keeps the editor's STORY_AGENT_APPLYING semantics.
     */
    mutationFence?: 'human' | 'agent_os';
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
      if (input.mutationFence === 'agent_os') {
        await this.writeGuard.acquireAgentOsMutationFence(tx, input.projectId);
      } else {
        await this.writeGuard.assertHumanWriteAllowed(tx, input.projectId);
      }
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

function emptyReconcileResult(): StoryProductionReconcileResult {
  return {
    assetSpecsCreated: 0,
    assetSpecsUpdated: 0,
    sequencesCreated: 0,
    sequencesUpdated: 0,
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

type PlanSnapshotValue = {
  sourceFingerprint: string;
  planFingerprint: string;
  productionPlan: Prisma.JsonValue;
};

type StoryProductionSnapshotPlan =
  | StoryProductionPlan
  | StoryAssetPlan
  | StoryStoryboardPlan;

function parsePlanSnapshot(
  snapshot: PlanSnapshotValue,
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
): Promise<StoryCandidateMedia> {
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
): Promise<StoryCandidateMedia> {
  return requireStoryCandidateMedia(
    tx,
    projectId,
    mediaAssetId,
    'image',
    'asset_spec',
  );
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

function toAssetSpecDto(row: AssetSpecRow) {
  const latestPrimary = row.generations.find(
    (generation) => generation.purpose === StoryAssetGenerationPurpose.primary,
  );
  const latestTurnaround = row.generations.find(
    (generation) =>
      generation.purpose === StoryAssetGenerationPurpose.turnaround,
  );
  const generationTarget = {
    projectId: row.storyProjectId,
    chapterId: row.storyChapterId,
    kind: 'asset_spec' as const,
    targetId: row.id,
  };
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
    status: row.status,
    version: row.version,
    selectedMediaVersionId: row.selectedMediaVersionId,
    selectedMediaVersion: row.selectedMediaVersion
      ? toCreativeMediaVersionDto(row.selectedMediaVersion)
      : null,
    mediaVersions: row.mediaVersions.map(toCreativeMediaVersionDto),
    latestGeneration: row.generations[0]
      ? toLatestGenerationDto(row.generations[0], generationTarget)
      : null,
    latestGenerations: {
      primary: latestPrimary
        ? toLatestGenerationDto(latestPrimary, generationTarget)
        : null,
      turnaround: latestTurnaround
        ? toLatestGenerationDto(latestTurnaround, generationTarget)
        : null,
    },
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
    generationId: row.generationId,
    purpose: generationPurpose(row.generationSnapshot),
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
    status: row.status,
    version: row.version,
    userModifiedAt: row.userModifiedAt?.toISOString() ?? null,
    subtitleTracks: StorySubtitleTracksSchema.parse(row.subtitleTracks ?? []),
    subtitleTimeline: storySubtitleTimeline(row),
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
      sourceFingerprint: clip.sourceFingerprint,
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

type LatestGenerationRow = AssetSpecRow['generations'][number];

/**
 * Creative-media selection is presentation state, not a semantic edit to the
 * logical production specification. Keeping this distinction explicit lets a
 * later approved Script/plan reconcile update prompts and topology normally,
 * while preserving genuine creator-authored spec changes as user-owned work.
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
    purpose: generation.purpose,
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

/** Clear both old and planned ranks before writing a compact order. */
function storyboardRankOffset(
  clips: readonly { rank: number }[],
  plannedCount: number,
): number {
  const maximumRank = Math.max(0, ...clips.map((clip) => clip.rank));
  const offset = Math.max(maximumRank, plannedCount - 1) + 1;
  if (maximumRank + offset > 2_147_483_647)
    throw new InternalServerErrorException({
      code: 'STORYBOARD_TIMELINE_RANK_EXHAUSTED',
      message: 'The Storyboard timeline rank space is exhausted.',
    });
  return offset;
}

function generationPurpose(value: Prisma.JsonValue): 'primary' | 'turnaround' {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    value.purpose === 'turnaround'
    ? 'turnaround'
    : 'primary';
}
