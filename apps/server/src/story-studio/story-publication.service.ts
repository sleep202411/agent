import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { PlatformAuditLogService } from '../workspaces';
import { canonicalJsonHash } from './canonical-json';
import { StoryBuildService } from './story-build.service';
import { StoryPermissionService } from './story-permission.service';
import {
  SubmitStoryPublicationSchema,
  type StoryProjectPublicationDto,
  type SubmitStoryPublicationInput,
} from './story-publication.dto';
import {
  StoryPublicationJavaService,
  type JavaStoryPublication,
} from './story-publication-java.service';

const TRANSACTION_TIMEOUT_MS = 30_000;
// Leave time for transaction cleanup instead of extending its lock lifetime.
const OPERATION_TIMEOUT_MS = 25_000;
type PublicationOperation = {
  signal: AbortSignal;
  assertActive: () => void;
  beforeWrite: () => Promise<void>;
};

const BUILD_SELECT = {
  id: true,
  storyProjectId: true,
  status: true,
  completedAt: true,
  runtimeSchemaVersion: true,
  runtimeHash: true,
  runtimeJson: true,
} satisfies Prisma.StoryBuildSelect;
type CandidateBuild = Prisma.StoryBuildGetPayload<{
  select: typeof BUILD_SELECT;
}>;

/** Project capabilities authorize management; Java remains the moderation authority. */
@Injectable()
export class StoryPublicationService {
  constructor(
    private readonly permissions: StoryPermissionService,
    private readonly prisma: PrismaService,
    private readonly java: StoryPublicationJavaService,
    private readonly audit: PlatformAuditLogService,
    private readonly builds: StoryBuildService,
  ) {}

  async read(
    user: AuthUser,
    projectId: string,
  ): Promise<StoryProjectPublicationDto | null> {
    await this.permissions.requireProject(user.userId, projectId, 'story.read');
    const publication = await this.java.read(projectId);
    return publication ? publicProjection(publication) : null;
  }

  async submit(
    user: AuthUser,
    projectId: string,
    input: SubmitStoryPublicationInput,
    actorCookie: string,
  ): Promise<StoryProjectPublicationDto> {
    const access = await this.permissions.requireProject(
      user.userId,
      projectId,
      'story.release',
    );
    const parsed = SubmitStoryPublicationSchema.safeParse(input);
    if (!parsed.success || parsed.data.gameId !== projectId) {
      throw new BadRequestException({
        code: 'STORY_PUBLICATION_CANDIDATE_INVALID',
        message: 'Submit the prepared review candidate for this project.',
      });
    }
    const candidate = parsed.data;
    const requestHash = canonicalJsonHash(candidate);
    return this.mutate(
      user,
      projectId,
      access.project.workspaceId,
      'submit',
      requestHash,
      async (tx, operation) => {
        const { builds: frozenBuilds, isGameRelease } = await assertCandidate(
          tx,
          projectId,
          candidate,
          requestHash,
        );
        operation.assertActive();
        // Reuse the delivery layer's current media/variant/moderation checks.
        // A ready historical Build cannot authorize a deleted or blocked asset.
        // Serial candidates use preview chapter Builds; their game receipt
        // is the existing durable anonymous grant, rather than Build kind.
        for (const frozen of frozenBuilds) {
          operation.assertActive();
          const current = await this.builds.getBuild(
            user,
            projectId,
            frozen.id,
          );
          operation.assertActive();
          const diagnostic = current.diagnostics.find(
            (entry) => entry.severity === 'error',
          );
          if (
            current.id !== frozen.id ||
            current.projectId !== projectId ||
            (!isGameRelease && current.kind !== 'production') ||
            current.status !== 'ready' ||
            !current.completedAt ||
            current.runtimeSchemaVersion !== 2 ||
            current.runtimeJson === null ||
            current.runtimeHash !== frozen.runtimeHash ||
            canonicalJsonHash(current.runtimeJson) !== frozen.runtimeHash ||
            current.runtimeJson.gameId !== projectId ||
            current.runtimeJson.buildId !== frozen.id ||
            current.runtimeJson.contentVersion !== frozen.id ||
            diagnostic
          ) {
            throw new UnprocessableEntityException({
              code: 'STORY_PUBLICATION_MEDIA_UNAVAILABLE',
              message:
                diagnostic?.message ??
                'The prepared Build or its exact media is no longer available for review. Prepare it again before submitting.',
              buildId: frozen.id,
            });
          }
        }
        const before = await this.java.read(projectId, operation.signal);
        operation.assertActive();
        // Reconcile a lost successful response without re-uploading a reviewing
        // version (Java forbids uploads while reviewing).
        if (
          before?.status === 'reviewing' &&
          before.draftVersion === candidate.contentVersion
        ) {
          return before;
        }
        if (before && !['draft', 'offline'].includes(before.status)) {
          throw stateConflict(
            'Withdraw or take this work offline before submitting another version.',
          );
        }
        await this.permissions.requireProject(
          user.userId,
          projectId,
          'story.release',
        );
        await operation.beforeWrite();
        await this.java.upload(candidate, actorCookie, operation.signal);
        operation.assertActive();
        const uploaded = await this.java.read(projectId, operation.signal);
        operation.assertActive();
        if (!uploaded || uploaded.draftVersion !== candidate.contentVersion) {
          throw stateConflict(
            'The prepared version is no longer the Java review candidate. Refresh before submitting again.',
          );
        }
        if (!['draft', 'offline'].includes(uploaded.status)) {
          throw stateConflict(
            'The publication status changed during submission. Refresh the status before retrying.',
          );
        }
        await this.permissions.requireProject(
          user.userId,
          projectId,
          'story.release',
        );
        await operation.beforeWrite();
        const result = await this.java.transition(
          projectId,
          'submit',
          operation.signal,
        );
        operation.assertActive();
        if (
          result.status !== 'reviewing' ||
          result.draftVersion !== candidate.contentVersion
        ) {
          throw invalidTransition();
        }
        return result;
      },
    );
  }

  async offline(
    user: AuthUser,
    projectId: string,
  ): Promise<StoryProjectPublicationDto> {
    const access = await this.permissions.requireProject(
      user.userId,
      projectId,
      'story.release',
    );
    return this.mutate(
      user,
      projectId,
      access.project.workspaceId,
      'offline',
      null,
      async (_tx, operation) => {
        const before = await this.java.read(projectId, operation.signal);
        operation.assertActive();
        if (!before) {
          throw new NotFoundException({
            code: 'STORY_PUBLICATION_NOT_FOUND',
            message: 'This project has no publication to take offline.',
          });
        }
        if (before.status === 'offline') return before;
        if (!['reviewing', 'published'].includes(before.status)) {
          throw stateConflict(
            'Only a reviewing or published work can be taken offline.',
          );
        }
        await this.permissions.requireProject(
          user.userId,
          projectId,
          'story.release',
        );
        await operation.beforeWrite();
        const result = await this.java.transition(
          projectId,
          'offline',
          operation.signal,
        );
        operation.assertActive();
        if (result.status !== 'offline') throw invalidTransition();
        return result;
      },
    );
  }

  private async mutate(
    user: AuthUser,
    projectId: string,
    workspaceId: string,
    action: 'submit' | 'offline',
    requestHash: string | null,
    command: (
      tx: Prisma.TransactionClient,
      operation: PublicationOperation,
    ) => Promise<JavaStoryPublication>,
  ): Promise<StoryProjectPublicationDto> {
    const operationId = randomUUID();
    const audit = {
      workspaceId,
      actorUserId: user.userId,
      entityType: 'story_project_publication',
      entityId: projectId,
      requestId: operationId,
      metadata: { storyProjectId: projectId, operationId, requestHash },
    };
    // Persist the actual actor before contacting Java, independently of the
    // lock transaction. A timeout can mean Java already accepted the command.
    await this.audit.record({
      ...audit,
      action: `story_publication.${action}.requested`,
    });
    const controller = new AbortController();
    const deadline = performance.now() + OPERATION_TIMEOUT_MS;
    const assertActive = () => {
      if (controller.signal.aborted || performance.now() >= deadline) {
        controller.abort();
        throw operationStopped();
      }
    };
    const timer = setTimeout(() => controller.abort(), OPERATION_TIMEOUT_MS);
    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          assertActive();
          // Rare, bounded management operations serialize across every Nest pod.
          // No project row lock is held; draft editing remains independent. An
          // advisory lock is released by PostgreSQL even if this process dies.
          const rows = await tx.$queryRaw<{ acquired: boolean }[]>(Prisma.sql`
          SELECT pg_try_advisory_xact_lock(hashtextextended(${projectId}, 73041)) AS acquired
        `);
          if (!rows[0]?.acquired) {
            throw new ConflictException({
              code: 'STORY_PUBLICATION_BUSY',
              message:
                'Another publication action is in progress. Refresh the status and retry.',
            });
          }
          await this.permissions.requireProject(
            user.userId,
            projectId,
            'story.release',
          );
          assertActive();
          const result = await command(tx, {
            signal: controller.signal,
            assertActive,
            beforeWrite: async () => {
              assertActive();
              try {
                // The same live transaction still owns its xact advisory lock.
                // Prisma can expire a transaction while an outside await keeps
                // its callback running; a closed transaction rejects this read.
                await tx.$queryRaw(Prisma.sql`SELECT 1`);
              } catch {
                controller.abort();
                throw operationStopped();
              }
              assertActive();
            },
          });
          assertActive();
          return result;
        },
        { maxWait: 5_000, timeout: TRANSACTION_TIMEOUT_MS },
      );
      const projected = publicProjection(result);
      await this.audit.record({
        ...audit,
        action: `story_publication.${action}.completed`,
        after: projected,
        metadata: {
          ...audit.metadata,
          draftVersion: result.draftVersion ?? null,
        },
      });
      return projected;
    } catch (error: unknown) {
      // Stop a callback still awaiting a non-transactional dependency after
      // Prisma rejected/expired its transaction. It must not issue a later write.
      controller.abort();
      const failure =
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'P2028'
          ? operationStopped()
          : error;
      await this.audit.record({
        ...audit,
        action: `story_publication.${action}.failed`,
        metadata: { ...audit.metadata, ...auditError(failure) },
      });
      throw failure;
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
}

async function assertCandidate(
  tx: Prisma.TransactionClient,
  projectId: string,
  candidate: SubmitStoryPublicationInput,
  requestHash: string,
): Promise<{ builds: CandidateBuild[]; isGameRelease: boolean }> {
  const where = {
    storyProjectId: projectId,
    gameId: projectId,
    contentVersion: candidate.contentVersion,
    status: { not: 'rejected' as const },
  };
  const [single, game] = await Promise.all([
    tx.storyExperienceDraftRelease.findFirst({
      where,
      include: { build: { select: BUILD_SELECT } },
    }),
    tx.storyExperienceGameRelease.findFirst({
      where: { ...where, mediaAuthorizationRevokedAt: null },
      include: { chapters: { include: { build: { select: BUILD_SELECT } } } },
    }),
  ]);
  const receipt = single ?? game;
  const builds = single
    ? [single.build]
    : (game?.chapters.map((chapter) => chapter.build) ?? []);
  if (
    !receipt ||
    (single && game) ||
    receipt.requestHash !== requestHash ||
    !builds.length ||
    builds.some((build) => !isReadyBuild(build, projectId))
  ) {
    throw new ConflictException({
      code: 'STORY_PUBLICATION_CANDIDATE_UNVERIFIED',
      message:
        'The review candidate does not match a ready, frozen project release. Prepare it again before submitting.',
    });
  }
  return { builds, isGameRelease: game !== null };
}

function isReadyBuild(build: CandidateBuild, projectId: string): boolean {
  return (
    build.storyProjectId === projectId &&
    build.status === 'ready' &&
    build.completedAt !== null &&
    build.runtimeSchemaVersion === 2 &&
    build.runtimeJson !== null &&
    build.runtimeHash !== null &&
    canonicalJsonHash(build.runtimeJson) === build.runtimeHash
  );
}

function publicProjection(
  detail: JavaStoryPublication,
): StoryProjectPublicationDto {
  return {
    gameId: detail.gameId,
    status: detail.status,
    rejectReason: detail.rejectReason ?? null,
  };
}

function operationStopped(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: 'STORY_PUBLICATION_OPERATION_STOPPED',
    message:
      'The publication operation stopped because its deadline or project lock expired. Refresh the status before retrying.',
  });
}

function stateConflict(message: string): ConflictException {
  return new ConflictException({
    code: 'STORY_PUBLICATION_STATE_CONFLICT',
    message,
  });
}

function invalidTransition(): BadGatewayException {
  return new BadGatewayException({
    code: 'STORY_PUBLICATION_INVALID_RESPONSE',
    message:
      'Java returned an unexpected publication state. Refresh the status before retrying.',
  });
}

function auditError(error: unknown): Record<string, unknown> {
  const body = error instanceof HttpException ? error.getResponse() : null;
  const detail =
    body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  return {
    code:
      typeof detail.code === 'string' || typeof detail.code === 'number'
        ? detail.code
        : null,
    upstreamCode:
      typeof detail.upstreamCode === 'number' ? detail.upstreamCode : null,
    // Transport errors are represented by safe adapter errors, never raw fetch
    // objects that could carry session headers or the service credential.
    message:
      error instanceof HttpException
        ? error.message
        : 'Publication operation failed.',
  };
}
