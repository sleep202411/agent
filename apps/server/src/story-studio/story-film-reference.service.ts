import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  MediaAssetKind,
  MediaAssetModerationStatus,
  MediaAssetStatus,
  Prisma,
  StoryFilmReferenceSource,
  StoryFilmReferenceVersionStatus,
  StoryReviewDecision,
} from '@prisma/client';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { resolveMediaPublicUrl } from '../infra/storage/media-asset-url-resolver.service';
import { canonicalJsonHash } from './canonical-json';
import {
  FilmClipSpecSchema,
  ValidateFilmClipReferencePlanSchema,
  type ApproveFilmReferenceVersionInput,
  type CreateFilmReferenceReviewInput,
  type CreateFilmReferenceSlotsBatchInput,
  type CreateFilmReferenceVersionInput,
  type FilmClipReferencesDto,
  type FilmReferenceSlotDto,
  type FilmReviewDto,
  type MediaAssetSummaryDto,
  type PutFilmClipReferencesInput,
  type PutFilmReferenceSlotInput,
} from './dto';
import { StoryPermissionService } from './story-permission.service';

const REFERENCE_SLOT_INCLUDE =
  Prisma.validator<Prisma.StoryFilmReferenceSlotInclude>()({
    versions: {
      orderBy: [{ versionNumber: 'desc' }, { id: 'desc' }],
      include: {
        asset: {
          include: {
            placements: true,
            variants: { include: { placements: true } },
          },
        },
        approval: true,
      },
    },
  });

const CLIP_REFERENCE_INCLUDE =
  Prisma.validator<Prisma.StoryFilmClipReferenceInclude>()({
    referenceSlot: { select: { approvedVersionId: true } },
  });

type ReferenceSlotRow = Prisma.StoryFilmReferenceSlotGetPayload<{
  include: typeof REFERENCE_SLOT_INCLUDE;
}>;
type ClipReferenceRow = Prisma.StoryFilmClipReferenceGetPayload<{
  include: typeof CLIP_REFERENCE_INCLUDE;
}>;
type ReferenceVersionRow = ReferenceSlotRow['versions'][number];

@Injectable()
export class StoryFilmReferenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: StoryPermissionService,
  ) {}

  async listSlots(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    revisionId: string,
  ): Promise<FilmReferenceSlotDto[]> {
    await this.requireScope(user, workspaceId, projectId, 'story.read');
    await this.requireFilmSpec(this.prisma, projectId, revisionId);
    const rows = await this.prisma.storyFilmReferenceSlot.findMany({
      where: { storyProjectId: projectId, revisionId, archivedAt: null },
      orderBy: [{ rank: 'asc' }, { id: 'asc' }],
      include: REFERENCE_SLOT_INCLUDE,
    });
    return rows.map(toReferenceSlotDto);
  }

  async createSlots(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    revisionId: string,
    input: CreateFilmReferenceSlotsBatchInput,
  ): Promise<FilmReferenceSlotDto[]> {
    await this.requireScope(user, workspaceId, projectId, 'story.edit');
    const rows = await this.prisma.$transaction(
      async (tx) => {
        await lockProductionRevision(tx, projectId, revisionId);
        const existing = await tx.storyFilmReferenceSlot.findMany({
          where: {
            storyProjectId: projectId,
            revisionId,
            key: { in: input.slots.map((slot) => slot.key) },
          },
          include: REFERENCE_SLOT_INCLUDE,
        });
        if (existing.length > 0) {
          const existingByKey = new Map(existing.map((row) => [row.key, row]));
          const exact = input.slots.every((slot) => {
            const row = existingByKey.get(slot.key);
            return row && sameSlotSpec(row, slot) && row.archivedAt === null;
          });
          if (exact && existing.length === input.slots.length) {
            return existing.sort(slotOrder);
          }
          throw new ConflictException({
            code: 'STORY_FILM_REFERENCE_KEY_CONFLICT',
            message: 'A reference slot key already exists with other content.',
          });
        }
        await requireExpectedProductionRevision(
          tx,
          projectId,
          revisionId,
          input.expectedProductionRevision,
        );
        await tx.storyFilmReferenceSlot.createMany({
          data: input.slots.map((slot) => ({
            storyProjectId: projectId,
            revisionId,
            key: slot.key,
            kind: slot.kind,
            label: slot.label,
            description: slot.description,
            required: slot.required,
            rank: slot.rank,
          })),
        });
        return tx.storyFilmReferenceSlot.findMany({
          where: {
            storyProjectId: projectId,
            revisionId,
            key: { in: input.slots.map((slot) => slot.key) },
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
    workspaceId: string,
    projectId: string,
    revisionId: string,
    slotId: string,
    input: PutFilmReferenceSlotInput,
  ): Promise<FilmReferenceSlotDto> {
    await this.requireScope(user, workspaceId, projectId, 'story.edit');
    const row = await this.prisma.$transaction(async (tx) => {
      await lockProductionRevision(tx, projectId, revisionId);
      const current = await tx.storyFilmReferenceSlot.findFirst({
        where: {
          id: slotId,
          storyProjectId: projectId,
          revisionId,
          archivedAt: null,
        },
        include: REFERENCE_SLOT_INCLUDE,
      });
      if (!current) throw referenceSlotNotFound();
      if (sameSlotSpec(current, input.slot)) return current;
      if (current.version !== input.expectedVersion) {
        throw versionConflict(
          'STORY_FILM_REFERENCE_SLOT_VERSION_CONFLICT',
          input.expectedVersion,
          current.version,
        );
      }
      await requireExpectedProductionRevision(
        tx,
        projectId,
        revisionId,
        input.expectedProductionRevision,
      );
      if (current.kind !== input.slot.kind) {
        const bindings = await tx.storyFilmClipReference.findMany({
          where: { referenceSlotId: slotId },
          select: { role: true },
        });
        if (
          bindings.some(
            (binding) => !roleMatchesSlotKind(binding.role, input.slot.kind),
          )
        ) {
          throw new UnprocessableEntityException({
            code: 'STORY_FILM_REFERENCE_SLOT_KIND_IN_USE',
            message:
              'The new slot kind is incompatible with an existing clip binding.',
          });
        }
      }
      return tx.storyFilmReferenceSlot.update({
        where: { id: slotId },
        data: {
          key: input.slot.key,
          kind: input.slot.kind,
          label: input.slot.label,
          description: input.slot.description,
          required: input.slot.required,
          rank: input.slot.rank,
          version: { increment: 1 },
        },
        include: REFERENCE_SLOT_INCLUDE,
      });
    });
    return toReferenceSlotDto(row);
  }

  async listVersions(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    revisionId: string,
    slotId: string,
  ) {
    await this.requireScope(user, workspaceId, projectId, 'story.read');
    const slot = await this.loadSlot(projectId, revisionId, slotId);
    return slot.versions.map(toReferenceVersionDto);
  }

  async createVersion(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    revisionId: string,
    slotId: string,
    input: CreateFilmReferenceVersionInput,
    idempotencyKey: string,
  ) {
    const scope = await this.requireScope(
      user,
      workspaceId,
      projectId,
      'story.edit',
    );
    const submissionKey = referenceSubmissionKey(
      user.userId,
      projectId,
      slotId,
      idempotencyKey,
    );
    const existing = await this.prisma.storyFilmReferenceVersion.findUnique({
      where: { submissionKey },
      include: {
        asset: {
          include: {
            placements: true,
            variants: { include: { placements: true } },
          },
        },
        approval: true,
      },
    });
    if (existing) {
      assertVersionReplayMatches(existing, input);
      return toReferenceVersionDto(existing);
    }

    const row = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtext(${`story-film-reference-slot:${slotId}`})::bigint
          )
        `;
        const duplicate = await tx.storyFilmReferenceVersion.findUnique({
          where: { submissionKey },
          include: {
            asset: {
              include: {
                placements: true,
                variants: { include: { placements: true } },
              },
            },
            approval: true,
          },
        });
        if (duplicate) {
          assertVersionReplayMatches(duplicate, input);
          return duplicate;
        }
        const slot = await tx.storyFilmReferenceSlot.findFirst({
          where: {
            id: slotId,
            storyProjectId: projectId,
            revisionId,
            archivedAt: null,
          },
        });
        if (!slot) throw referenceSlotNotFound();
        if (slot.version !== input.expectedSlotVersion) {
          throw versionConflict(
            'STORY_FILM_REFERENCE_SLOT_VERSION_CONFLICT',
            input.expectedSlotVersion,
            slot.version,
          );
        }
        const asset = await tx.mediaAsset.findFirst({
          where: {
            id: input.assetId,
            workspaceId: scope.project.workspaceId,
            kind: MediaAssetKind.image,
            status: MediaAssetStatus.ready,
            moderationStatus: { not: MediaAssetModerationStatus.blocked },
            deletedAt: null,
            checksumSha256: { not: null },
          },
          include: {
            placements: true,
            variants: { include: { placements: true } },
          },
        });
        if (!asset?.checksumSha256 || !resolveMediaPublicUrl(asset)) {
          throw new UnprocessableEntityException({
            code: 'STORY_FILM_REFERENCE_ASSET_INVALID',
            message:
              'Reference asset must be a ready image with a checksum in this Workspace.',
          });
        }
        if (input.source === 'ai_job') {
          const output = await tx.aiJobOutput.findFirst({
            where: {
              id: input.aiJobOutputId,
              jobId: input.aiJobId,
              assetId: asset.id,
              job: {
                workspaceId: scope.project.workspaceId,
                projectId: null,
                deletedAt: null,
              },
            },
            select: { id: true },
          });
          if (!output) {
            throw new UnprocessableEntityException({
              code: 'STORY_FILM_REFERENCE_AI_OUTPUT_INVALID',
              message:
                'The AI output does not own the selected reference asset.',
            });
          }
        }
        const latest = await tx.storyFilmReferenceVersion.aggregate({
          where: { referenceSlotId: slotId },
          _max: { versionNumber: true },
        });
        const created = await tx.storyFilmReferenceVersion.create({
          data: {
            storyProjectId: projectId,
            revisionId,
            referenceSlotId: slotId,
            versionNumber: (latest._max.versionNumber ?? 0) + 1,
            submissionKey,
            source: input.source as StoryFilmReferenceSource,
            status: StoryFilmReferenceVersionStatus.ready,
            assetId: asset.id,
            checksumSha256: asset.checksumSha256,
            promptSnapshot: input.promptSnapshot as
              | Prisma.InputJsonObject
              | undefined,
            generationConfig: input.configSnapshot as
              | Prisma.InputJsonObject
              | undefined,
            ...(input.source === 'ai_job'
              ? {
                  aiJobId: input.aiJobId,
                  aiJobOutputId: input.aiJobOutputId,
                }
              : {}),
            createdByUserId: user.userId,
            readyAt: new Date(),
          },
          include: {
            asset: {
              include: {
                placements: true,
                variants: { include: { placements: true } },
              },
            },
            approval: true,
          },
        });
        await tx.storyFilmReferenceSlot.update({
          where: { id: slotId },
          data: { version: { increment: 1 } },
        });
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return toReferenceVersionDto(row);
  }

  async reviewVersion(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    revisionId: string,
    slotId: string,
    referenceVersionId: string,
    input: CreateFilmReferenceReviewInput,
  ): Promise<{
    reference: ReturnType<typeof toReferenceVersionDto>;
    review: FilmReviewDto;
  }> {
    await this.requireScope(user, workspaceId, projectId, 'story.review');
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtext(${`story-film-reference-review:${referenceVersionId}`})::bigint
        )
      `;
      const current = await tx.storyFilmReferenceVersion.findFirst({
        where: {
          id: referenceVersionId,
          referenceSlotId: slotId,
          storyProjectId: projectId,
          revisionId,
          referenceSlot: { archivedAt: null },
        },
        include: {
          asset: {
            include: {
              placements: true,
              variants: { include: { placements: true } },
            },
          },
          approval: true,
        },
      });
      if (!current) throw referenceVersionNotFound();
      if (current.approval) {
        throw new ConflictException({
          code: 'STORY_FILM_REFERENCE_ALREADY_APPROVED',
          message: 'An approved reference cannot receive another review.',
        });
      }
      if (current.reviewRevision !== input.expectedReviewRevision) {
        const replay = await tx.storyFilmReferenceReview.findFirst({
          where: {
            referenceVersionId,
            sequence: input.expectedReviewRevision + 1,
            reviewerUserId: user.userId,
          },
        });
        if (replay && sameReview(replay, input)) {
          return { reference: current, review: replay };
        }
        throw versionConflict(
          'STORY_FILM_REFERENCE_REVIEW_REVISION_CONFLICT',
          input.expectedReviewRevision,
          current.reviewRevision,
        );
      }
      if (current.status !== StoryFilmReferenceVersionStatus.ready) {
        throw new ConflictException({
          code: 'STORY_FILM_REFERENCE_NOT_READY',
          message: 'Only a ready reference may be reviewed.',
        });
      }
      const review = await tx.storyFilmReferenceReview.create({
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
      return { reference: current, review };
    });
    const refreshed = await this.loadVersion(
      projectId,
      revisionId,
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
    workspaceId: string,
    projectId: string,
    revisionId: string,
    slotId: string,
    input: ApproveFilmReferenceVersionInput,
  ): Promise<FilmReferenceSlotDto> {
    await this.requireScope(user, workspaceId, projectId, 'story.review');
    const row = await this.prisma.$transaction(async (tx) => {
      await lockProductionRevision(tx, projectId, revisionId);
      const slot = await tx.storyFilmReferenceSlot.findFirst({
        where: {
          id: slotId,
          storyProjectId: projectId,
          revisionId,
          archivedAt: null,
        },
      });
      if (!slot) throw referenceSlotNotFound();
      if (slot.approvedVersionId === input.referenceVersionId) {
        const approval = await tx.storyFilmReferenceApproval.findFirst({
          where: {
            referenceVersionId: input.referenceVersionId,
            reviewId: input.approveReviewId,
          },
        });
        if (approval) {
          return tx.storyFilmReferenceSlot.findUniqueOrThrow({
            where: { id: slotId },
            include: REFERENCE_SLOT_INCLUDE,
          });
        }
      }
      if (slot.version !== input.expectedSlotVersion) {
        throw versionConflict(
          'STORY_FILM_REFERENCE_SLOT_VERSION_CONFLICT',
          input.expectedSlotVersion,
          slot.version,
        );
      }
      await requireExpectedProductionRevision(
        tx,
        projectId,
        revisionId,
        input.expectedProductionRevision,
      );
      const version = await tx.storyFilmReferenceVersion.findFirst({
        where: {
          id: input.referenceVersionId,
          referenceSlotId: slotId,
          storyProjectId: projectId,
          revisionId,
          status: StoryFilmReferenceVersionStatus.ready,
        },
        include: {
          asset: { select: { moderationStatus: true } },
        },
      });
      if (!version) throw referenceVersionNotFound();
      if (
        version.asset.moderationStatus === MediaAssetModerationStatus.blocked
      ) {
        throw new UnprocessableEntityException({
          code: 'STORY_FILM_REFERENCE_ASSET_MODERATION_BLOCKED',
          message: 'A moderation-blocked reference cannot be approved.',
        });
      }
      const review = await tx.storyFilmReferenceReview.findFirst({
        where: {
          id: input.approveReviewId,
          referenceVersionId: version.id,
          sequence: version.reviewRevision,
          decision: StoryReviewDecision.approve,
          technicalPassed: true,
          safetyPassed: true,
          reviewerUserId: user.userId,
        },
      });
      if (!review) {
        throw new UnprocessableEntityException({
          code: 'STORY_FILM_REFERENCE_APPROVAL_REVIEW_INVALID',
          message: 'Approval requires the latest passing approve review.',
        });
      }
      const existingApproval = await tx.storyFilmReferenceApproval.findUnique({
        where: { referenceVersionId: version.id },
      });
      if (
        existingApproval &&
        (existingApproval.reviewId !== review.id ||
          existingApproval.approvedByUserId !== user.userId)
      ) {
        throw new ConflictException({
          code: 'STORY_FILM_REFERENCE_ALREADY_APPROVED',
          message: 'This reference was already approved using another review.',
        });
      }
      if (!existingApproval) {
        await tx.storyFilmReferenceApproval.create({
          data: {
            referenceVersionId: version.id,
            reviewId: review.id,
            approvedByUserId: user.userId,
          },
        });
      }
      return tx.storyFilmReferenceSlot.update({
        where: { id: slotId },
        data: {
          approvedVersionId: version.id,
          version: { increment: 1 },
        },
        include: REFERENCE_SLOT_INCLUDE,
      });
    });
    return toReferenceSlotDto(row);
  }

  async putClipReferences(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    revisionId: string,
    clipId: string,
    input: PutFilmClipReferencesInput,
  ): Promise<FilmClipReferencesDto> {
    await this.requireScope(user, workspaceId, projectId, 'story.edit');
    return this.prisma.$transaction(async (tx) => {
      await lockProductionRevision(tx, projectId, revisionId);
      const clip = await tx.storyFilmClip.findFirst({
        where: {
          id: clipId,
          storyProjectId: projectId,
          revisionId,
          archivedAt: null,
        },
      });
      if (!clip) {
        throw new NotFoundException({
          code: 'STORY_FILM_CLIP_NOT_FOUND',
          message: 'Story film clip not found.',
        });
      }
      const plan = ValidateFilmClipReferencePlanSchema.safeParse({
        generationControl: FilmClipSpecSchema.parse(clip.specJson)
          .generationControl,
        bindings: input.bindings,
      });
      if (!plan.success) {
        throw new UnprocessableEntityException({
          code: 'STORY_FILM_REFERENCE_PLAN_INVALID',
          message: 'Reference bindings do not match the clip generation mode.',
          issues: plan.error.issues,
        });
      }
      assertUniqueBindings(input.bindings);
      const slotIds = [
        ...new Set(input.bindings.map((row) => row.referenceSlotId)),
      ];
      const slots = await tx.storyFilmReferenceSlot.findMany({
        where: {
          id: { in: slotIds },
          storyProjectId: projectId,
          revisionId,
          archivedAt: null,
        },
        select: { id: true, kind: true },
      });
      if (slots.length !== slotIds.length) {
        throw new UnprocessableEntityException({
          code: 'STORY_FILM_REFERENCE_SLOT_SCOPE_INVALID',
          message: 'Every binding must use an active slot from this Revision.',
        });
      }
      const slotKindById = new Map(slots.map((slot) => [slot.id, slot.kind]));
      if (
        input.bindings.some((binding) => {
          const kind = slotKindById.get(binding.referenceSlotId);
          return !kind || !roleMatchesSlotKind(binding.role, kind);
        })
      ) {
        throw new UnprocessableEntityException({
          code: 'STORY_FILM_REFERENCE_ROLE_KIND_INVALID',
          message:
            'A binding role is incompatible with its reference slot kind.',
        });
      }
      const current = await tx.storyFilmClipReference.findMany({
        where: { clipId },
        include: CLIP_REFERENCE_INCLUDE,
      });
      if (sameBindings(current, input.bindings)) {
        const spec = await requireFilmSpec(tx, projectId, revisionId);
        return toClipReferencesDto(
          clip.id,
          clip.version,
          spec.productionRevision,
          current,
        );
      }
      if (clip.version !== input.expectedClipVersion) {
        throw versionConflict(
          'STORY_FILM_CLIP_VERSION_CONFLICT',
          input.expectedClipVersion,
          clip.version,
        );
      }
      await requireExpectedProductionRevision(
        tx,
        projectId,
        revisionId,
        input.expectedProductionRevision,
      );
      await tx.storyFilmClipReference.deleteMany({ where: { clipId } });
      if (input.bindings.length > 0) {
        await tx.storyFilmClipReference.createMany({
          data: input.bindings.map((binding) => ({
            storyProjectId: projectId,
            revisionId,
            clipId,
            referenceSlotId: binding.referenceSlotId,
            role: binding.role,
            position: binding.rank,
            required: binding.required,
          })),
        });
      }
      let clipVersion = clip.version;
      if (
        clip.productionInputHash !== null ||
        clip.latestGenerationAttemptId !== null
      ) {
        const updated = await tx.storyFilmClip.update({
          where: { id: clipId },
          data: {
            productionInputManifest: Prisma.DbNull,
            productionInputHash: null,
            version: { increment: 1 },
            latestGenerationAttemptId: null,
            updatedByUserId: user.userId,
          },
          select: { version: true },
        });
        clipVersion = updated.version;
      }
      const [bindings, spec] = await Promise.all([
        tx.storyFilmClipReference.findMany({
          where: { clipId },
          orderBy: [{ role: 'asc' }, { position: 'asc' }],
          include: CLIP_REFERENCE_INCLUDE,
        }),
        requireFilmSpec(tx, projectId, revisionId),
      ]);
      return toClipReferencesDto(
        clip.id,
        clipVersion,
        spec.productionRevision,
        bindings,
      );
    });
  }

  private async loadSlot(
    projectId: string,
    revisionId: string,
    slotId: string,
  ) {
    const row = await this.prisma.storyFilmReferenceSlot.findFirst({
      where: {
        id: slotId,
        storyProjectId: projectId,
        revisionId,
        archivedAt: null,
      },
      include: REFERENCE_SLOT_INCLUDE,
    });
    if (!row) throw referenceSlotNotFound();
    return row;
  }

  private async loadVersion(
    projectId: string,
    revisionId: string,
    slotId: string,
    referenceVersionId: string,
  ) {
    const row = await this.prisma.storyFilmReferenceVersion.findFirst({
      where: {
        id: referenceVersionId,
        referenceSlotId: slotId,
        storyProjectId: projectId,
        revisionId,
      },
      include: {
        asset: {
          include: {
            placements: true,
            variants: { include: { placements: true } },
          },
        },
        approval: true,
      },
    });
    if (!row) throw referenceVersionNotFound();
    return row;
  }

  private async requireScope(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    capability: Parameters<StoryPermissionService['requireProject']>[2],
  ) {
    const scope = await this.permissions.requireProject(
      user.userId,
      projectId,
      capability,
    );
    if (scope.project.workspaceId !== workspaceId) {
      throw new NotFoundException({
        code: 'STORY_PROJECT_NOT_FOUND',
        message: 'Story project not found.',
      });
    }
    return scope;
  }

  private async requireFilmSpec(
    client: PrismaService | Prisma.TransactionClient,
    projectId: string,
    revisionId: string,
  ) {
    return requireFilmSpec(client, projectId, revisionId);
  }
}

async function lockProductionRevision(
  tx: Prisma.TransactionClient,
  projectId: string,
  revisionId: string,
) {
  await tx.$executeRaw`
    SELECT 1 FROM "story_film_specs"
    WHERE "story_project_id" = ${projectId}::uuid
      AND "revision_id" = ${revisionId}::uuid
    FOR UPDATE
  `;
  return requireFilmSpec(tx, projectId, revisionId);
}

async function requireFilmSpec(
  client: PrismaService | Prisma.TransactionClient,
  projectId: string,
  revisionId: string,
) {
  const spec = await client.storyFilmSpec.findFirst({
    where: { storyProjectId: projectId, revisionId },
    select: { productionRevision: true },
  });
  if (!spec) {
    throw new ConflictException({
      code: 'STORY_FILM_REVISION_NOT_READY',
      message: 'Prepare a current-draft shot before managing film references.',
    });
  }
  return spec;
}

async function requireExpectedProductionRevision(
  tx: Prisma.TransactionClient,
  projectId: string,
  revisionId: string,
  expected: number,
) {
  const spec = await requireFilmSpec(tx, projectId, revisionId);
  if (spec.productionRevision !== expected) {
    throw versionConflict(
      'STORY_FILM_PRODUCTION_REVISION_CONFLICT',
      expected,
      spec.productionRevision,
    );
  }
  return spec;
}

function referenceSubmissionKey(
  userId: string,
  projectId: string,
  slotId: string,
  idempotencyKey: string,
) {
  return `${userId}:${projectId}:${slotId}:${canonicalJsonHash(idempotencyKey)}`;
}

function toReferenceSlotDto(row: ReferenceSlotRow): FilmReferenceSlotDto {
  return {
    id: row.id,
    projectId: row.storyProjectId,
    revisionId: row.revisionId,
    key: row.key,
    kind: row.kind,
    label: row.label,
    description: row.description ?? '',
    required: row.required,
    rank: row.rank,
    version: row.version,
    status: row.approvedVersionId
      ? 'approved'
      : row.versions.length > 0
        ? 'candidate'
        : 'empty',
    approvedVersionId: row.approvedVersionId,
    versions: row.versions.map(toReferenceVersionDto),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toReferenceVersionDto(row: ReferenceVersionRow) {
  return {
    id: row.id,
    slotId: row.referenceSlotId,
    number: row.versionNumber,
    source: row.source,
    aiJobId: row.aiJobId,
    aiJobOutputId: row.aiJobOutputId,
    sourceGenerationId: row.sourceGenerationAttemptId,
    sourceFrameIndex: row.sourceFrameIndex,
    sourceOutputChecksumSha256: row.sourceOutputChecksumSha256,
    asset: toMediaAsset(row.asset),
    promptSnapshot: jsonRecordOrNull(row.promptSnapshot),
    configSnapshot: jsonRecordOrNull(row.generationConfig),
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
}): FilmReviewDto {
  return {
    id: row.id,
    decision: row.decision,
    checklist: jsonRecord(row.checklist) as Record<
      string,
      'pass' | 'fail' | 'na'
    >,
    comment: row.notes,
    reviewerUserId: row.reviewerUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

function toClipReferencesDto(
  clipId: string,
  clipVersion: number,
  productionRevision: number,
  rows: ClipReferenceRow[],
): FilmClipReferencesDto {
  return {
    clipId,
    clipVersion,
    productionRevision,
    bindings: rows.map((row) => ({
      id: row.id,
      referenceSlotId: row.referenceSlotId,
      role: row.role,
      rank: row.position,
      required: row.required,
      approvedReferenceVersionId: row.referenceSlot.approvedVersionId,
    })),
  };
}

function sameSlotSpec(
  row: Pick<
    ReferenceSlotRow,
    'key' | 'kind' | 'label' | 'description' | 'required' | 'rank'
  >,
  spec: CreateFilmReferenceSlotsBatchInput['slots'][number],
) {
  return (
    row.key === spec.key &&
    row.kind === spec.kind &&
    row.label === spec.label &&
    (row.description ?? '') === spec.description &&
    row.required === spec.required &&
    row.rank === spec.rank
  );
}

function sameBindings(
  rows: ClipReferenceRow[],
  bindings: PutFilmClipReferencesInput['bindings'],
) {
  const left = rows
    .map((row) => ({
      referenceSlotId: row.referenceSlotId,
      role: row.role,
      rank: row.position,
      required: row.required,
    }))
    .sort(bindingOrder);
  const right = [...bindings].sort(bindingOrder);
  return canonicalJsonHash(left) === canonicalJsonHash(right);
}

function assertUniqueBindings(
  bindings: PutFilmClipReferencesInput['bindings'],
) {
  const positions = new Set<string>();
  const slots = new Set<string>();
  for (const binding of bindings) {
    const position = `${binding.role}:${binding.rank}`;
    const slot = `${binding.referenceSlotId}:${binding.role}`;
    if (positions.has(position) || slots.has(slot)) {
      throw new UnprocessableEntityException({
        code: 'STORY_FILM_REFERENCE_BINDING_DUPLICATE',
        message:
          'Reference binding role/position and slot/role must be unique.',
      });
    }
    positions.add(position);
    slots.add(slot);
  }
}

function sameReview(
  row: {
    decision: StoryReviewDecision;
    checklist: Prisma.JsonValue;
    notes: string | null;
  },
  input: CreateFilmReferenceReviewInput,
) {
  return (
    row.decision === input.decision &&
    canonicalJsonHash(row.checklist) === canonicalJsonHash(input.checklist) &&
    row.notes === (input.comment ?? null)
  );
}

function assertVersionReplayMatches(
  row: Pick<
    ReferenceVersionRow,
    | 'source'
    | 'assetId'
    | 'aiJobId'
    | 'aiJobOutputId'
    | 'promptSnapshot'
    | 'generationConfig'
  >,
  input: CreateFilmReferenceVersionInput,
) {
  const expected = {
    source: input.source,
    assetId: input.assetId,
    aiJobId: input.source === 'ai_job' ? input.aiJobId : null,
    aiJobOutputId: input.source === 'ai_job' ? input.aiJobOutputId : null,
    promptSnapshot: input.promptSnapshot ?? null,
    generationConfig: input.configSnapshot ?? null,
  };
  const actual = {
    source: row.source,
    assetId: row.assetId,
    aiJobId: row.aiJobId,
    aiJobOutputId: row.aiJobOutputId,
    promptSnapshot: row.promptSnapshot,
    generationConfig: row.generationConfig,
  };
  if (canonicalJsonHash(actual) !== canonicalJsonHash(expected)) {
    throw new ConflictException({
      code: 'STORY_FILM_REFERENCE_IDEMPOTENCY_CONFLICT',
      message: 'Idempotency-Key was already used with another reference input.',
    });
  }
}

export function roleMatchesSlotKind(
  role: ClipReferenceRow['role'],
  kind: ReferenceSlotRow['kind'],
) {
  if (role === 'omni') {
    return ['character', 'location', 'prop', 'graphic', 'style'].includes(kind);
  }
  if (role === 'first_frame' || role === 'last_frame') {
    return ['first_frame', 'last_frame', 'join_frame'].includes(kind);
  }
  if (role === 'continuity') {
    return ['character', 'location', 'prop', 'graphic'].includes(kind);
  }
  return role === 'style' && kind === 'style';
}

function bindingOrder(
  a: { role: string; rank: number },
  b: { role: string; rank: number },
) {
  return a.role.localeCompare(b.role) || a.rank - b.rank;
}

function slotOrder(a: ReferenceSlotRow, b: ReferenceSlotRow) {
  return a.rank - b.rank || a.id.localeCompare(b.id);
}

function jsonRecord(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function jsonRecordOrNull(
  value: Prisma.JsonValue | null,
): Record<string, unknown> | null {
  return value === null ? null : jsonRecord(value);
}

function referenceSlotNotFound() {
  return new NotFoundException({
    code: 'STORY_FILM_REFERENCE_SLOT_NOT_FOUND',
    message: 'Story film reference slot not found.',
  });
}

function referenceVersionNotFound() {
  return new NotFoundException({
    code: 'STORY_FILM_REFERENCE_VERSION_NOT_FOUND',
    message: 'Story film reference version not found.',
  });
}

function versionConflict(code: string, expected: number, actual: number) {
  return new ConflictException({
    code,
    message: 'The Story film production state changed. Refresh and try again.',
    expectedVersion: expected,
    actualVersion: actual,
  });
}
