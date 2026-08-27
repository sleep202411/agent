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
} from '@prisma/client';
import type { AuthUser } from '../auth';
import { AiGenerationService } from '../ai-generation/ai-generation.service';
import { newUuidV7 } from '../common/id';
import { PrismaService } from '../infra/db/db.module';
import { canonicalJsonHash } from './canonical-json';
import type {
  ConfirmStoryGenerationBatchInput,
  QuoteStoryAssetGenerationBatchInput,
} from './story-generation-batch.schema';
import { StoryPermissionService } from './story-permission.service';
import { StoryProductionGenerationService } from './story-production-generation.service';

const QUOTE_TTL_MS = 15 * 60_000;
const QUOTE_CONCURRENCY = 8;

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
    const requestFingerprint = canonicalJsonHash({
      workspaceId,
      billingSubject,
      projectId,
      chapterId,
      input,
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
    const preferredSelection = input.modelId
      ? { modelId: input.modelId, schemaVersion: input.schemaVersion }
      : await this.resolvePersistedSelection(
          user,
          workspaceId,
          projectId,
          input.outputKind,
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
          options: input.options,
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

  async confirm(
    user: AuthUser,
    projectId: string,
    chapterId: string,
    batchId: string,
    input: ConfirmStoryGenerationBatchInput,
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
      return batchDto(batch);
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
    if (availablePoints < BigInt(batch.totalPoints)) {
      throw new ConflictException({
        code: 'INSUFFICIENT_COMPUTE_POINTS',
        msg: 'Not enough compute points. Recharge and try again.',
        requiredAmount: batch.totalPoints.toString(),
        availableBalance: availablePoints.toString(),
      });
    }
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
            status: StoryGenerationBatchStatus.queued,
            confirmedAt: now,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) return false;
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
        return true;
      });
    } catch (error) {
      if (isUniqueConflict(error)) throw activeBatchConflict();
      throw error;
    }
    if (!confirmed) {
      const winner = await this.get(user, projectId, chapterId, batchId);
      if (
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
    return batchDto(
      await this.requireOwnedBatch(
        user.userId,
        project.workspaceId,
        projectId,
        chapterId,
        batchId,
      ),
    );
  }

  async list(user: AuthUser, projectId: string, chapterId: string) {
    const { project } = await this.permissions.requireProject(
      user.userId,
      projectId,
      'story.read',
    );
    const visibleActiveStatuses = [
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
    return batches.map((batch) =>
      batchDto(batch, batch.actorUserId === user.userId),
    );
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
    if (terminalBatchStatuses.has(batch.status)) return batchDto(batch);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.storyGenerationBatch.updateMany({
        where: {
          id: batch.id,
          status: {
            in: [
              StoryGenerationBatchStatus.awaiting_confirmation,
              StoryGenerationBatchStatus.queued,
              StoryGenerationBatchStatus.running,
            ],
          },
        },
        data: {
          status: StoryGenerationBatchStatus.cancelling,
          cancelledAt: now,
          completedAt: null,
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
  ): Promise<{ modelId: string; schemaVersion: string } | null> {
    const preference = await this.prisma.agentOsModelPreference.findUnique({
      where: {
        projectId_actorId: { projectId, actorId: user.userId },
      },
      select: { imageModelId: true, videoModelId: true },
    });
    const modelId =
      outputKind === 'image'
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
    totalPoints: number;
    itemCount: number;
    version: number;
    quoteExpiresAt: Date;
    confirmedAt: Date | null;
    completedAt: Date | null;
    items: Array<{
      id: string;
      ordinal: number;
      status: StoryGenerationBatchItemStatus;
      targetId: string;
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
      targetId: item.targetId,
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
