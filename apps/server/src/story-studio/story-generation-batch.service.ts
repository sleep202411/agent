import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  StoryGenerationBatchItemStatus,
  StoryGenerationBatchStatus,
  StoryProductionGenerationKind,
  StoryProductionGenerationTargetKind,
  StoryProductionSpecStatus,
} from '@prisma/client';
import type { AuthUser } from '../auth';
import { AiGenerationService } from '../ai-generation/ai-generation.service';
import { newUuidV7 } from '../common/id';
import { PrismaService } from '../infra/db/db.module';
import { canonicalJsonHash } from './canonical-json';
import type {
  ConfirmStoryGenerationBatchInput,
  QuoteStoryAssetGenerationBatchInput,
  QuoteStoryStoryboardGenerationBatchInput,
} from './story-generation-batch.schema';
import {
  requiredMobileImageModelId,
  requiredMobileVideoModelId,
} from './story-mobile-model-defaults.service';
import { StoryPermissionService } from './story-permission.service';
import { StoryProductionGenerationService } from './story-production-generation.service';

const QUOTE_TTL_MS = 15 * 60_000;
const QUOTE_CONCURRENCY = 8;

export interface StoryGenerationBatchAgentHandoffInput {
  sourceAgentRunId: string;
  sourceAgentTurnId: string;
  sourceAgentToolCallId: string;
  sourceConversationId: string;
  startedMessage: string;
  completionMessage: string;
  continuationPlan: Prisma.InputJsonValue;
}

@Injectable()
export class StoryGenerationBatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: StoryPermissionService,
    private readonly generations: StoryProductionGenerationService,
    private readonly aiGeneration: AiGenerationService,
  ) {}

  async quoteAssets(
    user: AuthUser,
    projectId: string,
    chapterId: string,
    idempotencyKey: string,
    input: QuoteStoryAssetGenerationBatchInput,
    execution?: {
      dispatchMode?: 'parallel' | 'sequential';
      experience?: 'mobile_h5';
    },
  ) {
    const { project } = await this.permissions.requireProject(
      user.userId,
      projectId,
      'story.generate',
    );
    const workspaceId = project.workspaceId;
    const billingSubject = await this.aiGeneration.resolveStoryBillingSubject(
      user,
      projectId,
    );
    const normalizedKey = requiredKey(idempotencyKey);
    const dispatchMode = execution?.dispatchMode ?? 'parallel';
    const requestFingerprint = canonicalJsonHash({
      workspaceId,
      billingSubject,
      projectId,
      chapterId,
      input,
      dispatchMode,
      ...(execution?.experience ? { experience: execution.experience } : {}),
    });
    const replay = await this.prisma.storyGenerationBatch.findUnique({
      where: {
        storyChapterId_actorUserId_idempotencyKey: {
          storyChapterId: chapterId,
          actorUserId: user.userId,
          idempotencyKey: normalizedKey,
        },
      },
      include: { items: { orderBy: { ordinal: 'asc' } } },
    });
    if (replay) {
      assertReplay(replay.requestFingerprint, requestFingerprint);
      return batchDto(replay, true, await this.availableBillingPoints(replay));
    }

    const targets = uniqueTargets(input.targets);
    const preferredSelection =
      input.modelId && execution?.experience !== 'mobile_h5'
        ? { modelId: input.modelId, schemaVersion: input.schemaVersion }
        : await this.resolvePersistedSelection(
            user,
            workspaceId,
            projectId,
            input.outputKind,
            execution?.experience,
          );
    const quotes = await mapLimit(targets, QUOTE_CONCURRENCY, (target) =>
      this.generations.quoteAssetGeneration(
        user,
        workspaceId,
        projectId,
        chapterId,
        target.id,
        {
          expectedVersion: target.expectedVersion,
          modelId: preferredSelection?.modelId,
          schemaVersion: preferredSelection?.schemaVersion,
          outputKind: input.outputKind,
          options:
            execution?.experience === 'mobile_h5' &&
            input.outputKind === 'image'
              ? { ...input.options, resolution: '1K' }
              : input.options,
        },
      ),
    );
    const totalPoints = quotes.reduce(
      (total, quote) => total + quote.quotedPoints,
      0,
    );
    const availablePoints = await this.availableBillingPoints(billingSubject);
    const batchId = newUuidV7();
    const quoteExpiresAt = new Date(Date.now() + QUOTE_TTL_MS);
    try {
      const created = await this.prisma.storyGenerationBatch.create({
        data: {
          id: batchId,
          workspaceId,
          storyProjectId: projectId,
          storyChapterId: chapterId,
          actorUserId: user.userId,
          billingSubjectType: billingSubject.type,
          billingSubjectId: billingSubject.id,
          dispatchMode,
          idempotencyKey: normalizedKey,
          requestFingerprint,
          totalPoints,
          itemCount: quotes.length,
          quoteExpiresAt,
          quoteSnapshot: {
            version: 1,
            currency: 'COMPUTE_POINTS',
            availablePoints: availablePoints.toString(),
            quotedAt: new Date().toISOString(),
            expiresAt: quoteExpiresAt.toISOString(),
          },
          items: {
            create: quotes.map((quote, ordinal) => ({
              id: newUuidV7(),
              ordinal,
              targetKind: StoryProductionGenerationTargetKind.asset_spec,
              targetId: quote.targetId,
              sequenceId: null,
              targetVersion: quote.targetVersion,
              outputKind:
                quote.outputKind === 'image'
                  ? StoryProductionGenerationKind.image
                  : StoryProductionGenerationKind.video,
              modelId: quote.modelId,
              schemaVersion: quote.schemaVersion,
              options: quote.options as Prisma.InputJsonValue,
              quotedPoints: quote.quotedPoints,
              pricingVersion: quote.pricingVersion,
            })),
          },
        },
        include: { items: { orderBy: { ordinal: 'asc' } } },
      });
      return batchDto(created, true, availablePoints);
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const winner = await this.prisma.storyGenerationBatch.findUnique({
        where: {
          storyChapterId_actorUserId_idempotencyKey: {
            storyChapterId: chapterId,
            actorUserId: user.userId,
            idempotencyKey: normalizedKey,
          },
        },
        include: { items: { orderBy: { ordinal: 'asc' } } },
      });
      if (!winner) throw error;
      assertReplay(winner.requestFingerprint, requestFingerprint);
      return batchDto(winner, true, await this.availableBillingPoints(winner));
    }
  }

  async quoteStoryboardClips(
    user: AuthUser,
    projectId: string,
    chapterId: string,
    idempotencyKey: string,
    input: QuoteStoryStoryboardGenerationBatchInput,
    execution?: {
      dispatchMode?: 'parallel' | 'sequential';
      experience?: 'mobile_h5';
    },
  ) {
    const { project } = await this.permissions.requireProject(
      user.userId,
      projectId,
      'story.generate',
    );
    const workspaceId = project.workspaceId;
    const billingSubject = await this.aiGeneration.resolveStoryBillingSubject(
      user,
      projectId,
    );
    const normalizedKey = requiredKey(idempotencyKey);
    const dispatchMode = execution?.dispatchMode ?? 'parallel';
    const requestFingerprint = canonicalJsonHash({
      workspaceId,
      billingSubject,
      projectId,
      chapterId,
      targetKind: 'storyboard_clip',
      input,
      dispatchMode,
      ...(execution?.experience ? { experience: execution.experience } : {}),
    });
    const replay = await this.prisma.storyGenerationBatch.findUnique({
      where: {
        storyChapterId_actorUserId_idempotencyKey: {
          storyChapterId: chapterId,
          actorUserId: user.userId,
          idempotencyKey: normalizedKey,
        },
      },
      include: { items: { orderBy: { ordinal: 'asc' } } },
    });
    if (replay) {
      assertReplay(replay.requestFingerprint, requestFingerprint);
      return batchDto(replay, true, await this.availableBillingPoints(replay));
    }

    const targets = uniqueTargets(input.targets);
    const rows = await this.prisma.storyStoryboardClip.findMany({
      where: {
        id: { in: targets.map((target) => target.id) },
        storyProjectId: projectId,
        storyChapterId: chapterId,
        status: { not: StoryProductionSpecStatus.archived },
        sequence: { status: { not: StoryProductionSpecStatus.archived } },
      },
      select: { id: true, sequenceId: true, version: true, kind: true },
    });
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    for (const target of targets) {
      const row = rowsById.get(target.id);
      if (!row || row.sequenceId !== target.sequenceId) {
        throw new NotFoundException({
          code: 'STORYBOARD_CLIP_NOT_FOUND',
          message:
            'An available Storyboard clip was not found in this chapter.',
          clipId: target.id,
        });
      }
      if (row.version !== target.expectedVersion) {
        throw new ConflictException({
          code: 'STORYBOARD_CLIP_VERSION_CONFLICT',
          message: 'A Storyboard clip changed. Refresh before generating.',
          clipId: target.id,
          actualVersion: row.version,
        });
      }
    }
    const [imageSelection, videoSelection] = await Promise.all([
      rows.some((row) => row.kind === 'image')
        ? this.resolvePersistedSelection(
            user,
            workspaceId,
            projectId,
            'image',
            execution?.experience,
          )
        : Promise.resolve(null),
      rows.some((row) => row.kind !== 'image')
        ? this.resolvePersistedSelection(
            user,
            workspaceId,
            projectId,
            'video',
            execution?.experience,
          )
        : Promise.resolve(null),
    ]);
    const quotes = await mapLimit(targets, QUOTE_CONCURRENCY, (target) => {
      const row = rowsById.get(target.id)!;
      const preferredSelection =
        row.kind === 'image' ? imageSelection : videoSelection;
      return this.generations.quoteStoryboardClipGeneration(
        user,
        workspaceId,
        projectId,
        chapterId,
        target.sequenceId,
        target.id,
        {
          expectedVersion: target.expectedVersion,
          modelId: preferredSelection?.modelId,
          schemaVersion: preferredSelection?.schemaVersion,
          options:
            execution?.experience === 'mobile_h5' && row.kind === 'image'
              ? { resolution: '1K' }
              : {},
        },
      );
    });
    const totalPoints = quotes.reduce(
      (total, quote) => total + quote.quotedPoints,
      0,
    );
    const availablePoints = await this.availableBillingPoints(billingSubject);
    const batchId = newUuidV7();
    const quoteExpiresAt = new Date(Date.now() + QUOTE_TTL_MS);
    try {
      const created = await this.prisma.storyGenerationBatch.create({
        data: {
          id: batchId,
          workspaceId,
          storyProjectId: projectId,
          storyChapterId: chapterId,
          actorUserId: user.userId,
          billingSubjectType: billingSubject.type,
          billingSubjectId: billingSubject.id,
          dispatchMode,
          idempotencyKey: normalizedKey,
          requestFingerprint,
          totalPoints,
          itemCount: quotes.length,
          quoteExpiresAt,
          quoteSnapshot: {
            version: 1,
            currency: 'COMPUTE_POINTS',
            availablePoints: availablePoints.toString(),
            quotedAt: new Date().toISOString(),
            expiresAt: quoteExpiresAt.toISOString(),
          },
          items: {
            create: quotes.map((quote, ordinal) => ({
              id: newUuidV7(),
              ordinal,
              targetKind: StoryProductionGenerationTargetKind.storyboard_clip,
              targetId: quote.targetId,
              sequenceId: targets[ordinal].sequenceId,
              targetVersion: quote.targetVersion,
              outputKind:
                quote.outputKind === 'image'
                  ? StoryProductionGenerationKind.image
                  : StoryProductionGenerationKind.video,
              modelId: quote.modelId,
              schemaVersion: quote.schemaVersion,
              options: quote.options as Prisma.InputJsonValue,
              quotedPoints: quote.quotedPoints,
              pricingVersion: quote.pricingVersion,
            })),
          },
        },
        include: { items: { orderBy: { ordinal: 'asc' } } },
      });
      return batchDto(created, true, availablePoints);
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const winner = await this.prisma.storyGenerationBatch.findUnique({
        where: {
          storyChapterId_actorUserId_idempotencyKey: {
            storyChapterId: chapterId,
            actorUserId: user.userId,
            idempotencyKey: normalizedKey,
          },
        },
        include: { items: { orderBy: { ordinal: 'asc' } } },
      });
      if (!winner) throw error;
      assertReplay(winner.requestFingerprint, requestFingerprint);
      return batchDto(winner, true, await this.availableBillingPoints(winner));
    }
  }

  async confirm(
    user: AuthUser,
    projectId: string,
    chapterId: string,
    batchId: string,
    input: ConfirmStoryGenerationBatchInput,
    agentHandoff?: StoryGenerationBatchAgentHandoffInput,
  ) {
    const { project } = await this.permissions.requireProject(
      user.userId,
      projectId,
      'story.generate',
    );
    const workspaceId = project.workspaceId;
    const now = new Date();
    const batch = await this.requireOwnedBatch(
      user.userId,
      workspaceId,
      projectId,
      chapterId,
      batchId,
    );
    if (batch.status !== StoryGenerationBatchStatus.awaiting_confirmation) {
      return batchDto(batch, true, await this.availableBillingPoints(batch));
    }
    if (batch.quoteExpiresAt <= now) {
      const expired = await this.prisma.storyGenerationBatch.updateMany({
        where: {
          id: batch.id,
          status: StoryGenerationBatchStatus.awaiting_confirmation,
          version: batch.version,
        },
        data: {
          status: StoryGenerationBatchStatus.expired,
          completedAt: now,
          version: { increment: 1 },
        },
      });
      if (expired.count === 0) {
        const winner = await this.get(user, projectId, chapterId, batchId);
        if (winner.status !== StoryGenerationBatchStatus.expired) return winner;
      }
      throw new GoneException({
        code: 'STORY_GENERATION_BATCH_QUOTE_EXPIRED',
        message: 'This generation quote expired. Request a fresh quote.',
      });
    }
    if (batch.version !== input.expectedVersion) {
      throw versionConflict(batch.version);
    }
    // This preflight stops an already-unaffordable quote at confirmation. The
    // dispatcher remains the billing authority because another job can spend
    // the same wallet balance after this check and before an item is admitted.
    const availablePoints = await this.availableBillingPoints(batch);
    const requiredAtConfirmation =
      batch.dispatchMode === 'sequential'
        ? BigInt(batch.items[0]?.quotedPoints ?? 0)
        : BigInt(batch.totalPoints);
    if (availablePoints < requiredAtConfirmation && !agentHandoff) {
      throw new ConflictException({
        code: 'INSUFFICIENT_COMPUTE_POINTS',
        msg: 'Not enough compute points. Recharge and try again.',
        requiredAmount: requiredAtConfirmation.toString(),
        availableBalance: availablePoints.toString(),
      });
    }
    const blockedForFunds = availablePoints < requiredAtConfirmation;
    let confirmed: boolean;
    try {
      confirmed = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.storyGenerationBatch.updateMany({
          where: {
            id: batch.id,
            status: StoryGenerationBatchStatus.awaiting_confirmation,
            version: input.expectedVersion,
          },
          data: {
            status: blockedForFunds
              ? StoryGenerationBatchStatus.blocked
              : StoryGenerationBatchStatus.queued,
            confirmedAt: now,
            blockedAt: blockedForFunds ? now : null,
            blockReason: blockedForFunds
              ? {
                  code: 'INSUFFICIENT_COMPUTE_POINTS',
                  message:
                    'Not enough compute points. Recharge and continue from this item.',
                  retryable: true,
                  requiredAmount: requiredAtConfirmation.toString(),
                  availableBalance: availablePoints.toString(),
                }
              : Prisma.DbNull,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) return false;
        if (!blockedForFunds) {
          await tx.storyGenerationBatchItem.updateMany({
            where: {
              batchId: batch.id,
              status: StoryGenerationBatchItemStatus.awaiting_confirmation,
            },
            data: {
              status: StoryGenerationBatchItemStatus.ready,
              nextDispatchAt: now,
            },
          });
        }
        if (agentHandoff) {
          await tx.agentOsExternalHandoffRegistration.create({
            data: {
              externalJobId: batch.id,
              generationBatchId: batch.id,
              sourceAgentRunId: agentHandoff.sourceAgentRunId,
              sourceAgentTurnId: agentHandoff.sourceAgentTurnId,
              sourceAgentToolCallId: agentHandoff.sourceAgentToolCallId,
              sourceConversationId: agentHandoff.sourceConversationId,
              sourceToolId: 'story.generation.confirmBatch',
              decisionContractVersion: 2,
              startedMessage: agentHandoff.startedMessage,
              completionMessage: agentHandoff.completionMessage,
              continuationPlan: agentHandoff.continuationPlan,
            },
          });
        }
        return true;
      });
    } catch (error) {
      if (isUniqueConflict(error)) throw activeBatchConflict();
      throw error;
    }
    if (!confirmed) {
      const winner = await this.get(user, projectId, chapterId, batchId);
      if (
        winner.status === StoryGenerationBatchStatus.blocked ||
        winner.status === StoryGenerationBatchStatus.queued ||
        winner.status === StoryGenerationBatchStatus.running
      ) {
        return winner;
      }
      throw versionConflict(winner.version);
    }
    return this.get(user, projectId, chapterId, batchId);
  }

  async get(
    user: AuthUser,
    projectId: string,
    chapterId: string,
    batchId: string,
  ) {
    const { project } = await this.permissions.requireProject(
      user.userId,
      projectId,
      'story.read',
    );
    const batch = await this.requireOwnedBatch(
      user.userId,
      project.workspaceId,
      projectId,
      chapterId,
      batchId,
    );
    return batchDto(batch, true, await this.availableBillingPoints(batch));
  }

  async list(user: AuthUser, projectId: string, chapterId: string) {
    const { project } = await this.permissions.requireProject(
      user.userId,
      projectId,
      'story.read',
    );
    const visibleActiveStatuses = [
      StoryGenerationBatchStatus.blocked,
      StoryGenerationBatchStatus.queued,
      StoryGenerationBatchStatus.running,
      StoryGenerationBatchStatus.cancelling,
    ];
    const batches = await this.prisma.storyGenerationBatch.findMany({
      where: {
        workspaceId: project.workspaceId,
        storyProjectId: projectId,
        storyChapterId: chapterId,
        OR: [
          { actorUserId: user.userId },
          { status: { in: visibleActiveStatuses } },
        ],
      },
      include: {
        items: {
          orderBy: { ordinal: 'asc' },
          include: { generation: { select: { id: true, aiJobId: true } } },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 20,
    });
    // Recent quotes/history must never displace unfinished work and its controls.
    const unfinished = await this.prisma.storyGenerationBatch.findMany({
      where: {
        workspaceId: project.workspaceId,
        storyProjectId: projectId,
        storyChapterId: chapterId,
        status: { in: visibleActiveStatuses },
      },
      include: {
        items: {
          orderBy: { ordinal: 'asc' },
          include: { generation: { select: { id: true, aiJobId: true } } },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const visible = new Map(unfinished.map((batch) => [batch.id, batch]));
    for (const batch of batches) {
      if (!visible.has(batch.id)) visible.set(batch.id, batch);
    }
    return [...visible.values()].map((batch) =>
      batchDto(batch, batch.actorUserId === user.userId),
    );
  }

  /** Resume the same durable H5 batch from its first unfinished item. */
  async resume(
    user: AuthUser,
    projectId: string,
    chapterId: string,
    batchId: string,
  ) {
    const { project } = await this.permissions.requireProject(
      user.userId,
      projectId,
      'story.generate',
    );
    const batch = await this.requireOwnedBatch(
      user.userId,
      project.workspaceId,
      projectId,
      chapterId,
      batchId,
    );
    if (
      batch.status !== StoryGenerationBatchStatus.blocked &&
      batch.status !== StoryGenerationBatchStatus.failed &&
      batch.status !== StoryGenerationBatchStatus.partial_failed
    ) {
      return batchDto(batch, true, await this.availableBillingPoints(batch));
    }
    const firstUnfinished = batch.items.find(
      (item) => item.status !== StoryGenerationBatchItemStatus.completed,
    );
    if (!firstUnfinished) {
      return batchDto(batch, true, await this.availableBillingPoints(batch));
    }
    const availablePoints = await this.availableBillingPoints(batch);
    if (availablePoints < BigInt(firstUnfinished.quotedPoints)) {
      throw new ConflictException({
        code: 'INSUFFICIENT_COMPUTE_POINTS',
        message:
          'Not enough compute points. Recharge and continue from this item.',
        requiredAmount: firstUnfinished.quotedPoints.toString(),
        availableBalance: availablePoints.toString(),
      });
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const resumed = await tx.storyGenerationBatch.updateMany({
        where: {
          id: batch.id,
          status: {
            in: [
              StoryGenerationBatchStatus.blocked,
              StoryGenerationBatchStatus.failed,
              StoryGenerationBatchStatus.partial_failed,
            ],
          },
          version: batch.version,
          handoffResultDeliveredAt: null,
        },
        data: {
          status: StoryGenerationBatchStatus.queued,
          blockedAt: null,
          blockReason: Prisma.DbNull,
          completedAt: null,
          cancelledAt: null,
          version: { increment: 1 },
        },
      });
      if (resumed.count !== 1) return;
      await tx.storyGenerationBatchItem.updateMany({
        where: {
          batchId: batch.id,
          ordinal: { gte: firstUnfinished.ordinal },
          status: {
            in: [
              StoryGenerationBatchItemStatus.awaiting_confirmation,
              StoryGenerationBatchItemStatus.failed,
              StoryGenerationBatchItemStatus.cancelled,
            ],
          },
        },
        data: {
          status: StoryGenerationBatchItemStatus.ready,
          generationId: null,
          error: Prisma.DbNull,
          submittedAt: null,
          completedAt: null,
          nextDispatchAt: now,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
    });
    return this.get(user, projectId, chapterId, batchId);
  }

  async cancel(
    user: AuthUser,
    projectId: string,
    chapterId: string,
    batchId: string,
  ) {
    const { project } = await this.permissions.requireProject(
      user.userId,
      projectId,
      'story.generate',
    );
    const workspaceId = project.workspaceId;
    const batch = await this.requireOwnedBatch(
      user.userId,
      workspaceId,
      projectId,
      chapterId,
      batchId,
    );
    if (
      terminalBatchStatuses.has(batch.status) &&
      batch.status !== StoryGenerationBatchStatus.failed &&
      batch.status !== StoryGenerationBatchStatus.partial_failed
    ) {
      return batchDto(batch, true, await this.availableBillingPoints(batch));
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.storyGenerationBatch.updateMany({
        where: {
          id: batch.id,
          status: {
            in: [
              StoryGenerationBatchStatus.awaiting_confirmation,
              StoryGenerationBatchStatus.blocked,
              StoryGenerationBatchStatus.queued,
              StoryGenerationBatchStatus.running,
              StoryGenerationBatchStatus.failed,
              StoryGenerationBatchStatus.partial_failed,
            ],
          },
        },
        data: {
          status: StoryGenerationBatchStatus.cancelling,
          cancelledAt: now,
          completedAt: null,
          blockedAt: null,
          blockReason: Prisma.DbNull,
          version: { increment: 1 },
        },
      });
      await tx.storyGenerationBatchItem.updateMany({
        where: {
          batchId: batch.id,
          status: {
            in: [
              StoryGenerationBatchItemStatus.awaiting_confirmation,
              StoryGenerationBatchItemStatus.ready,
              StoryGenerationBatchItemStatus.dispatching,
            ],
          },
        },
        data: {
          status: StoryGenerationBatchItemStatus.cancelled,
          leaseOwner: null,
          leaseExpiresAt: null,
          completedAt: now,
        },
      });
      const submittedCount = await tx.storyGenerationBatchItem.count({
        where: {
          batchId: batch.id,
          status: StoryGenerationBatchItemStatus.submitted,
        },
      });
      if (submittedCount === 0) {
        await tx.storyGenerationBatch.updateMany({
          where: {
            id: batch.id,
            status: StoryGenerationBatchStatus.cancelling,
          },
          data: {
            status: StoryGenerationBatchStatus.cancelled,
            completedAt: now,
            version: { increment: 1 },
          },
        });
      }
    });
    const submitted = await this.prisma.storyGenerationBatchItem.findMany({
      where: { batchId: batch.id, generationId: { not: null } },
      select: {
        generation: { select: { aiJobId: true } },
      },
    });
    await Promise.allSettled(
      submitted.flatMap((item) =>
        item.generation?.aiJobId
          ? [this.aiGeneration.cancelJob(user, item.generation.aiJobId)]
          : [],
      ),
    );
    return this.get(user, projectId, chapterId, batchId);
  }

  async cancelAgentHandoff(user: AuthUser, projectId: string, batchId: string) {
    const identity = await this.prisma.storyGenerationBatch.findUnique({
      where: { id: batchId },
      select: { storyProjectId: true, storyChapterId: true },
    });
    if (!identity || identity.storyProjectId !== projectId) {
      throw new NotFoundException({
        code: 'STORY_GENERATION_BATCH_NOT_FOUND',
        message: 'Story generation batch not found.',
      });
    }
    return this.cancel(user, projectId, identity.storyChapterId, batchId);
  }

  private async requireOwnedBatch(
    actorUserId: string,
    workspaceId: string,
    projectId: string,
    chapterId: string,
    batchId: string,
  ) {
    const batch = await this.prisma.storyGenerationBatch.findFirst({
      where: {
        id: batchId,
        actorUserId,
        workspaceId,
        storyProjectId: projectId,
        storyChapterId: chapterId,
      },
      include: {
        items: {
          orderBy: { ordinal: 'asc' },
          include: { generation: { select: { id: true, aiJobId: true } } },
        },
      },
    });
    if (!batch) {
      throw new NotFoundException({
        code: 'STORY_GENERATION_BATCH_NOT_FOUND',
        message: 'The generation batch was not found.',
      });
    }
    return batch;
  }

  private async resolvePersistedSelection(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    outputKind: 'image' | 'video',
    experience?: 'mobile_h5',
  ): Promise<{ modelId: string; schemaVersion: string } | null> {
    const mobile = experience === 'mobile_h5';
    const preference = mobile
      ? null
      : await this.prisma.agentOsModelPreference.findUnique({
          where: {
            projectId_actorId: { projectId, actorId: user.userId },
          },
          select: { imageModelId: true, videoModelId: true },
        });
    const modelId = mobile
      ? outputKind === 'image'
        ? requiredMobileImageModelId()
        : requiredMobileVideoModelId()
      : outputKind === 'image'
        ? preference?.imageModelId
        : preference?.videoModelId;
    if (!modelId) return null;
    const catalog = await this.aiGeneration.listCatalog(user, workspaceId);
    const model = catalog.models.find(
      (candidate) =>
        candidate.id === modelId &&
        candidate.type === outputKind &&
        candidate.enabled,
    );
    if (mobile && !model) {
      throw new BadRequestException({
        code: 'STORY_GENERATION_DEFAULT_MODEL_UNAVAILABLE',
        message: `The configured mobile ${outputKind} model ${modelId} is unavailable.`,
      });
    }
    return model
      ? { modelId: model.id, schemaVersion: model.schemaVersion }
      : null;
  }

  private async availableBillingPoints(subject: {
    billingSubjectType?: 'user' | 'workspace';
    billingSubjectId?: string;
    type?: 'user' | 'workspace';
    id?: string;
  }): Promise<bigint> {
    const ownerType = subject.billingSubjectType ?? subject.type;
    const ownerId = subject.billingSubjectId ?? subject.id;
    if (!ownerType || !ownerId) return 0n;
    const balance = await this.aiGeneration.getBillingSubjectComputeBalance({
      type: ownerType,
      id: ownerId,
    });
    return balance.available;
  }
}

const terminalBatchStatuses = new Set<StoryGenerationBatchStatus>([
  StoryGenerationBatchStatus.completed,
  StoryGenerationBatchStatus.partial_failed,
  StoryGenerationBatchStatus.cancelled,
  StoryGenerationBatchStatus.failed,
  StoryGenerationBatchStatus.expired,
]);

function batchDto(
  batch: {
    id: string;
    workspaceId: string;
    storyProjectId: string;
    storyChapterId: string;
    status: StoryGenerationBatchStatus;
    dispatchMode: string;
    totalPoints: number;
    itemCount: number;
    version: number;
    quoteExpiresAt: Date;
    confirmedAt: Date | null;
    completedAt: Date | null;
    blockedAt: Date | null;
    blockReason: Prisma.JsonValue | null;
    items: Array<{
      id: string;
      ordinal: number;
      status: StoryGenerationBatchItemStatus;
      targetKind: StoryProductionGenerationTargetKind;
      targetId: string;
      sequenceId: string | null;
      targetVersion: number;
      outputKind: StoryProductionGenerationKind;
      modelId: string;
      schemaVersion: string;
      quotedPoints: number;
      generationId: string | null;
      error: Prisma.JsonValue | null;
    }>;
  },
  canCancel = true,
  availablePoints: bigint | null = null,
) {
  const counts = Object.fromEntries(
    Object.values(StoryGenerationBatchItemStatus).map((status) => [status, 0]),
  ) as Record<StoryGenerationBatchItemStatus, number>;
  for (const item of batch.items) counts[item.status] += 1;
  return {
    id: batch.id,
    projectId: batch.storyProjectId,
    chapterId: batch.storyChapterId,
    status: batch.status,
    dispatchMode: batch.dispatchMode,
    blockedAt: batch.blockedAt?.toISOString() ?? null,
    blockReason: batch.blockReason,
    totalPoints: batch.totalPoints,
    availablePoints: availablePoints?.toString() ?? null,
    itemCount: batch.itemCount,
    version: batch.version,
    quoteExpiresAt: batch.quoteExpiresAt.toISOString(),
    confirmedAt: batch.confirmedAt?.toISOString() ?? null,
    completedAt: batch.completedAt?.toISOString() ?? null,
    canCancel,
    counts,
    items: batch.items.map((item) => ({
      id: item.id,
      ordinal: item.ordinal,
      status: item.status,
      targetKind: item.targetKind,
      targetId: item.targetId,
      sequenceId: item.sequenceId,
      targetVersion: item.targetVersion,
      outputKind: item.outputKind,
      modelId: item.modelId,
      schemaVersion: item.schemaVersion,
      quotedPoints: item.quotedPoints,
      generationId: item.generationId,
      error: item.error,
    })),
  };
}

function requiredKey(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 180) {
    throw new BadRequestException({
      code: 'INVALID_IDEMPOTENCY_KEY',
      message: 'A valid idempotency key is required.',
    });
  }
  return normalized;
}

function uniqueTargets<T extends { id: string }>(targets: T[]): T[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    if (seen.has(target.id)) return false;
    seen.add(target.id);
    return true;
  });
}

function assertReplay(existing: string, requested: string): void {
  if (existing === requested) return;
  throw new ConflictException({
    code: 'IDEMPOTENCY_KEY_REUSED',
    message:
      'This idempotency key was already used for a different batch quote.',
  });
}

function versionConflict(actualVersion: number): ConflictException {
  return new ConflictException({
    code: 'STORY_GENERATION_BATCH_VERSION_CONFLICT',
    message: 'The generation batch changed. Refresh before continuing.',
    actualVersion,
  });
}

function activeBatchConflict(): ConflictException {
  return new ConflictException({
    code: 'STORY_GENERATION_BATCH_ALREADY_ACTIVE',
    message:
      'This chapter already has an active generation batch. Wait for it to finish or cancel it before starting another.',
  });
}

function isUniqueConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

async function mapLimit<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (true) {
        const index = cursor++;
        if (index >= values.length) return;
        output[index] = await mapper(values[index], index);
      }
    },
  );
  await Promise.all(workers);
  return output;
}
