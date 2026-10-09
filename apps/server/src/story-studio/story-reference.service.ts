import { mediaAssetFileName } from '../media/media-asset-file-name';
import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  MediaAssetKind,
  MediaAssetModerationStatus,
  MediaAssetStatus,
  MediaAssetVariantStatus,
  MediaObjectPlacementStatus,
  Prisma,
  StoryReferenceVersionStatus,
  StoryReviewDecision,
} from '@prisma/client';
import { z } from 'zod';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { lockMediaAssetReference } from '../media/media-asset-lifecycle-lock';
import { resolveMediaPublicUrl } from '../infra/storage/media-asset-url-resolver.service';
import { canonicalJsonHash } from './canonical-json';
import {
  type ApproveStoryReferenceVersionInput,
  type CreateStoryReferenceReviewInput,
  type CreateStoryReferenceSlotsBatchInput,
  type CreateStoryReferenceVersionInput,
  type MediaAssetSummaryDto,
  type PutStoryReferenceSlotInput,
  type StoryReferenceReviewDto,
  type StoryReferenceSlotDto,
  type StoryReferenceSlotSpec,
  type StoryReferenceVersionDto,
} from './dto';
import { StoryPermissionService } from './story-permission.service';
import { StoryProjectWriteGuardService } from './story-project-write-guard.service';

const REFERENCE_ASSET_INCLUDE = Prisma.validator<Prisma.MediaAssetInclude>()({
  placements: true,
  variants: { include: { placements: true } },
});

const REFERENCE_VERSION_INCLUDE =
  Prisma.validator<Prisma.StoryReferenceVersionInclude>()({
    asset: { include: REFERENCE_ASSET_INCLUDE },
    variant: { include: { placements: true } },
    approval: true,
  });

const REFERENCE_SLOT_INCLUDE =
  Prisma.validator<Prisma.StoryReferenceSlotInclude>()({
    versions: {
      orderBy: [{ versionNumber: 'desc' }, { id: 'desc' }],
      include: REFERENCE_VERSION_INCLUDE,
    },
  });

type ReferenceSlotRow = Prisma.StoryReferenceSlotGetPayload<{
  include: typeof REFERENCE_SLOT_INCLUDE;
}>;
type ReferenceVersionRow = Prisma.StoryReferenceVersionGetPayload<{
  include: typeof REFERENCE_VERSION_INCLUDE;
}>;

@Injectable()
export class StoryReferenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: StoryPermissionService,
    private readonly writeGuard: StoryProjectWriteGuardService,
  ) {}

  async listSlots(
    user: AuthUser,
    projectId: string,
  ): Promise<StoryReferenceSlotDto[]> {
    await this.requireProject(user, projectId, 'story.read');
    const rows = await this.prisma.storyReferenceSlot.findMany({
      where: { storyProjectId: projectId, archivedAt: null },
      orderBy: [{ rank: 'asc' }, { id: 'asc' }],
      include: REFERENCE_SLOT_INCLUDE,
    });
    return rows.map(toReferenceSlotDto);
  }

  async createSlots(
    user: AuthUser,
    projectId: string,
    input: CreateStoryReferenceSlotsBatchInput,
  ): Promise<StoryReferenceSlotDto[]> {
    await this.requireProject(user, projectId, 'story.edit');
    const rows = await this.prisma.$transaction(
      async (tx) => {
        await this.writeGuard.assertHumanWriteAllowed(tx, projectId);
        await lockReferenceProject(tx, projectId);
        const keys = input.slots.map((slot) => slot.key);
        const existing = await tx.storyReferenceSlot.findMany({
          where: { storyProjectId: projectId, key: { in: keys } },
          include: REFERENCE_SLOT_INCLUDE,
        });
        if (existing.length > 0) {
          const existingByKey = new Map(existing.map((row) => [row.key, row]));
          const exactReplay =
            existing.length === input.slots.length &&
            input.slots.every((slot) => {
              const row = existingByKey.get(slot.key);
              return (
                row !== undefined &&
                row.archivedAt === null &&
                sameSlotSpec(row, slot)
              );
            });
          if (exactReplay) return existing.sort(slotOrder);
          throw referenceKeyConflict();
        }

        await tx.storyReferenceSlot.createMany({
          data: input.slots.map((slot) => ({
            storyProjectId: projectId,
            key: slot.key,
            kind: slot.kind,
            label: slot.label,
            description: slot.description,
            required: slot.required,
            rank: slot.rank,
          })),
        });
        return tx.storyReferenceSlot.findMany({
          where: {
            storyProjectId: projectId,
            key: { in: keys },
            archivedAt: null,
          },
          orderBy: [{ rank: 'asc' }, { id: 'asc' }],
          include: REFERENCE_SLOT_INCLUDE,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return rows.map(toReferenceSlotDto);
  }

  async putSlot(
    user: AuthUser,
    projectId: string,
    slotId: string,
    input: PutStoryReferenceSlotInput,
  ): Promise<StoryReferenceSlotDto> {
    await this.requireProject(user, projectId, 'story.edit');
    const row = await this.prisma.$transaction(async (tx) => {
      await this.writeGuard.assertHumanWriteAllowed(tx, projectId);
      await lockReferenceProject(tx, projectId);
      await lockReferenceSlot(tx, slotId);
      const current = await tx.storyReferenceSlot.findFirst({
        where: {
          id: slotId,
          storyProjectId: projectId,
          archivedAt: null,
        },
        include: REFERENCE_SLOT_INCLUDE,
      });
      if (!current) throw referenceSlotNotFound();
      assertSlotVersion(current.version, input.expectedSlotVersion);

      const keyOwner = await tx.storyReferenceSlot.findFirst({
        where: {
          storyProjectId: projectId,
          key: input.slot.key,
          id: { not: slotId },
        },
        select: { id: true },
      });
      if (keyOwner) throw referenceKeyConflict();
      if (sameSlotSpec(current, input.slot)) return current;

      const updated = await tx.storyReferenceSlot.updateMany({
        where: {
          id: slotId,
          storyProjectId: projectId,
          archivedAt: null,
          version: input.expectedSlotVersion,
        },
        data: {
          key: input.slot.key,
          kind: input.slot.kind,
          label: input.slot.label,
          description: input.slot.description,
          required: input.slot.required,
          rank: input.slot.rank,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw slotVersionConflict(input.expectedSlotVersion, current.version);
      }
      return tx.storyReferenceSlot.findUniqueOrThrow({
        where: { id: slotId },
        include: REFERENCE_SLOT_INCLUDE,
      });
    });
    return toReferenceSlotDto(row);
  }

  async listVersions(
    user: AuthUser,
    projectId: string,
    slotId: string,
  ): Promise<StoryReferenceVersionDto[]> {
    await this.requireProject(user, projectId, 'story.read');
    const slot = await this.loadSlot(projectId, slotId);
    return slot.versions.map(toReferenceVersionDto);
  }

  async createVersion(
    user: AuthUser,
    projectId: string,
    slotId: string,
    input: CreateStoryReferenceVersionInput,
    idempotencyKey: string,
  ): Promise<StoryReferenceVersionDto> {
    const scope = await this.requireProject(user, projectId, 'story.edit');
    const submissionKey = referenceSubmissionKey(
      user.userId,
      projectId,
      slotId,
      idempotencyKey,
    );
    const requestFingerprint = referenceRequestFingerprint(input);
    const replay = await this.prisma.storyReferenceVersion.findUnique({
      where: { submissionKey },
      include: REFERENCE_VERSION_INCLUDE,
    });
    if (replay) {
      assertVersionReplayMatches(replay, projectId, slotId, requestFingerprint);
      return toReferenceVersionDto(replay);
    }

    const row = await retryReferenceWrite(() =>
      this.prisma.$transaction(
        async (tx) => {
          await this.writeGuard.assertHumanWriteAllowed(tx, projectId);
          await lockReferenceSlot(tx, slotId);
          const duplicate = await tx.storyReferenceVersion.findUnique({
            where: { submissionKey },
            include: REFERENCE_VERSION_INCLUDE,
          });
          if (duplicate) {
            assertVersionReplayMatches(
              duplicate,
              projectId,
              slotId,
              requestFingerprint,
            );
            return duplicate;
          }

          const slot = await tx.storyReferenceSlot.findFirst({
            where: {
              id: slotId,
              storyProjectId: projectId,
              archivedAt: null,
            },
          });
          if (!slot) throw referenceSlotNotFound();
          assertSlotVersion(slot.version, input.expectedSlotVersion);

          await lockMediaAssetReference(tx, input.assetId);
          const [reference] = await tx.$queryRaw<Array<{ allowed: boolean }>>`
          SELECT story_project_references_media(${projectId}::uuid, ${input.assetId}::uuid) AS allowed
        `;
          const variant = await tx.mediaAssetVariant.findFirst({
            where: {
              id: input.variantId,
              assetId: input.assetId,
              status: MediaAssetVariantStatus.ready,
              deletedAt: null,
              checksumSha256: { not: null },
              placements: {
                some: {
                  status: MediaObjectPlacementStatus.active,
                  deletedAt: null,
                },
              },
              asset: {
                ...(reference?.allowed
                  ? {}
                  : { workspaceId: scope.project.workspaceId }),
                kind: MediaAssetKind.image,
                status: MediaAssetStatus.ready,
                moderationStatus: {
                  not: MediaAssetModerationStatus.blocked,
                },
                deletedAt: null,
              },
            },
            include: { asset: { include: REFERENCE_ASSET_INCLUDE } },
          });
          if (
            !variant?.checksumSha256 ||
            !resolveMediaPublicUrl(variant.asset)
          ) {
            throw referenceAssetInvalid();
          }

          if (input.source === 'ai_job') {
            const output = await tx.aiJobOutput.findFirst({
              where: {
                id: input.aiJobOutputId,
                jobId: input.aiJobId,
                assetId: input.assetId,
                deletedAt: null,
                job: {
                  OR: [
                    { workspaceId: scope.project.workspaceId },
                    { storyProjectId: projectId },
                  ],
                  deletedAt: null,
                },
              },
              select: { id: true },
            });
            if (!output) throw referenceAiOutputInvalid();
          }

          const latest = await tx.storyReferenceVersion.aggregate({
            where: { referenceSlotId: slotId },
            _max: { versionNumber: true },
          });
          const created = await tx.storyReferenceVersion.create({
            data: {
              storyProjectId: projectId,
              referenceSlotId: slotId,
              versionNumber: (latest._max.versionNumber ?? 0) + 1,
              submissionKey,
              requestFingerprint,
              source: input.source,
              status: StoryReferenceVersionStatus.ready,
              assetId: input.assetId,
              variantId: input.variantId,
              sourceRecipeSnapshot: input.sourceRecipeSnapshot as
                | Prisma.InputJsonObject
                | undefined,
              checksumSha256: variant.checksumSha256,
              ...(input.source === 'ai_job'
                ? {
                    aiJobId: input.aiJobId,
                    aiJobOutputId: input.aiJobOutputId,
                  }
                : {}),
              createdByUserId: user.userId,
              readyAt: new Date(),
            },
            include: REFERENCE_VERSION_INCLUDE,
          });
          const claimed = await tx.storyReferenceSlot.updateMany({
            where: {
              id: slotId,
              storyProjectId: projectId,
              archivedAt: null,
              version: input.expectedSlotVersion,
            },
            data: { version: { increment: 1 } },
          });
          if (claimed.count !== 1) {
            throw slotVersionConflict(input.expectedSlotVersion, slot.version);
          }
          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
    return toReferenceVersionDto(row);
  }

  async reviewVersion(
    user: AuthUser,
    projectId: string,
    slotId: string,
    referenceVersionId: string,
    input: CreateStoryReferenceReviewInput,
  ): Promise<{
    reference: StoryReferenceVersionDto;
    review: StoryReferenceReviewDto;
  }> {
    await this.requireProject(user, projectId, 'story.review');
    const result = await this.prisma.$transaction(async (tx) => {
      await this.writeGuard.assertHumanWriteAllowed(tx, projectId);
      await lockReferenceVersion(tx, referenceVersionId);
      const current = await tx.storyReferenceVersion.findFirst({
        where: {
          id: referenceVersionId,
          referenceSlotId: slotId,
          storyProjectId: projectId,
          referenceSlot: { archivedAt: null },
        },
        include: REFERENCE_VERSION_INCLUDE,
      });
      if (!current) throw referenceVersionNotFound();
      if (current.approval) {
        throw new ConflictException({
          code: 'STORY_REFERENCE_ALREADY_APPROVED',
          message: 'An approved reference cannot receive another review.',
        });
      }
      if (current.reviewRevision !== input.expectedReviewRevision) {
        const replay = await tx.storyReferenceReview.findFirst({
          where: {
            referenceVersionId,
            sequence: input.expectedReviewRevision + 1,
            reviewerUserId: user.userId,
          },
        });
        if (replay && sameReview(replay, input)) {
          return { reference: current, review: replay };
        }
        throw reviewRevisionConflict(
          input.expectedReviewRevision,
          current.reviewRevision,
        );
      }
      if (!referenceVersionIsUsable(current)) {
        throw new ConflictException({
          code: 'STORY_REFERENCE_NOT_READY',
          message: 'Only a complete, ready reference may be reviewed.',
        });
      }

      const review = await tx.storyReferenceReview.create({
        data: {
          referenceVersionId,
          sequence: current.reviewRevision + 1,
          decision: input.decision,
          technicalPassed: input.checklist.technical === 'pass',
          safetyPassed: input.checklist.safety === 'pass',
          checklist: input.checklist,
          notes: input.comment,
          reviewerUserId: user.userId,
        },
      });
      const claimed = await tx.storyReferenceVersion.updateMany({
        where: {
          id: referenceVersionId,
          storyProjectId: projectId,
          referenceSlotId: slotId,
          reviewRevision: input.expectedReviewRevision,
        },
        data: { reviewRevision: { increment: 1 } },
      });
      if (claimed.count !== 1) {
        throw reviewRevisionConflict(
          input.expectedReviewRevision,
          current.reviewRevision,
        );
      }
      return { reference: current, review };
    });
    const refreshed = await this.loadVersion(
      projectId,
      slotId,
      referenceVersionId,
    );
    return {
      reference: toReferenceVersionDto(refreshed),
      review: toReviewDto(result.review),
    };
  }

  async approveVersion(
    user: AuthUser,
    projectId: string,
    slotId: string,
    input: ApproveStoryReferenceVersionInput,
  ): Promise<StoryReferenceSlotDto> {
    await this.requireProject(user, projectId, 'story.review');
    const row = await this.prisma.$transaction(async (tx) => {
      await this.writeGuard.assertHumanWriteAllowed(tx, projectId);
      await lockReferenceSlot(tx, slotId);
      await lockReferenceVersion(tx, input.referenceVersionId);
      const slot = await tx.storyReferenceSlot.findFirst({
        where: {
          id: slotId,
          storyProjectId: projectId,
          archivedAt: null,
        },
      });
      if (!slot) throw referenceSlotNotFound();
      assertSlotVersion(slot.version, input.expectedSlotVersion);

      const version = await tx.storyReferenceVersion.findFirst({
        where: {
          id: input.referenceVersionId,
          referenceSlotId: slotId,
          storyProjectId: projectId,
          status: StoryReferenceVersionStatus.ready,
        },
        include: REFERENCE_VERSION_INCLUDE,
      });
      if (!version) throw referenceVersionNotFound();
      if (!referenceVersionIsUsable(version)) {
        throw new UnprocessableEntityException({
          code: 'STORY_REFERENCE_ASSET_INVALIDATED',
          message:
            'The selected asset variant is no longer a ready, checksummed reference.',
        });
      }

      const review = await tx.storyReferenceReview.findFirst({
        where: {
          id: input.approveReviewId,
          referenceVersionId: version.id,
          sequence: version.reviewRevision,
          decision: StoryReviewDecision.approve,
          technicalPassed: true,
          safetyPassed: true,
        },
      });
      if (!review || !reviewAllowsApproval(review.checklist)) {
        throw new UnprocessableEntityException({
          code: 'STORY_REFERENCE_APPROVAL_REVIEW_INVALID',
          message: 'Approval requires the latest complete passing review.',
        });
      }

      const existingApproval = await tx.storyReferenceApproval.findUnique({
        where: { referenceVersionId: version.id },
      });
      if (existingApproval) {
        throw new ConflictException({
          code: 'STORY_REFERENCE_ALREADY_APPROVED',
          message: 'This reference version is already approved.',
        });
      }
      await tx.storyReferenceApproval.create({
        data: {
          referenceVersionId: version.id,
          reviewId: review.id,
          approvedByUserId: user.userId,
        },
      });
      const claimed = await tx.storyReferenceSlot.updateMany({
        where: {
          id: slotId,
          storyProjectId: projectId,
          archivedAt: null,
          version: input.expectedSlotVersion,
        },
        data: {
          approvedVersionId: version.id,
          version: { increment: 1 },
        },
      });
      if (claimed.count !== 1) {
        throw slotVersionConflict(input.expectedSlotVersion, slot.version);
      }
      return tx.storyReferenceSlot.findUniqueOrThrow({
        where: { id: slotId },
        include: REFERENCE_SLOT_INCLUDE,
      });
    });
    return toReferenceSlotDto(row);
  }

  private async loadSlot(projectId: string, slotId: string) {
    const row = await this.prisma.storyReferenceSlot.findFirst({
      where: {
        id: slotId,
        storyProjectId: projectId,
        archivedAt: null,
      },
      include: REFERENCE_SLOT_INCLUDE,
    });
    if (!row) throw referenceSlotNotFound();
    return row;
  }

  private async loadVersion(
    projectId: string,
    slotId: string,
    referenceVersionId: string,
  ) {
    const row = await this.prisma.storyReferenceVersion.findFirst({
      where: {
        id: referenceVersionId,
        referenceSlotId: slotId,
        storyProjectId: projectId,
      },
      include: REFERENCE_VERSION_INCLUDE,
    });
    if (!row) throw referenceVersionNotFound();
    return row;
  }

  private async requireProject(
    user: AuthUser,
    projectId: string,
    capability: Parameters<StoryPermissionService['requireProject']>[2],
  ) {
    return this.permissions.requireProject(user.userId, projectId, capability);
  }
}

async function lockReferenceProject(
  tx: Prisma.TransactionClient,
  projectId: string,
): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext(${`story-reference-project:${projectId}`})::bigint
    )
  `;
}

async function lockReferenceSlot(
  tx: Prisma.TransactionClient,
  slotId: string,
): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext(${`story-reference-slot:${slotId}`})::bigint
    )
  `;
}

async function lockReferenceVersion(
  tx: Prisma.TransactionClient,
  referenceVersionId: string,
): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext(${`story-reference-version:${referenceVersionId}`})::bigint
    )
  `;
}

function referenceSubmissionKey(
  userId: string,
  projectId: string,
  slotId: string,
  idempotencyKey: string,
): string {
  return `${userId}:${projectId}:${slotId}:${canonicalJsonHash(idempotencyKey)}`;
}

function referenceRequestFingerprint(
  input: CreateStoryReferenceVersionInput,
): string {
  return canonicalJsonHash({
    expectedSlotVersion: input.expectedSlotVersion,
    source: input.source,
    assetId: input.assetId,
    variantId: input.variantId,
    sourceRecipeSnapshot: input.sourceRecipeSnapshot ?? null,
    aiJobId: input.source === 'ai_job' ? input.aiJobId : null,
    aiJobOutputId: input.source === 'ai_job' ? input.aiJobOutputId : null,
  });
}

function assertVersionReplayMatches(
  row: Pick<
    ReferenceVersionRow,
    'storyProjectId' | 'referenceSlotId' | 'requestFingerprint'
  >,
  projectId: string,
  slotId: string,
  requestFingerprint: string,
): void {
  if (
    row.storyProjectId !== projectId ||
    row.referenceSlotId !== slotId ||
    row.requestFingerprint !== requestFingerprint
  ) {
    throw new ConflictException({
      code: 'STORY_REFERENCE_IDEMPOTENCY_CONFLICT',
      message: 'Idempotency-Key was already used with another reference input.',
    });
  }
}

function toReferenceSlotDto(row: ReferenceSlotRow): StoryReferenceSlotDto {
  const approved = row.approvedVersionId
    ? row.versions.find((version) => version.id === row.approvedVersionId)
    : null;
  return {
    id: row.id,
    projectId: row.storyProjectId,
    key: row.key,
    kind: row.kind,
    label: row.label,
    description: row.description ?? '',
    required: row.required,
    rank: row.rank,
    version: row.version,
    status: row.approvedVersionId
      ? approved && referenceVersionIsUsable(approved)
        ? 'approved'
        : 'invalidated'
      : row.versions.length > 0
        ? 'candidate'
        : 'empty',
    approvedVersionId: row.approvedVersionId,
    versions: row.versions.map(toReferenceVersionDto),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toReferenceVersionDto(
  row: ReferenceVersionRow,
): StoryReferenceVersionDto {
  return {
    id: row.id,
    slotId: row.referenceSlotId,
    number: row.versionNumber,
    source: row.source,
    aiJobId: row.aiJobId,
    aiJobOutputId: row.aiJobOutputId,
    asset: toMediaAsset(row.asset),
    variantId: row.variantId,
    sourceRecipeSnapshot: jsonRecordOrNull(row.sourceRecipeSnapshot),
    checksumSha256: row.checksumSha256,
    reviewRevision: row.reviewRevision,
    approved: row.approval !== null,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

function toMediaAsset(row: ReferenceVersionRow['asset']): MediaAssetSummaryDto {
  return {
    id: row.id,
    fileName: mediaAssetFileName(row.metadata),
    kind: row.kind,
    status: row.status,
    moderationStatus: row.moderationStatus,
    contentType: row.contentType,
    width: row.width,
    height: row.height,
    durationSeconds: row.durationSeconds,
    checksumSha256: row.checksumSha256,
    previewUrl: resolveMediaPublicUrl(row),
  };
}

function toReviewDto(row: {
  id: string;
  decision: StoryReviewDecision;
  checklist: Prisma.JsonValue;
  notes: string | null;
  reviewerUserId: string;
  createdAt: Date;
}): StoryReferenceReviewDto {
  return {
    id: row.id,
    decision: row.decision,
    checklist: parseReviewChecklist(row.checklist),
    comment: row.notes,
    reviewerUserId: row.reviewerUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

function sameSlotSpec(
  row: Pick<
    ReferenceSlotRow,
    'key' | 'kind' | 'label' | 'description' | 'required' | 'rank'
  >,
  spec: StoryReferenceSlotSpec,
): boolean {
  return (
    row.key === spec.key &&
    row.kind === spec.kind &&
    row.label === spec.label &&
    (row.description ?? '') === spec.description &&
    row.required === spec.required &&
    row.rank === spec.rank
  );
}

function sameReview(
  row: {
    decision: StoryReviewDecision;
    checklist: Prisma.JsonValue;
    notes: string | null;
  },
  input: CreateStoryReferenceReviewInput,
): boolean {
  return (
    row.decision === input.decision &&
    canonicalJsonHash(parseReviewChecklist(row.checklist)) ===
      canonicalJsonHash(input.checklist) &&
    row.notes === (input.comment ?? null)
  );
}

function referenceVersionIsUsable(row: ReferenceVersionRow): boolean {
  return (
    row.status === StoryReferenceVersionStatus.ready &&
    row.asset.status === MediaAssetStatus.ready &&
    row.asset.moderationStatus !== MediaAssetModerationStatus.blocked &&
    row.asset.deletedAt === null &&
    row.variant.assetId === row.assetId &&
    row.variant.status === MediaAssetVariantStatus.ready &&
    row.variant.deletedAt === null &&
    row.variant.checksumSha256 !== null &&
    row.variant.checksumSha256 === row.checksumSha256 &&
    row.variant.placements.some(
      (placement) =>
        placement.status === MediaObjectPlacementStatus.active &&
        placement.deletedAt === null,
    )
  );
}

function reviewAllowsApproval(value: Prisma.JsonValue): boolean {
  const checklist = parseReviewChecklist(value);
  return (
    checklist.technical === 'pass' &&
    checklist.identityContinuity !== 'fail' &&
    checklist.rights === 'pass' &&
    checklist.safety === 'pass'
  );
}

function parseReviewChecklist(
  value: Prisma.JsonValue,
): StoryReferenceReviewDto['checklist'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw corruptReferenceData('review checklist');
  }
  const record = value as Record<string, unknown>;
  const expectedKeys = ['identityContinuity', 'rights', 'safety', 'technical'];
  if (
    Object.keys(record).sort().join(':') !== expectedKeys.join(':') ||
    expectedKeys.some(
      (key) =>
        record[key] !== 'pass' &&
        record[key] !== 'fail' &&
        record[key] !== 'na',
    )
  ) {
    throw corruptReferenceData('review checklist');
  }
  return {
    technical: record.technical as 'pass' | 'fail' | 'na',
    identityContinuity: record.identityContinuity as 'pass' | 'fail' | 'na',
    rights: record.rights as 'pass' | 'fail' | 'na',
    safety: record.safety as 'pass' | 'fail' | 'na',
  };
}

function jsonRecordOrNull(
  value: Prisma.JsonValue | null,
): Record<string, unknown> | null {
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw corruptReferenceData('source recipe snapshot');
  }
  return value as Record<string, unknown>;
}

function assertSlotVersion(actual: number, expected: number): void {
  if (actual !== expected) throw slotVersionConflict(expected, actual);
}

function slotOrder(a: ReferenceSlotRow, b: ReferenceSlotRow): number {
  return a.rank - b.rank || a.id.localeCompare(b.id);
}

function referenceSlotNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'STORY_REFERENCE_SLOT_NOT_FOUND',
    message: 'Story reference slot not found.',
  });
}

function referenceVersionNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'STORY_REFERENCE_VERSION_NOT_FOUND',
    message: 'Story reference version not found.',
  });
}

function referenceKeyConflict(): ConflictException {
  return new ConflictException({
    code: 'STORY_REFERENCE_KEY_CONFLICT',
    message: 'A reference slot key already exists with other content.',
  });
}

function referenceAssetInvalid(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'STORY_REFERENCE_ASSET_INVALID',
    message:
      'Reference asset and variant must be a ready, checksummed image in this Workspace.',
  });
}

function referenceAiOutputInvalid(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'STORY_REFERENCE_AI_OUTPUT_INVALID',
    message: 'The AI output does not own the selected reference asset.',
  });
}

function slotVersionConflict(expected: number, actual: number) {
  return versionConflict(
    'STORY_REFERENCE_SLOT_VERSION_CONFLICT',
    expected,
    actual,
  );
}

function reviewRevisionConflict(expected: number, actual: number) {
  return versionConflict(
    'STORY_REFERENCE_REVIEW_REVISION_CONFLICT',
    expected,
    actual,
  );
}

function versionConflict(code: string, expected: number, actual: number) {
  return new ConflictException({
    code,
    message: 'The Story reference state changed. Refresh and try again.',
    expectedVersion: expected,
    actualVersion: actual,
  });
}

function corruptReferenceData(resource: string): InternalServerErrorException {
  return new InternalServerErrorException({
    code: 'STORY_REFERENCE_DATA_CORRUPT',
    message: `Stored Story reference ${resource} is invalid.`,
  });
}

/** Serializable snapshots can be invalidated while waiting for retirement.
 * Re-run the complete DB-only mutation so availability and replay are fresh.
 */
async function retryReferenceWrite<T>(write: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await write();
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        !(
          error.code === 'P2034' ||
          (error.code === 'P2010' &&
            isReferenceSerializationFailure(error.meta))
        )
      )
        throw error;
      if (attempt < 2) continue;
      throw new ConflictException({
        code: 'STORY_REFERENCE_WRITE_CONFLICT',
        msg: 'The reference changed while saving. Refresh and try again.',
      });
    }
  }
}

function isReferenceSerializationFailure(meta: unknown): boolean {
  const parsed = z
    .object({
      code: z.string().optional(),
      driverAdapterError: z
        .object({
          cause: z.object({
            originalCode: z.string().optional(),
          }),
        })
        .optional(),
    })
    .safeParse(meta);
  return (
    parsed.success &&
    [parsed.data.code, parsed.data.driverAdapterError?.cause.originalCode].some(
      (code) => code === '40001' || code === '40P01',
    )
  );
}
