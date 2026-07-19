import {
  ConflictException,
  HttpException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  ExperienceRuntimeManifestSchema,
  type ExperienceGameDetailResponse,
  type ExperienceReleaseRequest,
  type ExperienceReleaseResponse,
} from '@repo/shared/experience-runtime';
import type { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { JAVA_REQUEST_TIMEOUT_MS } from '../integrations/java/java-config';
import type {
  PublishStoryBuildInput,
  StoryExperienceCurrentReleaseDto,
} from './dto';
import { canonicalJsonHash } from './canonical-json';
import { createExperienceReleaseRequest } from './experience-release-request';
import { storyExperiencePublicationClock } from './story-experience-publication-clock';
import {
  isStoryExperienceReleaseOutcomeUnknown,
  StoryExperienceReleaseGateway,
} from './story-experience-release.gateway';
import { StoryBuildService } from './story-build.service';
import { StoryPermissionService } from './story-permission.service';
import { StoryProjectWriteGuardService } from './story-project-write-guard.service';

const PUBLICATION_LEASE_TTL_MS = JAVA_REQUEST_TIMEOUT_MS + 20_000;
const CONCURRENT_PUBLICATION_WAIT_MS = JAVA_REQUEST_TIMEOUT_MS + 2_000;
const CONCURRENT_PUBLICATION_POLL_MS = 100;
const AUTHORITY_TRANSACTION_TIMEOUT_MS = 10_000;
const AUTHORITY_OBSERVATION_MAX_ATTEMPTS = 3;
const DRAFT_RELEASE_MAX_RETRY_BACKOFF_MS = 5 * 60_000;

type PublicationStatus = 'pending' | 'confirmed' | 'uncertain' | 'rejected';

interface PublicationSnapshot {
  id: string;
  buildId: string;
  storyProjectId: string;
  gameId: string;
  contentVersion: string;
  status: PublicationStatus;
  requestedSetCurrent: boolean;
  manifestUrl: string | null;
  publishedAt: Date | null;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  lastErrorCode: string | null;
  lastErrorDetail: string | null;
}

interface AuthorityObservationToken {
  rows: ReadonlyArray<{
    id: string;
    rowVersion: string;
  }>;
}

type PublicationClaim =
  | { kind: 'claimed'; row: PublicationSnapshot; leaseOwner: string }
  | { kind: 'confirmed'; row: PublicationSnapshot }
  | { kind: 'rejected'; row: PublicationSnapshot }
  | {
      kind: 'reconcile';
      publicationId: string;
      projectId: string;
      gameId: string;
    }
  | {
      kind: 'busy';
      buildId: string;
      sameBuild: boolean;
      leaseExpiresAt: Date;
    };

interface DraftReleaseSnapshot {
  id: string;
  buildId: string;
  storyProjectId: string;
  gameId: string;
  contentVersion: string;
  requestHash: string;
  status: PublicationStatus;
  manifestUrl: string | null;
  confirmedAt: Date | null;
  rejectedAt: Date | null;
  attemptCount: number;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  nextAttemptAt: Date | null;
  lastErrorCode: string | null;
  lastErrorDetail: string | null;
}

type DraftReleaseClaim =
  | { kind: 'claimed'; row: DraftReleaseSnapshot; leaseOwner: string }
  | { kind: 'confirmed'; row: DraftReleaseSnapshot }
  | { kind: 'rejected'; row: DraftReleaseSnapshot }
  | { kind: 'busy'; row: DraftReleaseSnapshot; retryAfter: Date };

@Injectable()
export class StoryExperienceReleaseService {
  constructor(
    private readonly permissions: StoryPermissionService,
    private readonly builds: StoryBuildService,
    private readonly gateway: StoryExperienceReleaseGateway,
    private readonly prisma: PrismaService,
    private readonly writeGuard: StoryProjectWriteGuardService,
  ) {}

  async publishBuild(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    buildId: string,
    input: PublishStoryBuildInput,
    viewerCookie: string,
  ): Promise<ExperienceReleaseResponse> {
    const access = await this.permissions.requireProject(
      user.userId,
      projectId,
      'story.release',
    );
    if (access.project.workspaceId !== workspaceId) {
      throw scopeMismatch();
    }
    const build = await this.builds.getBuild(
      user,
      workspaceId,
      projectId,
      buildId,
    );
    if (
      build.status !== 'ready' ||
      build.scope.kind !== 'full' ||
      build.runtimeSchemaVersion !== 2 ||
      !build.runtimeJson ||
      !build.runtimeHash ||
      !build.completedAt ||
      build.assets.length === 0 ||
      build.diagnostics.some((diagnostic) => diagnostic.severity === 'error') ||
      !Number.isInteger(build.sourceDraftRevision) ||
      build.sourceDraftRevision < 0 ||
      !/^[a-f0-9]{64}$/.test(build.videoSnapshotHash)
    ) {
      throw new UnprocessableEntityException({
        code: 'STORY_BUILD_NOT_PUBLISHABLE',
        message:
          'Only a completed ready/full Runtime Manifest v2 Build with available frozen assets can be published.',
      });
    }
    const parsedManifest = ExperienceRuntimeManifestSchema.safeParse(
      build.runtimeJson,
    );
    if (!parsedManifest.success) {
      throw new ConflictException({
        code: 'STORY_BUILD_MANIFEST_CORRUPT',
        message:
          'The immutable Build does not contain a valid Runtime Manifest v2.',
      });
    }
    const manifest = parsedManifest.data;
    if (
      manifest.buildId !== build.id ||
      manifest.channel !== 'production' ||
      manifest.gameId !== projectId ||
      manifest.contentVersion !== build.id ||
      canonicalJsonHash(manifest) !== build.runtimeHash
    ) {
      throw new ConflictException({
        code: 'STORY_BUILD_MANIFEST_IDENTITY_MISMATCH',
        message:
          'The frozen Runtime Manifest identity or hash does not match its Build.',
      });
    }
    const title = localizedText(
      manifest.metadata.title,
      manifest.localization.defaultLocale,
    );
    const subtitle = manifest.metadata.summary
      ? localizedText(
          manifest.metadata.summary,
          manifest.localization.defaultLocale,
        )
      : undefined;
    const request = createExperienceReleaseRequest(
      {
        gameId: manifest.gameId,
        contentVersion: manifest.contentVersion,
        title,
        ...(subtitle ? { subtitle } : {}),
        status: input.status,
        setCurrent: input.setCurrent,
      },
      manifest,
    );

    // Drafts do not authorize anonymous media and cannot become player-current.
    // They still establish a durable exact-request receipt under the project
    // write fence before Java is contacted; an uncertain response is resolved
    // only by idempotently replaying that immutable request with a live creator
    // credential. The public authority lifecycle below remains separate.
    if (input.status === 'draft') {
      return this.publishDraftRelease(
        request,
        build.id,
        projectId,
        user.userId,
        viewerCookie,
      );
    }

    let claim = await this.claimPublication({
      buildId: build.id,
      projectId,
      userId: user.userId,
      gameId: manifest.gameId,
      contentVersion: manifest.contentVersion,
      requestedSetCurrent: input.setCurrent,
    });
    if (claim.kind === 'reconcile') {
      await this.prepareExpiredPublicationForReconciliation(
        claim.publicationId,
      );
      await this.reconcileProjectCurrent(claim.projectId, claim.gameId);
      claim = await this.claimPublication({
        buildId: build.id,
        projectId,
        userId: user.userId,
        gameId: manifest.gameId,
        contentVersion: manifest.contentVersion,
        requestedSetCurrent: input.setCurrent,
      });
    }
    if (claim.kind === 'busy' && claim.sameBuild) {
      const settled = await this.waitForConcurrentPublication(build.id);
      if (settled?.status === 'confirmed') return releaseFromRow(settled);
      if (settled?.status === 'rejected') throw storedRejection(settled);
      claim = await this.claimPublication({
        buildId: build.id,
        projectId,
        userId: user.userId,
        gameId: manifest.gameId,
        contentVersion: manifest.contentVersion,
        requestedSetCurrent: input.setCurrent,
      });
    }
    if (claim.kind === 'reconcile') {
      throw new ConflictException({
        code: 'STORY_EXPERIENCE_PUBLICATION_RECONCILIATION_REQUIRED',
        message:
          'A prior publication must be reconciled with Java before this Build can publish.',
      });
    }
    if (claim.kind === 'busy') throw publicationInProgress(claim);
    if (claim.kind === 'confirmed') return releaseFromRow(claim.row);
    if (claim.kind === 'rejected') throw storedRejection(claim.row);

    let release: ExperienceReleaseResponse;
    try {
      release = await this.gateway.publish(request, viewerCookie);
    } catch (error) {
      await this.recordPublishFailure(claim, error);
      throw error;
    }

    // Do not include this in the catch above. If Java acknowledged the release
    // but this local confirmation crashes, the pre-existing authorized row is
    // intentionally left recoverable by public GET reconciliation.
    await this.confirmPublication(claim, release);
    return release;
  }

  async getCurrentRelease(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
  ): Promise<StoryExperienceCurrentReleaseDto> {
    const access = await this.permissions.requireProject(
      user.userId,
      projectId,
      'story.read',
    );
    if (access.project.workspaceId !== workspaceId) throw scopeMismatch();

    const lifecycle = await this.prisma.storyExperiencePublication.findFirst({
      where: {
        storyProjectId: projectId,
        status: { in: ['pending', 'uncertain', 'confirmed'] },
      },
      select: { id: true },
    });
    if (!lifecycle) {
      return {
        projectId,
        gameId: projectId,
        published: false,
        currentVersion: null,
        manifestUrl: null,
        currentBuild: null,
        checkedAt: null,
      };
    }

    // Runtime compilation uses the sovereign Story Project UUID as gameId.
    // Once a lifecycle exists, Java is the current-version authority.
    return this.reconcileProjectCurrent(projectId, projectId);
  }

  /** Public-authority reconciliation used by both the HTTP read and worker. */
  async reconcileProjectCurrent(
    projectId: string,
    gameId: string,
  ): Promise<StoryExperienceCurrentReleaseDto> {
    for (
      let attempt = 0;
      attempt < AUTHORITY_OBSERVATION_MAX_ATTEMPTS;
      attempt += 1
    ) {
      const token = await this.captureAuthorityObservationToken(projectId);

      // Never hold a database transaction, connection, advisory lock, or row
      // lock across the network boundary. The token is validated under lock
      // below, so an out-of-order Java response is discarded rather than
      // overwriting a newer publication or authority observation.
      const authority = await this.gateway.getGame(gameId);
      const applied = await this.applyAuthorityObservation(
        projectId,
        gameId,
        token,
        authority,
      );
      if (applied) return applied;
    }

    throw new ConflictException({
      code: 'STORY_EXPERIENCE_AUTHORITY_OBSERVATION_SUPERSEDED',
      message:
        'The publication changed repeatedly while Java current-version authority was being queried. Retry the read.',
    });
  }

  private captureAuthorityObservationToken(
    projectId: string,
  ): Promise<AuthorityObservationToken> {
    return this.prisma.$transaction(async (tx) => {
      await lockPublicationProject(tx, projectId);
      return {
        // xmin is used only as a short-lived optimistic-concurrency token.
        // Unlike a timestamp it changes for every PostgreSQL tuple update,
        // including an authority barrier update in the same microsecond.
        rows: await tx.$queryRaw<Array<{ id: string; rowVersion: string }>>`
            SELECT
              "id",
              xmin::text AS "rowVersion"
            FROM "story_experience_publications"
            WHERE "story_project_id" = ${projectId}::uuid
            ORDER BY "created_at" ASC, "id" ASC
          `,
      };
    }, authorityTransactionOptions());
  }

  private applyAuthorityObservation(
    projectId: string,
    gameId: string,
    token: AuthorityObservationToken,
    authority: ExperienceGameDetailResponse | null,
  ): Promise<StoryExperienceCurrentReleaseDto | null> {
    return this.prisma.$transaction(async (tx) => {
      await lockPublicationProject(tx, projectId);
      const lockedRows = await tx.$queryRaw<
        Array<{ id: string; rowVersion: string }>
      >`
          SELECT
            "id",
            xmin::text AS "rowVersion"
          FROM "story_experience_publications"
          WHERE "story_project_id" = ${projectId}::uuid
          ORDER BY "created_at" ASC, "id" ASC
          FOR UPDATE
        `;
      if (!sameAuthorityObservationToken(token.rows, lockedRows)) {
        return null;
      }

      const requestedCheckedAt = await storyExperiencePublicationClock(tx);
      if (!authority) {
        const checkedAt = await this.persistAuthorityAbsence(
          tx,
          projectId,
          gameId,
          requestedCheckedAt,
        );
        return {
          projectId,
          gameId,
          published: false,
          currentVersion: null,
          manifestUrl: null,
          currentBuild: null,
          checkedAt: checkedAt.toISOString(),
        };
      }
      const observation = await this.persistAuthorityObservation(
        tx,
        projectId,
        authority,
        requestedCheckedAt,
      );
      return {
        projectId,
        gameId: authority.gameId,
        published: true,
        currentVersion: authority.currentVersion,
        manifestUrl: authority.manifestUrl,
        currentBuild: observation.currentBuild,
        checkedAt: observation.checkedAt.toISOString(),
      };
    }, authorityTransactionOptions());
  }

  private async publishDraftRelease(
    request: ExperienceReleaseRequest,
    buildId: string,
    projectId: string,
    userId: string,
    viewerCookie: string,
  ): Promise<ExperienceReleaseResponse> {
    const requestHash = canonicalJsonHash(request);
    const claim = await this.claimDraftRelease({
      buildId,
      projectId,
      userId,
      gameId: request.gameId,
      contentVersion: request.contentVersion,
      requestHash,
    });
    if (claim.kind === 'confirmed') return draftReleaseFromRow(claim.row);
    if (claim.kind === 'rejected') throw storedDraftRejection(claim.row);
    if (claim.kind === 'busy') throw draftReleaseInProgress(claim);

    let release: ExperienceReleaseResponse;
    try {
      release = await this.gateway.publish(request, viewerCookie);
    } catch (error) {
      await this.recordDraftReleaseFailure(claim, error);
      throw error;
    }

    await this.confirmDraftRelease(claim, release);
    return release;
  }

  private async claimDraftRelease(input: {
    buildId: string;
    projectId: string;
    userId: string;
    gameId: string;
    contentVersion: string;
    requestHash: string;
  }): Promise<DraftReleaseClaim> {
    const leaseOwner = `draft-release:${process.pid}:${randomUUID()}`;
    return this.prisma.$transaction(async (tx) => {
      // This permanent row is the first lock in the transaction. Agent apply
      // and draft delivery therefore have one total acceptance order, while
      // the Java POST remains strictly outside the transaction.
      await this.writeGuard.assertHumanWriteAllowed(tx, input.projectId);
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtext(${`story-experience-draft-release:${input.buildId}`})::bigint
        )
      `;
      const now = await storyExperiencePublicationClock(tx);
      let row = await tx.storyExperienceDraftRelease.findUnique({
        where: { buildId: input.buildId },
      });
      if (row) assertDraftReleaseIdentity(row, input);
      if (row?.status === 'confirmed') {
        return { kind: 'confirmed' as const, row: draftReleaseSnapshot(row) };
      }
      if (row?.status === 'rejected') {
        return { kind: 'rejected' as const, row: draftReleaseSnapshot(row) };
      }
      const retryAfter = laterDate(row?.leaseExpiresAt, row?.nextAttemptAt);
      if (retryAfter && retryAfter.getTime() > now.getTime()) {
        return {
          kind: 'busy' as const,
          row: draftReleaseSnapshot(row!),
          retryAfter,
        };
      }

      const recoveringCrashedAttempt = Boolean(
        row && row.status === 'pending' && row.attemptCount > 0,
      );
      if (!row) {
        row = await tx.storyExperienceDraftRelease.create({
          data: {
            buildId: input.buildId,
            storyProjectId: input.projectId,
            gameId: input.gameId,
            contentVersion: input.contentVersion,
            requestHash: input.requestHash,
            requestedByUserId: input.userId,
            createdAt: now,
            updatedAt: now,
          },
        });
      }

      const leaseExpiresAt = new Date(now.getTime() + PUBLICATION_LEASE_TTL_MS);
      const claimed = await tx.storyExperienceDraftRelease.update({
        where: { buildId: input.buildId },
        data: {
          ...(recoveringCrashedAttempt
            ? {
                status: 'uncertain' as const,
                lastErrorCode: 'STORY_EXPERIENCE_DRAFT_RELEASE_CRASH_RECOVERY',
                lastErrorDetail:
                  'Recovered a draft release whose process stopped before recording the Java outcome; replaying the exact immutable request.',
                lastErrorAt: now,
              }
            : {}),
          attemptCount: { increment: 1 },
          firstAttemptAt: row.firstAttemptAt ?? now,
          lastAttemptAt: now,
          lastAttemptedByUserId: input.userId,
          nextAttemptAt: null,
          leaseOwner,
          leaseAcquiredAt: now,
          leaseExpiresAt,
        },
      });
      return {
        kind: 'claimed' as const,
        row: draftReleaseSnapshot(claimed),
        leaseOwner,
      };
    });
  }

  private async confirmDraftRelease(
    claim: Extract<DraftReleaseClaim, { kind: 'claimed' }>,
    release: ExperienceReleaseResponse,
  ): Promise<void> {
    if (
      release.status !== 'draft' ||
      release.gameId !== claim.row.gameId ||
      release.contentVersion !== claim.row.contentVersion
    ) {
      throw new ConflictException({
        code: 'STORY_EXPERIENCE_DRAFT_RELEASE_ACKNOWLEDGEMENT_MISMATCH',
        message: 'Java draft acknowledgement does not match the Build.',
      });
    }
    const now = await storyExperiencePublicationClock(this.prisma);
    const updated = await this.prisma.storyExperienceDraftRelease.updateMany({
      where: {
        buildId: claim.row.buildId,
        leaseOwner: claim.leaseOwner,
        status: { in: ['pending', 'uncertain'] },
      },
      data: {
        status: 'confirmed',
        manifestUrl: release.manifestUrl,
        confirmedAt: now,
        leaseOwner: null,
        leaseAcquiredAt: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
        lastErrorCode: null,
        lastErrorDetail: null,
        lastErrorAt: null,
      },
    });
    if (updated.count === 1) return;

    const existing = await this.prisma.storyExperienceDraftRelease.findUnique({
      where: { buildId: claim.row.buildId },
    });
    if (existing?.status === 'confirmed') {
      assertDraftAcknowledgement(existing, release);
      return;
    }
    throw new ConflictException({
      code: 'STORY_EXPERIENCE_DRAFT_RELEASE_LEASE_LOST',
      message:
        'Draft release ownership expired before the Java acknowledgement could be stored.',
    });
  }

  private async recordDraftReleaseFailure(
    claim: Extract<DraftReleaseClaim, { kind: 'claimed' }>,
    error: unknown,
  ): Promise<void> {
    const now = await storyExperiencePublicationClock(this.prisma);
    const detail = errorDetail(error);
    const unknown = isStoryExperienceReleaseOutcomeUnknown(error);
    if (!unknown) {
      // A definitive Java rejection terminates the receipt even when a prior
      // ambiguous attempt left it 'uncertain': the reconciliation replay is
      // the exact immutable request, so Java rejecting the replay proves the
      // original POST never committed. Rescheduling instead would wedge the
      // receipt forever — it cannot be deleted and its build_id is unique.
      await this.prisma.storyExperienceDraftRelease.updateMany({
        where: {
          buildId: claim.row.buildId,
          leaseOwner: claim.leaseOwner,
          status: { in: ['pending', 'uncertain'] },
        },
        data: {
          status: 'rejected',
          rejectedAt: now,
          leaseOwner: null,
          leaseAcquiredAt: null,
          leaseExpiresAt: null,
          nextAttemptAt: null,
          lastErrorCode: detail.code,
          lastErrorDetail: detail.message,
          lastErrorAt: now,
        },
      });
      return;
    }

    // An ambiguous draft POST cannot be observed through the public game
    // endpoint. Keep the receipt uncertain and reconcile by replaying only the
    // exact request after a bounded backoff. Java's immutable
    // (gameId, contentVersion, draft) identity makes this replay idempotent.
    await this.prisma.storyExperienceDraftRelease.updateMany({
      where: {
        buildId: claim.row.buildId,
        leaseOwner: claim.leaseOwner,
        status: { in: ['pending', 'uncertain'] },
      },
      data: {
        status: 'uncertain',
        nextAttemptAt: new Date(
          now.getTime() + draftReleaseBackoffMs(claim.row.attemptCount),
        ),
        // Keep the original lease through its bounded expiry. A timeout only
        // means our response is unknown; Java may still be finishing the POST.
        // Agent claims inspect this durable lease under the same project fence,
        // so clearing it here would let Agent apply overtake a late draft write.
        lastErrorCode: detail.code,
        lastErrorDetail: detail.message,
        lastErrorAt: now,
      },
    });
  }

  private async claimPublication(input: {
    buildId: string;
    projectId: string;
    userId: string;
    gameId: string;
    contentVersion: string;
    requestedSetCurrent: boolean;
  }): Promise<PublicationClaim> {
    const leaseOwner = `publish:${process.pid}:${randomUUID()}`;

    return this.prisma.$transaction(async (tx) => {
      await this.writeGuard.assertHumanWriteAllowed(tx, input.projectId);
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtext(${`story-experience-publication:${input.projectId}`})::bigint
        )
      `;
      const now = await storyExperiencePublicationClock(tx);
      let row = await tx.storyExperiencePublication.findUnique({
        where: { buildId: input.buildId },
      });
      if (row) assertPublicationIdentity(row, input);
      if (row?.status === 'confirmed') {
        return { kind: 'confirmed' as const, row: publicationSnapshot(row) };
      }
      if (row?.status === 'rejected') {
        return { kind: 'rejected' as const, row: publicationSnapshot(row) };
      }

      const competingRows = await tx.storyExperiencePublication.findMany({
        where: {
          storyProjectId: input.projectId,
          buildId: { not: input.buildId },
          status: { in: ['pending', 'uncertain'] },
        },
        orderBy: [{ leaseExpiresAt: 'desc' }, { createdAt: 'asc' }],
      });
      const activeCompeting = competingRows.find(
        (candidate) =>
          candidate.leaseExpiresAt &&
          candidate.leaseExpiresAt.getTime() > now.getTime(),
      );
      if (activeCompeting) {
        return {
          kind: 'busy' as const,
          buildId: activeCompeting.buildId,
          sameBuild: false,
          leaseExpiresAt: activeCompeting.leaseExpiresAt as Date,
        };
      }
      const unreconciled = competingRows.find(
        (candidate) =>
          !candidate.authorityCheckedAt ||
          (candidate.leaseExpiresAt !== null &&
            candidate.authorityCheckedAt.getTime() <=
              candidate.leaseExpiresAt.getTime()),
      );
      if (unreconciled) {
        return {
          kind: 'reconcile' as const,
          publicationId: unreconciled.id,
          projectId: unreconciled.storyProjectId,
          gameId: unreconciled.gameId,
        };
      }

      if (!row) {
        row = await tx.storyExperiencePublication.create({
          data: {
            buildId: input.buildId,
            storyProjectId: input.projectId,
            gameId: input.gameId,
            contentVersion: input.contentVersion,
            requestedSetCurrent: input.requestedSetCurrent,
            requestedByUserId: input.userId,
            // One clock read per operation. The column defaults evaluate
            // CURRENT_TIMESTAMP at insert time, which can land AFTER the
            // `now` this transaction already stamped onto the attempt/lease
            // fields below — the time_order_chk constraint then rejects the
            // row (first_attempt_at >= created_at, observed 11ms apart in
            // prod 2026-07-17). Stamp every lifecycle field from `now`.
            mediaAuthorizedAt: now,
            createdAt: now,
            updatedAt: now,
          },
        });
      }
      const attemptAt = now;
      const leaseExpiresAt = new Date(
        attemptAt.getTime() + PUBLICATION_LEASE_TTL_MS,
      );
      if (
        row.leaseOwner &&
        row.leaseExpiresAt &&
        row.leaseExpiresAt.getTime() > attemptAt.getTime()
      ) {
        return {
          kind: 'busy' as const,
          buildId: row.buildId,
          sameBuild: true,
          leaseExpiresAt: row.leaseExpiresAt,
        };
      }

      const claimed = await tx.storyExperiencePublication.update({
        where: { buildId: input.buildId },
        data: {
          attemptCount: { increment: 1 },
          firstAttemptAt: row.firstAttemptAt ?? attemptAt,
          lastAttemptAt: attemptAt,
          lastAttemptedByUserId: input.userId,
          nextAttemptAt: null,
          leaseOwner,
          leaseAcquiredAt: attemptAt,
          leaseExpiresAt,
        },
      });
      return {
        kind: 'claimed' as const,
        row: publicationSnapshot(claimed),
        leaseOwner,
      };
    });
  }

  private async prepareExpiredPublicationForReconciliation(
    publicationId: string,
  ): Promise<void> {
    const now = await storyExperiencePublicationClock(this.prisma);
    await this.prisma.storyExperiencePublication.updateMany({
      where: { id: publicationId, status: 'pending' },
      data: {
        status: 'uncertain',
        lastErrorCode: 'STORY_EXPERIENCE_PUBLICATION_CRASH_RECOVERY',
        lastErrorDetail:
          'Recovered a publication whose process stopped before recording the Java outcome.',
        lastErrorAt: now,
        nextReconciliationAt: now,
      },
    });
  }

  private async waitForConcurrentPublication(
    buildId: string,
  ): Promise<PublicationSnapshot | null> {
    const deadline = Date.now() + CONCURRENT_PUBLICATION_WAIT_MS;
    while (Date.now() < deadline) {
      const row = await this.prisma.storyExperiencePublication.findUnique({
        where: { buildId },
      });
      if (!row) return null;
      if (row.status === 'confirmed' || row.status === 'rejected') {
        return publicationSnapshot(row);
      }
      if (!row.leaseExpiresAt || row.leaseExpiresAt.getTime() <= Date.now()) {
        return publicationSnapshot(row);
      }
      await delay(CONCURRENT_PUBLICATION_POLL_MS);
    }
    return null;
  }

  private async confirmPublication(
    claim: Extract<PublicationClaim, { kind: 'claimed' }>,
    release: ExperienceReleaseResponse,
  ): Promise<void> {
    if (
      release.status !== 'published' ||
      release.gameId !== claim.row.gameId ||
      release.contentVersion !== claim.row.contentVersion
    ) {
      throw new ConflictException({
        code: 'STORY_EXPERIENCE_PUBLICATION_ACKNOWLEDGEMENT_MISMATCH',
        message: 'Java publication acknowledgement does not match the Build.',
      });
    }
    const now = await storyExperiencePublicationClock(this.prisma);
    const updated = await this.prisma.storyExperiencePublication.updateMany({
      where: {
        buildId: claim.row.buildId,
        leaseOwner: claim.leaseOwner,
        status: { in: ['pending', 'uncertain'] },
      },
      data: {
        status: 'confirmed',
        manifestUrl: release.manifestUrl,
        publishedAt: now,
        leaseOwner: null,
        leaseAcquiredAt: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
        lastErrorCode: null,
        lastErrorDetail: null,
        lastErrorAt: null,
        nextReconciliationAt: now,
      },
    });
    if (updated.count === 1) return;

    const existing = await this.prisma.storyExperiencePublication.findUnique({
      where: { buildId: claim.row.buildId },
    });
    if (existing?.status === 'confirmed') {
      assertAcknowledgement(existing, release);
      return;
    }
    throw new ConflictException({
      code: 'STORY_EXPERIENCE_PUBLICATION_LEASE_LOST',
      message:
        'Publication ownership expired before the Java acknowledgement could be stored.',
    });
  }

  private async recordPublishFailure(
    claim: Extract<PublicationClaim, { kind: 'claimed' }>,
    error: unknown,
  ): Promise<void> {
    const now = await storyExperiencePublicationClock(this.prisma);
    const detail = errorDetail(error);
    const unknown = isStoryExperienceReleaseOutcomeUnknown(error);
    if (!unknown && claim.row.status === 'pending') {
      await this.prisma.storyExperiencePublication.updateMany({
        where: {
          buildId: claim.row.buildId,
          leaseOwner: claim.leaseOwner,
          status: 'pending',
        },
        data: {
          status: 'rejected',
          rejectedAt: now,
          mediaAuthorizationRevokedAt: now,
          leaseOwner: null,
          leaseAcquiredAt: null,
          leaseExpiresAt: null,
          nextAttemptAt: null,
          nextReconciliationAt: null,
          lastErrorCode: detail.code,
          lastErrorDetail: detail.message,
          lastErrorAt: now,
        },
      });
      return;
    }

    // Unknown outcomes, and any later rejection observed after an earlier
    // unknown outcome, retain authorization. The project fence intentionally
    // remains until lease expiry so another Build cannot overtake an in-flight
    // Java request whose completion order is not yet known.
    await this.prisma.storyExperiencePublication.updateMany({
      where: {
        buildId: claim.row.buildId,
        leaseOwner: claim.leaseOwner,
        status: { in: ['pending', 'uncertain'] },
      },
      data: {
        status: 'uncertain',
        nextReconciliationAt: now,
        lastErrorCode: detail.code,
        lastErrorDetail: detail.message,
        lastErrorAt: now,
      },
    });
  }

  private async persistAuthorityObservation(
    tx: Prisma.TransactionClient,
    projectId: string,
    authority: ExperienceGameDetailResponse,
    checkedAt: Date,
  ): Promise<{
    currentBuild: StoryExperienceCurrentReleaseDto['currentBuild'];
    checkedAt: Date;
  }> {
    const rows = await tx.storyExperiencePublication.findMany({
      where: { storyProjectId: projectId, gameId: authority.gameId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: {
        build: {
          select: {
            id: true,
            sourceDraftRevision: true,
            videoSnapshotHash: true,
          },
        },
      },
    });
    const matching = rows.find(
      (row) => row.contentVersion === authority.currentVersion,
    );
    const observationCheckedAt = monotonicObservationTime(checkedAt, rows);
    if (matching?.status === 'rejected') {
      throw new ConflictException({
        code: 'STORY_EXPERIENCE_AUTHORITY_REJECTED_VERSION_CONFLICT',
        message:
          'Java reports a definitively rejected local publication as current.',
      });
    }
    if (
      matching?.status === 'confirmed' &&
      matching.manifestUrl !== authority.manifestUrl
    ) {
      throw new ConflictException({
        code: 'STORY_EXPERIENCE_AUTHORITY_MANIFEST_CONFLICT',
        message:
          'Java current Manifest URL conflicts with the immutable local acknowledgement.',
      });
    }

    for (const row of rows) {
      if (
        row.leaseExpiresAt &&
        row.leaseExpiresAt.getTime() > observationCheckedAt.getTime()
      ) {
        await this.advanceAuthorityObservationBarrier(
          tx,
          row.id,
          observationCheckedAt,
        );
        continue;
      }
      const isCurrent = row.contentVersion === authority.currentVersion;
      if (
        row.status === 'rejected' ||
        (!isCurrent && row.status === 'pending')
      ) {
        await this.advanceAuthorityObservationBarrier(
          tx,
          row.id,
          observationCheckedAt,
        );
        continue;
      }
      if (isCurrent) {
        const startsReconciliation = !row.reconciliationLeaseOwner;
        await tx.storyExperiencePublication.update({
          where: { id: row.id },
          data: {
            status: 'confirmed',
            manifestUrl: row.manifestUrl ?? authority.manifestUrl,
            publishedAt: row.publishedAt ?? observationCheckedAt,
            authorityIsCurrent: true,
            authorityGameExists: true,
            authorityCurrentVersion: authority.currentVersion,
            authorityManifestUrl: authority.manifestUrl,
            authorityCheckedAt: observationCheckedAt,
            ...(startsReconciliation
              ? {
                  reconciliationAttemptCount: { increment: 1 },
                  lastReconciliationAttemptAt: observationCheckedAt,
                }
              : {}),
            nextReconciliationAt: null,
            reconciliationLeaseOwner: null,
            reconciliationLeaseAcquiredAt: null,
            reconciliationLeaseExpiresAt: null,
            lastReconciliationErrorCode: null,
            lastReconciliationErrorDetail: null,
            lastReconciliationErrorAt: null,
            leaseOwner: null,
            leaseAcquiredAt: null,
            leaseExpiresAt: null,
            nextAttemptAt: null,
            lastErrorCode: null,
            lastErrorDetail: null,
            lastErrorAt: null,
          },
        });
        continue;
      }
      const startsReconciliation = !row.reconciliationLeaseOwner;
      await tx.storyExperiencePublication.update({
        where: { id: row.id },
        data: {
          authorityIsCurrent: false,
          authorityGameExists: true,
          authorityCurrentVersion: authority.currentVersion,
          authorityManifestUrl: authority.manifestUrl,
          authorityCheckedAt: observationCheckedAt,
          ...(startsReconciliation
            ? {
                reconciliationAttemptCount: { increment: 1 },
                lastReconciliationAttemptAt: observationCheckedAt,
              }
            : {}),
          nextReconciliationAt: null,
          reconciliationLeaseOwner: null,
          reconciliationLeaseAcquiredAt: null,
          reconciliationLeaseExpiresAt: null,
          lastReconciliationErrorCode: null,
          lastReconciliationErrorDetail: null,
          lastReconciliationErrorAt: null,
        },
      });
    }
    return {
      currentBuild: matching
        ? {
            id: matching.build.id,
            sourceDraftRevision: matching.build.sourceDraftRevision,
            videoSnapshotHash: matching.build.videoSnapshotHash,
          }
        : null,
      checkedAt: observationCheckedAt,
    };
  }

  private async persistAuthorityAbsence(
    tx: Prisma.TransactionClient,
    projectId: string,
    gameId: string,
    checkedAt: Date,
  ): Promise<Date> {
    const rows = await tx.storyExperiencePublication.findMany({
      where: {
        storyProjectId: projectId,
        gameId,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const observationCheckedAt = monotonicObservationTime(checkedAt, rows);
    for (const row of rows) {
      if (row.status === 'rejected') {
        await this.advanceAuthorityObservationBarrier(
          tx,
          row.id,
          observationCheckedAt,
        );
        continue;
      }
      if (
        row.leaseExpiresAt &&
        row.leaseExpiresAt.getTime() > observationCheckedAt.getTime()
      ) {
        await this.advanceAuthorityObservationBarrier(
          tx,
          row.id,
          observationCheckedAt,
        );
        continue;
      }
      const startsReconciliation = !row.reconciliationLeaseOwner;
      const becomesUncertain = row.status === 'pending';
      await tx.storyExperiencePublication.update({
        where: { id: row.id },
        data: {
          ...(becomesUncertain
            ? {
                status: 'uncertain' as const,
                lastErrorCode: 'STORY_EXPERIENCE_PUBLICATION_AUTHORITY_ABSENT',
                lastErrorDetail:
                  'Java reports that this game has no published current version.',
                lastErrorAt: observationCheckedAt,
              }
            : {}),
          authorityGameExists: false,
          authorityIsCurrent: false,
          authorityCurrentVersion: null,
          authorityManifestUrl: null,
          authorityCheckedAt: observationCheckedAt,
          ...(startsReconciliation
            ? {
                reconciliationAttemptCount: { increment: 1 },
                lastReconciliationAttemptAt: observationCheckedAt,
              }
            : {}),
          nextReconciliationAt: null,
          reconciliationLeaseOwner: null,
          reconciliationLeaseAcquiredAt: null,
          reconciliationLeaseExpiresAt: null,
          lastReconciliationErrorCode: null,
          lastReconciliationErrorDetail: null,
          lastReconciliationErrorAt: null,
          leaseOwner: null,
          leaseAcquiredAt: null,
          leaseExpiresAt: null,
          nextAttemptAt: null,
        },
      });
    }
    return observationCheckedAt;
  }

  /**
   * An active publication lease must not be cleared or reconciled from an
   * authority read. We still advance the row's MVCC version so this applied
   * observation invalidates every older in-flight Java response.
   */
  private async advanceAuthorityObservationBarrier(
    tx: Prisma.TransactionClient,
    publicationId: string,
    checkedAt: Date,
  ): Promise<void> {
    await tx.storyExperiencePublication.update({
      where: { id: publicationId },
      data: { updatedAt: checkedAt },
    });
  }
}

async function lockPublicationProject(
  tx: Prisma.TransactionClient,
  projectId: string,
): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext(${`story-experience-publication:${projectId}`})::bigint
    )
  `;
}

function authorityTransactionOptions(): {
  maxWait: number;
  timeout: number;
} {
  return {
    maxWait: AUTHORITY_TRANSACTION_TIMEOUT_MS,
    timeout: AUTHORITY_TRANSACTION_TIMEOUT_MS,
  };
}

function sameAuthorityObservationToken(
  expected: AuthorityObservationToken['rows'],
  actual: AuthorityObservationToken['rows'],
): boolean {
  return (
    expected.length === actual.length &&
    expected.every(
      (row, index) =>
        row.id === actual[index]?.id &&
        row.rowVersion === actual[index]?.rowVersion,
    )
  );
}

function publicationSnapshot(row: {
  id: string;
  buildId: string;
  storyProjectId: string;
  gameId: string;
  contentVersion: string;
  status: PublicationStatus;
  requestedSetCurrent: boolean;
  manifestUrl: string | null;
  publishedAt: Date | null;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  lastErrorCode: string | null;
  lastErrorDetail: string | null;
}): PublicationSnapshot {
  return { ...row };
}

function draftReleaseSnapshot(row: DraftReleaseSnapshot): DraftReleaseSnapshot {
  return { ...row };
}

function assertDraftReleaseIdentity(
  row: Pick<
    DraftReleaseSnapshot,
    'storyProjectId' | 'gameId' | 'contentVersion' | 'requestHash'
  >,
  input: {
    projectId: string;
    gameId: string;
    contentVersion: string;
    requestHash: string;
  },
): void {
  if (
    row.storyProjectId !== input.projectId ||
    row.gameId !== input.gameId ||
    row.contentVersion !== input.contentVersion ||
    row.requestHash !== input.requestHash
  ) {
    throw new ConflictException({
      code: 'STORY_EXPERIENCE_DRAFT_RELEASE_RECEIPT_CONFLICT',
      message:
        'The durable draft release identity does not match this exact Build request.',
    });
  }
}

function assertDraftAcknowledgement(
  row: Pick<DraftReleaseSnapshot, 'gameId' | 'contentVersion' | 'manifestUrl'>,
  release: ExperienceReleaseResponse,
): void {
  if (
    release.status !== 'draft' ||
    row.gameId !== release.gameId ||
    row.contentVersion !== release.contentVersion ||
    row.manifestUrl !== release.manifestUrl
  ) {
    throw new ConflictException({
      code: 'STORY_EXPERIENCE_DRAFT_RELEASE_RECEIPT_CONFLICT',
      message:
        'The stored Java draft acknowledgement does not match this Build release.',
    });
  }
}

function draftReleaseFromRow(
  row: DraftReleaseSnapshot,
): ExperienceReleaseResponse {
  if (!row.manifestUrl || !row.confirmedAt) {
    throw new ConflictException({
      code: 'STORY_EXPERIENCE_DRAFT_RELEASE_CORRUPT',
      message: 'Confirmed draft release acknowledgement is incomplete.',
    });
  }
  return {
    gameId: row.gameId,
    contentVersion: row.contentVersion,
    status: 'draft',
    manifestUrl: row.manifestUrl,
  };
}

function storedDraftRejection(row: DraftReleaseSnapshot): ConflictException {
  return new ConflictException({
    code: row.lastErrorCode ?? 'STORY_EXPERIENCE_DRAFT_RELEASE_REJECTED',
    message:
      row.lastErrorDetail ??
      'Java definitively rejected this immutable draft release.',
  });
}

function draftReleaseInProgress(
  claim: Extract<DraftReleaseClaim, { kind: 'busy' }>,
): ConflictException {
  return new ConflictException({
    code: 'STORY_EXPERIENCE_DRAFT_RELEASE_IN_PROGRESS',
    message:
      'This exact draft release is still in flight or waiting for a safe replay window.',
    buildId: claim.row.buildId,
    retryAfter: claim.retryAfter.toISOString(),
  });
}

function laterDate(
  left: Date | null | undefined,
  right: Date | null | undefined,
): Date | null {
  if (!left) return right ?? null;
  if (!right) return left;
  return left.getTime() >= right.getTime() ? left : right;
}

function draftReleaseBackoffMs(attempt: number): number {
  return Math.min(
    5_000 * 2 ** Math.max(0, attempt - 1),
    DRAFT_RELEASE_MAX_RETRY_BACKOFF_MS,
  );
}

function assertPublicationIdentity(
  row: {
    storyProjectId: string;
    gameId: string;
    contentVersion: string;
    requestedSetCurrent: boolean;
  },
  input: {
    projectId: string;
    gameId: string;
    contentVersion: string;
    requestedSetCurrent: boolean;
  },
): void {
  if (
    row.storyProjectId !== input.projectId ||
    row.gameId !== input.gameId ||
    row.contentVersion !== input.contentVersion ||
    row.requestedSetCurrent !== input.requestedSetCurrent
  ) {
    throw new ConflictException({
      code: 'STORY_EXPERIENCE_PUBLICATION_RECEIPT_CONFLICT',
      message:
        'The durable publication identity does not match this Build release.',
    });
  }
}

function assertAcknowledgement(
  row: { gameId: string; contentVersion: string; manifestUrl: string | null },
  release: ExperienceReleaseResponse,
): void {
  if (
    row.gameId !== release.gameId ||
    row.contentVersion !== release.contentVersion ||
    row.manifestUrl !== release.manifestUrl
  ) {
    throw new ConflictException({
      code: 'STORY_EXPERIENCE_PUBLICATION_RECEIPT_CONFLICT',
      message:
        'The stored Java acknowledgement does not match this Build release.',
    });
  }
}

function releaseFromRow(row: PublicationSnapshot): ExperienceReleaseResponse {
  if (!row.manifestUrl || !row.publishedAt) {
    throw new ConflictException({
      code: 'STORY_EXPERIENCE_PUBLICATION_CORRUPT',
      message: 'Confirmed publication acknowledgement is incomplete.',
    });
  }
  return {
    gameId: row.gameId,
    contentVersion: row.contentVersion,
    status: 'published',
    manifestUrl: row.manifestUrl,
  };
}

function storedRejection(row: PublicationSnapshot): ConflictException {
  return new ConflictException({
    code: row.lastErrorCode ?? 'STORY_EXPERIENCE_PUBLICATION_REJECTED',
    message:
      row.lastErrorDetail ??
      'Java definitively rejected this immutable Build publication.',
  });
}

function publicationInProgress(
  claim: Extract<PublicationClaim, { kind: 'busy' }>,
): ConflictException {
  return new ConflictException({
    code: 'STORY_EXPERIENCE_PUBLICATION_IN_PROGRESS',
    message:
      'Another publication for this Story Project is still being resolved.',
    activeBuildId: claim.buildId,
    retryAfter: claim.leaseExpiresAt.toISOString(),
  });
}

function scopeMismatch(): ConflictException {
  return new ConflictException({
    code: 'STORY_PROJECT_SCOPE_MISMATCH',
    message: 'Story project does not belong to the active workspace.',
  });
}

/**
 * Authority observations may complete out of request order. Keep the stored
 * timestamp strictly newer than every previous observation (and no earlier
 * than a worker claim) so a slower response can never make reconciliation
 * metadata move backwards.
 */
function monotonicObservationTime(
  requested: Date,
  rows: Array<{
    authorityCheckedAt: Date | null;
    lastReconciliationAttemptAt: Date | null;
  }>,
): Date {
  let timestamp = requested.getTime();
  for (const row of rows) {
    if (row.authorityCheckedAt) {
      timestamp = Math.max(timestamp, row.authorityCheckedAt.getTime() + 1);
    }
    if (row.lastReconciliationAttemptAt) {
      timestamp = Math.max(
        timestamp,
        row.lastReconciliationAttemptAt.getTime(),
      );
    }
  }
  return new Date(timestamp);
}

function errorDetail(error: unknown): {
  code: string | null;
  message: string;
} {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (response && typeof response === 'object') {
      const value = response as { code?: unknown; message?: unknown };
      return {
        code: typeof value.code === 'string' ? value.code : null,
        message:
          typeof value.message === 'string'
            ? value.message
            : error.message || 'Java publication failed.',
      };
    }
    if (typeof response === 'string') {
      return { code: null, message: response };
    }
  }
  return {
    code: null,
    message:
      error instanceof Error ? error.message : 'Java publication failed.',
  };
}

function localizedText(
  value: Record<string, string>,
  defaultLocale: string,
): string {
  return value[defaultLocale] ?? Object.values(value)[0];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
