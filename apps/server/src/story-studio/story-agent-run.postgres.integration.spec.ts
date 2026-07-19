import { HttpException, HttpStatus } from '@nestjs/common';
import {
  Prisma,
  StoryAgentRunKind,
  StoryAgentRunStatus,
  StoryBuildKind,
  StoryBuildStatus,
  StoryExperiencePublicationStatus,
  StoryFormat,
  StoryFrameProfile,
  StoryProjectMemberRole,
  StoryProjectStatus,
  StoryRevisionSource,
  StoryVisibility,
  WorkspaceMemberRole,
  WorkspaceType,
} from '@prisma/client';
import type { StoryAgentRunDto } from '@repo/shared/story-agent';
import { config as loadEnv } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { AuthUser } from '../auth';
import { buildPrisma, type PrismaService } from '../infra/db/db.module';
import { canonicalJsonHash } from './canonical-json';
import {
  EMPTY_INTERACTIVE_FILM_DRAFT_CONTENT,
  INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION,
  InteractiveFilmDraftContentSchema,
  STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
} from './dto';
import type { StoryAgentRunRealtimeService } from './story-agent-run-realtime.service';
import { StoryAgentRunService } from './story-agent-run.service';
import type { StoryPermissionService } from './story-permission.service';
import { StoryProjectWriteGuardService } from './story-project-write-guard.service';

loadEnv({
  path: resolve(__dirname, '../../.env'),
  override: false,
  quiet: true,
});

const INTEGRATION_ENABLED =
  process.env.STORY_AGENT_POSTGRES_INTEGRATION === '1';
const DEFAULT_LOCAL_DATABASE_URL =
  'postgres://fizzdragon:fizzdragon@localhost:5433/fizzdragon';
const TEST_PREFIX = 'story-agent-pg-it';
const describePostgres = INTEGRATION_ENABLED ? describe : describe.skip;
const nativeStructuredClone = globalThis.structuredClone;

/**
 * Real PostgreSQL concurrency and crash-recovery coverage for Story Agent.
 *
 * This suite is deliberately opt-in because ordinary unit-test CI has no
 * database. Run it through `npm run test:integration:story-agent -w server`.
 * The local-only guard executes before Prisma opens a socket, and every row is
 * scoped by a unique test prefix then deleted in `afterEach`/`afterAll`.
 */
describePostgres('StoryAgentRunService PostgreSQL integration', () => {
  const databaseUrl =
    process.env.DATABASE_URL?.trim() || DEFAULT_LOCAL_DATABASE_URL;
  let prisma: ReturnType<typeof buildPrisma>;
  const fixtureWorkspaceIds = new Set<string>();

  beforeAll(async () => {
    assertDedicatedLocalPostgres(databaseUrl);
    // Jest executes test modules in a VM realm while Node's native
    // structuredClone returns host-realm objects. The production canonical JSON
    // guard correctly rejects non-local prototypes, so use an equivalent JSON
    // clone here; Story Agent drafts/layouts are schema-validated JSON values.
    globalThis.structuredClone = jsonStructuredClone;
    prisma = buildPrisma();
    await prisma.$connect();
    await assertStoryAgentMigrationPresent(prisma);
    await removeAbandonedFixtures(prisma);
  });

  afterEach(async () => {
    await cleanupFixtures(prisma, [...fixtureWorkspaceIds]);
    fixtureWorkspaceIds.clear();
  });

  afterAll(async () => {
    globalThis.structuredClone = nativeStructuredClone;
    if (!prisma) return;
    await cleanupFixtures(prisma, [...fixtureWorkspaceIds]);
    await removeAbandonedFixtures(prisma);
    await prisma.$disconnect();
  });

  it('reports stale_base instead of landing operations when a human write advances the head during drafting', async () => {
    const fixture = await createFixture(prisma, fixtureWorkspaceIds);
    const filed = await fixture.service.createAuthoringRun(
      fixture.user,
      fixture.workspaceId,
      fixture.projectId,
      {
        title: 'Stale generated proposal',
        summary: 'This document was authored against the prior story head.',
        brief: 'Replace the premise with the Agent-authored logline.',
        idempotencyKey: `${fixture.prefix}:stale-context`,
        conversationId: `${fixture.prefix}:conversation:stale-context`,
      },
    );
    const workerId = `${fixture.prefix}:author:stale-context`;
    expect(await fixture.service.claimAuthoringRuns(workerId, 1)).toEqual([
      { id: filed.id },
    ]);
    const load = await fixture.service.loadAuthoringJob(filed.id, workerId);
    if (load.kind !== 'job') {
      throw new Error(`Expected an authoring job, got ${load.kind}.`);
    }
    const guard = new StoryProjectWriteGuardService(
      prisma as unknown as PrismaService,
    );
    await prisma.$transaction(async (tx) => {
      await guard.assertHumanWriteAllowed(tx, fixture.projectId);
      const current = await tx.storyDraft.findUniqueOrThrow({
        where: { storyProjectId: fixture.projectId },
      });
      const content = InteractiveFilmDraftContentSchema.parse(current.content);
      const changedContent = {
        ...content,
        storyBible: {
          ...content.storyBible,
          logline: 'A collaborator changed the story during generation.',
        },
      };
      await tx.storyDraft.update({
        where: { storyProjectId: fixture.projectId },
        data: {
          content: changedContent as unknown as Prisma.InputJsonObject,
          contentHash: canonicalJsonHash(changedContent),
          revision: { increment: 1 },
          updatedByUserId: fixture.user.userId,
        },
      });
    });

    await expect(
      fixture.service.completeAuthoring(filed.id, workerId, {
        operations: [
          {
            operationId: randomUUID(),
            summary: 'Replace the premise from stale context.',
            kind: 'story_bible.update_overview',
            payload: { logline: 'The stale Agent premise.' },
          },
        ],
        authoredAgainst: load.job.snapshot,
      }),
    ).resolves.toEqual({ kind: 'stale_base' });
    // The run stays claimable for a fresh re-author; nothing was proposed.
    await expect(
      prisma.storyAgentRun.findUniqueOrThrow({ where: { id: filed.id } }),
    ).resolves.toMatchObject({ status: StoryAgentRunStatus.authoring });
    await expect(
      prisma.storyAgentRun.count({
        where: {
          storyProjectId: fixture.projectId,
          status: StoryAgentRunStatus.proposed,
        },
      }),
    ).resolves.toBe(0);
  });

  it('reads the canonical Undo head after the project is archived', async () => {
    const fixture = await createFixture(prisma, fixtureWorkspaceIds);
    await prisma.storyProject.update({
      where: { id: fixture.projectId },
      data: {
        status: StoryProjectStatus.archived,
        archivedAt: new Date(),
      },
    });

    await expect(
      fixture.service.getUndoableRun(
        fixture.user,
        fixture.workspaceId,
        fixture.projectId,
      ),
    ).resolves.toBeNull();
  });

  it('serializes concurrent confirms and worker claims so one run writes once', async () => {
    const fixture = await createFixture(prisma, fixtureWorkspaceIds);
    const first = await fixture.authorProposal('first', 'The first premise.');
    const second = await fixture.authorProposal(
      'second',
      'The second premise.',
    );
    await expect(
      fixture.service.getLatestRun(
        fixture.user,
        fixture.workspaceId,
        fixture.projectId,
      ),
    ).resolves.toMatchObject({ id: second.id, status: 'proposed' });

    const confirmations = await Promise.allSettled([
      fixture.service.confirm(
        fixture.user,
        fixture.workspaceId,
        fixture.projectId,
        first.id,
        `${fixture.prefix}:confirm:first`,
      ),
      fixture.service.confirm(
        fixture.user,
        fixture.workspaceId,
        fixture.projectId,
        second.id,
        `${fixture.prefix}:confirm:second`,
      ),
    ]);
    const applying = confirmations
      .filter(
        (result): result is PromiseFulfilledResult<StoryAgentRunDto> =>
          result.status === 'fulfilled',
      )
      .map((result) => result.value)
      .filter((run) => run.status === 'applying');
    expect(applying).toEqual([expect.objectContaining({ id: second.id })]);
    const rejected = confirmations.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejected?.reason).toBeInstanceOf(HttpException);
    const rejection = (rejected?.reason as HttpException).getResponse() as {
      code: string;
      runId: string;
      canonicalRunId?: string;
    };
    expect(rejection.runId).toBe(first.id);
    expect([
      'STORY_AGENT_RUN_NOT_CANONICAL_HEAD',
      'STORY_AGENT_RUN_NOT_CONFIRMABLE',
    ]).toContain(rejection.code);
    if (rejection.code === 'STORY_AGENT_RUN_NOT_CANONICAL_HEAD') {
      expect(rejection.canonicalRunId).toBe(second.id);
    }

    const claims = await Promise.all([
      fixture.service.claimApplyingRuns(`${fixture.prefix}:worker:a`, 1),
      fixture.service.claimApplyingRuns(`${fixture.prefix}:worker:b`, 1),
    ]);
    expect(claims.flat()).toEqual([{ id: applying[0].id }]);

    const claimed = await prisma.storyAgentRun.findUniqueOrThrow({
      where: { id: applying[0].id },
    });
    expect(claimed.leaseOwner).toMatch(
      new RegExp(`^${fixture.prefix}:worker:[ab]$`),
    );

    // Even duplicate delivery to the same owning worker serializes on the
    // project state row. The second execution observes the terminal run.
    await Promise.all([
      fixture.service.executeClaimedRun(applying[0].id, claimed.leaseOwner!),
      fixture.service.executeClaimedRun(applying[0].id, claimed.leaseOwner!),
    ]);

    const [draft, runs, state] = await Promise.all([
      prisma.storyDraft.findUniqueOrThrow({
        where: { storyProjectId: fixture.projectId },
      }),
      prisma.storyAgentRun.findMany({
        where: { storyProjectId: fixture.projectId },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.storyProjectWriteState.findUniqueOrThrow({
        where: { storyProjectId: fixture.projectId },
      }),
    ]);
    expect(draft.revision).toBe(1);
    expect(
      InteractiveFilmDraftContentSchema.parse(draft.content).storyBible.logline,
    ).toMatch(/^The (first|second) premise\.$/);
    expect(
      runs.filter((run) => run.status === StoryAgentRunStatus.succeeded),
    ).toHaveLength(1);
    expect(
      runs.filter((run) => run.status === StoryAgentRunStatus.stale),
    ).toHaveLength(1);
    expect(state.activeAgentRunId).toBeNull();
  });

  it('lets a new worker reclaim an expired lease and rejects the old worker commit', async () => {
    const fixture = await createFixture(prisma, fixtureWorkspaceIds);
    const proposal = await fixture.authorProposal(
      'takeover',
      'A recovered worker owns this premise.',
    );
    await fixture.service.confirm(
      fixture.user,
      fixture.workspaceId,
      fixture.projectId,
      proposal.id,
      `${fixture.prefix}:confirm`,
    );
    expect(
      await fixture.service.claimApplyingRuns(
        `${fixture.prefix}:worker:old`,
        1,
      ),
    ).toEqual([{ id: proposal.id }]);

    await prisma.storyAgentRun.update({
      where: { id: proposal.id },
      data: {
        leaseAcquiredAt: new Date(Date.now() - 20_000),
        leaseExpiresAt: new Date(Date.now() - 10_000),
      },
    });
    await prisma.storyProjectWriteState.update({
      where: { storyProjectId: fixture.projectId },
      data: {
        lockedAt: new Date(Date.now() - 20_000),
        lockExpiresAt: new Date(Date.now() - 10_000),
      },
    });
    expect(
      await fixture.service.claimApplyingRuns(
        `${fixture.prefix}:worker:new`,
        1,
      ),
    ).toEqual([{ id: proposal.id }]);

    await fixture.service.executeClaimedRun(
      proposal.id,
      `${fixture.prefix}:worker:old`,
    );
    const afterOldWorker = await prisma.storyAgentRun.findUniqueOrThrow({
      where: { id: proposal.id },
    });
    expect(afterOldWorker.status).toBe(StoryAgentRunStatus.applying);
    expect(afterOldWorker.leaseOwner).toBe(`${fixture.prefix}:worker:new`);
    expect(
      await prisma.storyDraft.findUniqueOrThrow({
        where: { storyProjectId: fixture.projectId },
      }),
    ).toMatchObject({ revision: 0 });

    await fixture.service.executeClaimedRun(
      proposal.id,
      `${fixture.prefix}:worker:new`,
    );
    const [completed, draft] = await Promise.all([
      prisma.storyAgentRun.findUniqueOrThrow({ where: { id: proposal.id } }),
      prisma.storyDraft.findUniqueOrThrow({
        where: { storyProjectId: fixture.projectId },
      }),
    ]);
    expect(completed.status).toBe(StoryAgentRunStatus.succeeded);
    expect(draft.revision).toBe(1);
  });

  it('stales a recovered run when a durable external claim intervened during an older lease-expiry window', async () => {
    const fixture = await createFixture(prisma, fixtureWorkspaceIds);
    const proposal = await fixture.authorProposal(
      'external-intent-recovery',
      'An external intent must supersede this recovered Agent write.',
    );
    await fixture.service.confirm(
      fixture.user,
      fixture.workspaceId,
      fixture.projectId,
      proposal.id,
      `${fixture.prefix}:confirm`,
    );

    const expiredAt = new Date(Date.now() - 10_000);
    const acquiredAt = new Date(expiredAt.getTime() - 10_000);
    await prisma.$transaction([
      prisma.storyAgentRun.update({
        where: { id: proposal.id },
        data: { leaseAcquiredAt: acquiredAt, leaseExpiresAt: expiredAt },
      }),
      prisma.storyProjectWriteState.update({
        where: { storyProjectId: fixture.projectId },
        data: { lockedAt: acquiredAt, lockExpiresAt: expiredAt },
      }),
    ]);

    // Fault injection for the exact state left by the old vulnerable ordering:
    // the external receipt committed while the durable Agent run still owned
    // the project row. Current release claims cannot create this state because
    // the write guard below remains reserved even after worker-lease expiry.
    // Immutable revisions/builds deliberately cannot be deleted. Keep the
    // fault-injected external receipt and the worker recovery in one real
    // PostgreSQL transaction, assert the resulting state, then deliberately
    // roll back so the integration database remains clean.
    const rollback = new Error('rollback external-intent fault injection');
    try {
      await prisma.$transaction(
        async (tx) => {
          const receipt = await createActiveDraftReleaseReceipt(tx, fixture);
          const recoveredService = storyAgentServiceBoundToTransaction(
            tx,
            fixture,
          );
          const workerId = `${fixture.prefix}:worker:recovered-after-release`;
          expect(await recoveredService.claimApplyingRuns(workerId, 1)).toEqual(
            [{ id: proposal.id }],
          );

          await recoveredService.executeClaimedRun(proposal.id, workerId);

          // A Prisma interactive transaction owns one pg connection; keep
          // assertions sequential instead of issuing concurrent client.query
          // calls on that connection.
          const run = await tx.storyAgentRun.findUniqueOrThrow({
            where: { id: proposal.id },
          });
          const draft = await tx.storyDraft.findUniqueOrThrow({
            where: { storyProjectId: fixture.projectId },
          });
          const state = await tx.storyProjectWriteState.findUniqueOrThrow({
            where: { storyProjectId: fixture.projectId },
          });
          const durableReceipt =
            await tx.storyExperienceDraftRelease.findUniqueOrThrow({
              where: { id: receipt.id },
            });
          expect(run).toMatchObject({
            status: StoryAgentRunStatus.stale,
            errorCode: 'STORY_AGENT_EXTERNAL_COMMAND_INTERVENED',
          });
          expect(draft.revision).toBe(0);
          expect(state.activeAgentRunId).toBeNull();
          expect(durableReceipt).toMatchObject({
            status: StoryExperiencePublicationStatus.pending,
            leaseOwner: receipt.leaseOwner,
          });
          throw rollback;
        },
        { timeout: 20_000 },
      );
    } catch (error) {
      if (error !== rollback) throw error;
    }
  });

  it('fences a displaced worker when project authority no longer matches its run token', async () => {
    const fixture = await createFixture(prisma, fixtureWorkspaceIds);
    const proposal = await fixture.authorProposal(
      'fenced',
      'A displaced worker must never write this premise.',
    );
    await fixture.service.confirm(
      fixture.user,
      fixture.workspaceId,
      fixture.projectId,
      proposal.id,
      `${fixture.prefix}:confirm`,
    );
    const workerId = `${fixture.prefix}:worker:displaced`;
    expect(await fixture.service.claimApplyingRuns(workerId, 1)).toEqual([
      { id: proposal.id },
    ]);
    const claimed = await prisma.storyAgentRun.findUniqueOrThrow({
      where: { id: proposal.id },
    });
    expect(claimed.fencingToken).not.toBeNull();

    // Fault injection: model the authority row advancing independently after
    // a coordinator recovery. The worker still owns an unexpired run lease,
    // but its stale fencing token must make the whole transaction non-writable.
    await prisma.storyProjectWriteState.update({
      where: { storyProjectId: fixture.projectId },
      data: { fencingToken: claimed.fencingToken! + 1n },
    });
    await fixture.service.executeClaimedRun(proposal.id, workerId);

    const [fencedRun, draft, state] = await Promise.all([
      prisma.storyAgentRun.findUniqueOrThrow({ where: { id: proposal.id } }),
      prisma.storyDraft.findUniqueOrThrow({
        where: { storyProjectId: fixture.projectId },
      }),
      prisma.storyProjectWriteState.findUniqueOrThrow({
        where: { storyProjectId: fixture.projectId },
      }),
    ]);
    expect(fencedRun).toMatchObject({
      status: StoryAgentRunStatus.stale,
      errorCode: 'STORY_AGENT_FENCE_LOST',
    });
    expect(draft.revision).toBe(0);
    expect(state.activeAgentRunId).toBeNull();
    expect(state.fencingToken).toBe(claimed.fencingToken! + 1n);
  });

  it('keeps human and deferred writes blocked after worker leases expire while the run remains recoverable', async () => {
    const fixture = await createFixture(prisma, fixtureWorkspaceIds);
    const proposal = await fixture.authorProposal(
      'locked',
      'The Agent owns the write boundary.',
    );
    await fixture.service.confirm(
      fixture.user,
      fixture.workspaceId,
      fixture.projectId,
      proposal.id,
      `${fixture.prefix}:confirm`,
    );
    const guard = new StoryProjectWriteGuardService(
      prisma as unknown as PrismaService,
    );
    const expiredAt = new Date(Date.now() - 10_000);
    const acquiredAt = new Date(expiredAt.getTime() - 10_000);
    await prisma.$transaction([
      prisma.storyAgentRun.update({
        where: { id: proposal.id },
        data: { leaseAcquiredAt: acquiredAt, leaseExpiresAt: expiredAt },
      }),
      prisma.storyProjectWriteState.update({
        where: { storyProjectId: fixture.projectId },
        data: { lockedAt: acquiredAt, lockExpiresAt: expiredAt },
      }),
    ]);

    const attemptedWrite = prisma.$transaction(async (tx) => {
      await guard.assertHumanWriteAllowed(tx, fixture.projectId);
      await tx.storyDraft.update({
        where: { storyProjectId: fixture.projectId },
        data: { revision: { increment: 1 } },
      });
    });
    await expectLocked(attemptedWrite, proposal.id);
    await expect(
      prisma.$transaction((tx) =>
        guard.tryAcquireDeferredWriteFence(tx, fixture.projectId),
      ),
    ).resolves.toBe(false);
    expect(
      await prisma.storyDraft.findUniqueOrThrow({
        where: { storyProjectId: fixture.projectId },
      }),
    ).toMatchObject({ revision: 0 });
  });

  it('attributes apply and grouped undo writes to the confirming editor', async () => {
    const fixture = await createFixture(prisma, fixtureWorkspaceIds);
    const confirmer = {
      userId: `${fixture.prefix}:confirming-editor`.slice(0, 64),
    } as AuthUser;
    const undoer = {
      userId: `${fixture.prefix}:undo-editor`.slice(0, 64),
    } as AuthUser;
    const proposal = await fixture.authorProposal(
      'attribution',
      'The confirming editor owns this write.',
    );
    const applying = await fixture.service.confirm(
      confirmer,
      fixture.workspaceId,
      fixture.projectId,
      proposal.id,
      `${fixture.prefix}:confirm:attribution`,
    );
    expect(applying).toMatchObject({
      initiator: { id: fixture.user.userId },
      confirmedByUserId: confirmer.userId,
    });
    const applyWorker = `${fixture.prefix}:worker:attribution`;
    expect(await fixture.service.claimApplyingRuns(applyWorker, 1)).toEqual([
      { id: proposal.id },
    ]);
    await fixture.service.executeClaimedRun(proposal.id, applyWorker);

    const [appliedRun, appliedDraft] = await Promise.all([
      prisma.storyAgentRun.findUniqueOrThrow({ where: { id: proposal.id } }),
      prisma.storyDraft.findUniqueOrThrow({
        where: { storyProjectId: fixture.projectId },
      }),
    ]);
    expect(appliedRun).toMatchObject({
      initiatedByUserId: fixture.user.userId,
      confirmedByUserId: confirmer.userId,
    });
    expect(appliedDraft.updatedByUserId).toBe(confirmer.userId);
    expect(appliedDraft.updatedBySessionId).toBeNull();

    const undo = await fixture.service.undo(
      undoer,
      fixture.workspaceId,
      fixture.projectId,
      proposal.id,
      `${fixture.prefix}:undo:attribution`,
    );
    expect(undo).toMatchObject({
      kind: StoryAgentRunKind.undo,
      initiator: { id: undoer.userId },
      confirmedByUserId: undoer.userId,
    });
    const undoWorker = `${fixture.prefix}:worker:undo`;
    expect(await fixture.service.claimApplyingRuns(undoWorker, 1)).toEqual([
      { id: undo.id },
    ]);
    await fixture.service.executeClaimedRun(undo.id, undoWorker);
    expect(
      await prisma.storyDraft.findUniqueOrThrow({
        where: { storyProjectId: fixture.projectId },
      }),
    ).toMatchObject({ updatedByUserId: undoer.userId });
  });

  it('rejects undo across a newer succeeded mutation even when the old run is addressed directly', async () => {
    const fixture = await createFixture(prisma, fixtureWorkspaceIds);
    const first = await fixture.authorProposal(
      'historical-undo-source',
      'The first Agent-authored premise.',
    );
    await fixture.service.confirm(
      fixture.user,
      fixture.workspaceId,
      fixture.projectId,
      first.id,
      `${fixture.prefix}:confirm:historical-first`,
    );
    const firstWorker = `${fixture.prefix}:worker:historical-first`;
    expect(await fixture.service.claimApplyingRuns(firstWorker, 1)).toEqual([
      { id: first.id },
    ]);
    await fixture.service.executeClaimedRun(first.id, firstWorker);

    const second = await fixture.authorProposal(
      'canonical-undo-source',
      'The newer Agent-authored premise.',
    );
    await fixture.service.confirm(
      fixture.user,
      fixture.workspaceId,
      fixture.projectId,
      second.id,
      `${fixture.prefix}:confirm:historical-second`,
    );
    const secondWorker = `${fixture.prefix}:worker:historical-second`;
    expect(await fixture.service.claimApplyingRuns(secondWorker, 1)).toEqual([
      { id: second.id },
    ]);
    await fixture.service.executeClaimedRun(second.id, secondWorker);

    await expect(
      fixture.service.getLatestRun(
        fixture.user,
        fixture.workspaceId,
        fixture.projectId,
      ),
    ).resolves.toMatchObject({ id: second.id, status: 'succeeded' });
    await expect(
      fixture.service.getUndoableRun(
        fixture.user,
        fixture.workspaceId,
        fixture.projectId,
      ),
    ).resolves.toMatchObject({ id: second.id, status: 'succeeded' });

    await expectErrorResponse(
      fixture.service.undo(
        fixture.user,
        fixture.workspaceId,
        fixture.projectId,
        first.id,
        `${fixture.prefix}:undo:historical`,
      ),
      {
        code: 'STORY_AGENT_UNDO_HEAD_CHANGED',
        runId: first.id,
      },
    );
    expect(
      await prisma.storyAgentRun.count({
        where: {
          storyProjectId: fixture.projectId,
          kind: StoryAgentRunKind.undo,
        },
      }),
    ).toBe(0);
  });

  it('keeps grouped undo available across a newer non-writing lifecycle event', async () => {
    const fixture = await createFixture(prisma, fixtureWorkspaceIds);
    const source = await fixture.authorProposal(
      'undo-before-cancelled-event',
      'The successful mutation remains the data head.',
    );
    await fixture.service.confirm(
      fixture.user,
      fixture.workspaceId,
      fixture.projectId,
      source.id,
      `${fixture.prefix}:confirm:undo-before-cancel`,
    );
    const worker = `${fixture.prefix}:worker:undo-before-cancel`;
    expect(await fixture.service.claimApplyingRuns(worker, 1)).toEqual([
      { id: source.id },
    ]);
    await fixture.service.executeClaimedRun(source.id, worker);

    const cancelled = await fixture.authorProposal(
      'cancelled-lifecycle-event',
      'This proposal never writes the canonical story.',
    );
    await expect(
      fixture.service.cancel(
        fixture.user,
        fixture.workspaceId,
        fixture.projectId,
        cancelled.id,
      ),
    ).resolves.toMatchObject({ id: cancelled.id, status: 'cancelled' });
    await expect(
      fixture.service.getLatestRun(
        fixture.user,
        fixture.workspaceId,
        fixture.projectId,
      ),
    ).resolves.toMatchObject({ id: cancelled.id, status: 'cancelled' });
    await expect(
      fixture.service.getUndoableRun(
        fixture.user,
        fixture.workspaceId,
        fixture.projectId,
      ),
    ).resolves.toMatchObject({ id: source.id, status: 'succeeded' });

    await expect(
      fixture.service.undo(
        fixture.user,
        fixture.workspaceId,
        fixture.projectId,
        source.id,
        `${fixture.prefix}:undo:after-cancelled-event`,
      ),
    ).resolves.toMatchObject({
      kind: StoryAgentRunKind.undo,
      status: 'applying',
      undoOfRunId: source.id,
    });
  });

  it('enforces one active proposal per project, user, and conversation in PostgreSQL', async () => {
    const fixture = await createFixture(prisma, fixtureWorkspaceIds);
    const proposal = await fixture.authorProposal(
      'scope-constraint',
      'Only one proposal may occupy this conversation scope.',
    );
    const existing = await prisma.storyAgentRun.findUniqueOrThrow({
      where: { id: proposal.id },
    });

    await expect(
      prisma.storyAgentRun.create({
        data: {
          storyProjectId: existing.storyProjectId,
          workspaceId: existing.workspaceId,
          kind: StoryAgentRunKind.apply,
          status: StoryAgentRunStatus.proposed,
          initiatedByUserId: existing.initiatedByUserId,
          conversationId: existing.conversationId,
          baseDraftRevision: existing.baseDraftRevision,
          baseLayoutRevision: existing.baseLayoutRevision,
          proposal: existing.proposal as Prisma.InputJsonObject,
          summary: existing.summary,
          idempotencyKey: `${fixture.prefix}:constraint:duplicate`,
          requestFingerprint: 'a'.repeat(64),
          expiresAt: new Date(Date.now() + 60_000),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('transitions an expired proposal to stale without claiming the project', async () => {
    const fixture = await createFixture(prisma, fixtureWorkspaceIds);
    const proposal = await fixture.authorProposal(
      'expired',
      'This proposal must not be applied after its TTL.',
    );
    await prisma.$transaction(async (tx) => {
      const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`
        SELECT transaction_timestamp() AS "now"
      `;
      const proposedAt = new Date(clock.now.getTime() - 120_000);
      const expiresAt = new Date(clock.now.getTime() - 60_000);
      await tx.storyAgentRun.update({
        where: { id: proposal.id },
        data: { proposedAt, expiresAt },
      });
    });

    const expired = await fixture.service.confirm(
      fixture.user,
      fixture.workspaceId,
      fixture.projectId,
      proposal.id,
      `${fixture.prefix}:confirm:expired`,
    );

    expect(expired).toMatchObject({
      status: StoryAgentRunStatus.stale,
      confirmedByUserId: null,
      error: { code: 'STORY_AGENT_PROPOSAL_EXPIRED' },
    });
    expect(
      await prisma.storyProjectWriteState.findUniqueOrThrow({
        where: { storyProjectId: fixture.projectId },
      }),
    ).toMatchObject({ activeAgentRunId: null });
  });

  it('refuses grouped undo when a later human write changed the canonical head', async () => {
    const fixture = await createFixture(prisma, fixtureWorkspaceIds);
    const proposal = await fixture.authorProposal(
      'undo-source',
      'The Agent-authored premise.',
    );
    await fixture.service.confirm(
      fixture.user,
      fixture.workspaceId,
      fixture.projectId,
      proposal.id,
      `${fixture.prefix}:confirm`,
    );
    expect(
      await fixture.service.claimApplyingRuns(`${fixture.prefix}:worker`, 1),
    ).toEqual([{ id: proposal.id }]);
    await fixture.service.executeClaimedRun(
      proposal.id,
      `${fixture.prefix}:worker`,
    );

    const guard = new StoryProjectWriteGuardService(
      prisma as unknown as PrismaService,
    );
    await prisma.$transaction(async (tx) => {
      await guard.assertHumanWriteAllowed(tx, fixture.projectId);
      const current = await tx.storyDraft.findUniqueOrThrow({
        where: { storyProjectId: fixture.projectId },
      });
      const content = InteractiveFilmDraftContentSchema.parse(current.content);
      const humanContent = {
        ...content,
        storyBible: {
          ...content.storyBible,
          logline: 'A human edit moved the story head.',
        },
      };
      await tx.storyDraft.update({
        where: { storyProjectId: fixture.projectId },
        data: {
          content: humanContent as unknown as Prisma.InputJsonObject,
          contentHash: canonicalJsonHash(humanContent),
          revision: { increment: 1 },
          updatedByUserId: fixture.user.userId,
        },
      });
    });

    await expectErrorCode(
      fixture.service.undo(
        fixture.user,
        fixture.workspaceId,
        fixture.projectId,
        proposal.id,
        `${fixture.prefix}:undo`,
      ),
      'STORY_AGENT_UNDO_HEAD_CHANGED',
    );
    expect(
      await prisma.storyAgentRun.count({
        where: {
          storyProjectId: fixture.projectId,
          kind: StoryAgentRunKind.undo,
        },
      }),
    ).toBe(0);
  });
});

async function createFixture(
  prisma: ReturnType<typeof buildPrisma>,
  fixtureWorkspaceIds: Set<string>,
) {
  const prefix = `${TEST_PREFIX}-${randomUUID()}`;
  const user = { userId: `${prefix}:user`.slice(0, 64) } as AuthUser;
  const workspace = await prisma.workspace.create({
    data: {
      type: WorkspaceType.team,
      name: prefix,
      ownerUserId: user.userId,
      createdById: user.userId,
      members: {
        create: {
          userId: user.userId,
          role: WorkspaceMemberRole.owner,
        },
      },
    },
  });
  fixtureWorkspaceIds.add(workspace.id);
  const project = await prisma.storyProject.create({
    data: {
      workspaceId: workspace.id,
      format: StoryFormat.interactive_film,
      frameProfile: StoryFrameProfile.landscape_16_9,
      status: StoryProjectStatus.active,
      visibility: StoryVisibility.private,
      title: prefix,
      defaultLocale: 'en-US',
      createdByUserId: user.userId,
      members: {
        create: {
          userId: user.userId,
          role: StoryProjectMemberRole.owner,
          grantedByUserId: user.userId,
        },
      },
      draft: {
        create: {
          schemaVersion: INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION,
          content:
            EMPTY_INTERACTIVE_FILM_DRAFT_CONTENT as Prisma.InputJsonObject,
          contentHash: canonicalJsonHash(EMPTY_INTERACTIVE_FILM_DRAFT_CONTENT),
          updatedByUserId: user.userId,
        },
      },
      canvasLayout: {
        create: {
          schemaVersion: STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
          nodePositions: {},
          storyWorldNodePresent: true,
          updatedByUserId: user.userId,
        },
      },
      writeState: { create: {} },
    },
  });
  const permissions = {
    requireProject: jest.fn().mockResolvedValue({
      project: {
        id: project.id,
        workspaceId: workspace.id,
        status: StoryProjectStatus.active,
      },
      role: StoryProjectMemberRole.owner,
      capabilities: ['story.read', 'story.edit', 'story.generate'],
    }),
  } as unknown as StoryPermissionService;
  const realtime = {
    enqueue: jest
      .fn()
      .mockImplementation((_tx: unknown, run: StoryAgentRunDto) =>
        Promise.resolve({
          outboxId: `${prefix}:outbox:${run.id}`,
          eventId: `${prefix}:event:${run.id}`,
          userId: user.userId,
          event: {},
        }),
      ),
    publishCommitted: jest.fn().mockResolvedValue(undefined),
  } as unknown as StoryAgentRunRealtimeService;
  const writeGuard = new StoryProjectWriteGuardService(
    prisma as unknown as PrismaService,
  );
  const service = new StoryAgentRunService(
    prisma as unknown as PrismaService,
    permissions,
    realtime,
    writeGuard,
  );

  return {
    prefix,
    user,
    workspaceId: workspace.id,
    projectId: project.id,
    service,
    /**
     * Drive the full authoring pipeline to a reviewable proposal: file the
     * drafting brief, claim it as a worker, and land authored operations
     * against the exact canonical head the job read.
     */
    authorProposal: async (suffix: string, logline: string) => {
      const filed = await service.createAuthoringRun(
        user,
        workspace.id,
        project.id,
        {
          title: `Proposal ${suffix}`,
          summary: `Set the ${suffix} premise.`,
          brief: `Set the story bible logline to: ${logline}`,
          idempotencyKey: `${prefix}:proposal:${suffix}`,
          conversationId: `${prefix}:conversation:${suffix}`.slice(0, 180),
        },
      );
      expect(filed.status).toBe(StoryAgentRunStatus.authoring);
      const workerId = `${prefix}:author:${suffix}`;
      const claimed = await service.claimAuthoringRuns(workerId, 25);
      if (!claimed.some((row) => row.id === filed.id)) {
        throw new Error(`The authoring worker did not claim run ${filed.id}.`);
      }
      const load = await service.loadAuthoringJob(filed.id, workerId);
      if (load.kind !== 'job') {
        throw new Error(
          `Expected an authoring job for run ${filed.id}, got ${load.kind}.`,
        );
      }
      const completion = await service.completeAuthoring(filed.id, workerId, {
        operations: [
          {
            operationId: randomUUID(),
            summary: `Set the ${suffix} premise.`,
            kind: 'story_bible.update_overview',
            payload: { logline },
          },
        ],
        authoredAgainst: load.job.snapshot,
      });
      if (completion.kind !== 'completed') {
        throw new Error(
          `Authoring for run ${filed.id} did not land: ${completion.kind}.`,
        );
      }
      return completion.run;
    },
  };
}

async function createActiveDraftReleaseReceipt(
  prisma: Prisma.TransactionClient,
  fixture: Awaited<ReturnType<typeof createFixture>>,
) {
  const revision = await prisma.storyRevision.create({
    data: {
      storyProjectId: fixture.projectId,
      number: 1,
      sourceDraftRevision: 0,
      schemaVersion: INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION,
      content: EMPTY_INTERACTIVE_FILM_DRAFT_CONTENT as Prisma.InputJsonObject,
      contentHash: canonicalJsonHash(EMPTY_INTERACTIVE_FILM_DRAFT_CONTENT),
      source: StoryRevisionSource.creator,
      createdByUserId: fixture.user.userId,
    },
  });
  const buildId = randomUUID();
  const gameId = `${fixture.prefix}:game`;
  const contentVersion = `${fixture.prefix}:version`;
  const runtimeJson = {
    channel: 'production',
    buildId,
    gameId,
    contentVersion,
  };
  const buildCompletedAt = new Date();
  const build = await prisma.storyBuild.create({
    data: {
      id: buildId,
      storyProjectId: fixture.projectId,
      sourceRevisionId: revision.id,
      buildNumber: 1,
      submissionKey: `${fixture.prefix}:external-intent-build`,
      requestFingerprint: '1'.repeat(64),
      kind: StoryBuildKind.production,
      scope: { kind: 'full' },
      sourceDraftRevision: 0,
      videoSnapshotHash: '2'.repeat(64),
      status: StoryBuildStatus.ready,
      inputHash: '3'.repeat(64),
      inputManifestHash: '4'.repeat(64),
      runtimeSchemaVersion: 2,
      runtimeJson,
      runtimeHash: canonicalJsonHash(runtimeJson),
      completedAt: buildCompletedAt,
      createdByUserId: fixture.user.userId,
    },
  });
  const [clock] = await prisma.$queryRaw<Array<{ now: Date }>>`
    SELECT transaction_timestamp() AS "now"
  `;
  const now = clock.now;
  const receipt = await prisma.storyExperienceDraftRelease.create({
    data: {
      buildId: build.id,
      storyProjectId: fixture.projectId,
      gameId,
      contentVersion,
      requestHash: '5'.repeat(64),
      status: StoryExperiencePublicationStatus.pending,
      requestedByUserId: fixture.user.userId,
      createdAt: now,
      updatedAt: now,
    },
  });
  const attemptedAt = new Date(now.getTime() + 1_000);
  return prisma.storyExperienceDraftRelease.update({
    where: { id: receipt.id },
    data: {
      attemptCount: 1,
      firstAttemptAt: attemptedAt,
      lastAttemptAt: attemptedAt,
      lastAttemptedByUserId: fixture.user.userId,
      leaseOwner: `${fixture.prefix}:external-intent`,
      leaseAcquiredAt: attemptedAt,
      leaseExpiresAt: new Date(attemptedAt.getTime() + 30_000),
      updatedAt: attemptedAt,
    },
  });
}

function storyAgentServiceBoundToTransaction(
  tx: Prisma.TransactionClient,
  fixture: Awaited<ReturnType<typeof createFixture>>,
): StoryAgentRunService {
  const prisma = new Proxy(tx, {
    get(target, property, receiver) {
      if (property === '$transaction') {
        return (
          callback: (transaction: Prisma.TransactionClient) => Promise<unknown>,
        ) => callback(tx);
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return value;
    },
  }) as unknown as PrismaService;
  const realtime = {
    enqueue: jest
      .fn()
      .mockImplementation((_transaction: unknown, run: StoryAgentRunDto) =>
        Promise.resolve({
          outboxId: `${fixture.prefix}:tx-outbox:${run.id}`,
          eventId: `${fixture.prefix}:tx-event:${run.id}`,
          userId: fixture.user.userId,
          event: {},
        }),
      ),
    publishCommitted: jest.fn().mockResolvedValue(undefined),
  } as unknown as StoryAgentRunRealtimeService;
  return new StoryAgentRunService(
    prisma,
    {} as StoryPermissionService,
    realtime,
    new StoryProjectWriteGuardService(prisma),
  );
}

async function expectLocked(
  promise: Promise<unknown>,
  expectedRunId: string,
): Promise<void> {
  try {
    await promise;
    throw new Error('Expected the human write to be locked.');
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    const exception = error as HttpException;
    expect(exception.getStatus()).toBe(HttpStatus.LOCKED);
    expect(exception.getResponse()).toEqual(
      expect.objectContaining({
        code: 'STORY_AGENT_APPLYING',
        runId: expectedRunId,
      }),
    );
  }
}

async function expectErrorCode(
  promise: Promise<unknown>,
  expectedCode: string,
): Promise<void> {
  await expectErrorResponse(promise, { code: expectedCode });
}

async function expectErrorResponse(
  promise: Promise<unknown>,
  expectedResponse: Record<string, unknown>,
): Promise<void> {
  try {
    await promise;
    throw new Error(
      `Expected request to fail with ${String(expectedResponse.code)}.`,
    );
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    const response = (error as HttpException).getResponse();
    expect(response).toEqual(
      expect.objectContaining(expectedResponse) as unknown,
    );
  }
}

function assertDedicatedLocalPostgres(rawUrl: string): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(
      'Story Agent PostgreSQL integration tests require a valid DATABASE_URL.',
    );
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '::1'].includes(url.hostname) ||
    url.port !== '5433'
  ) {
    throw new Error(
      'Refusing Story Agent integration tests: DATABASE_URL must target PostgreSQL on localhost:5433.',
    );
  }
  process.env.DATABASE_URL = rawUrl;
}

function jsonStructuredClone<T>(value: T): T {
  const parsed = JSON.parse(JSON.stringify(value)) as unknown;
  return parsed as T;
}

async function assertStoryAgentMigrationPresent(
  prisma: ReturnType<typeof buildPrisma>,
): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ tableName: string | null }>>`
    SELECT to_regclass('public.story_agent_runs')::text AS "tableName"
  `;
  if (rows[0]?.tableName !== 'story_agent_runs') {
    throw new Error(
      'Local PostgreSQL is missing the Story Agent migration. Run the local migration command first.',
    );
  }
  const hardening = await prisma.$queryRaw<
    Array<{
      expiresAt: string | null;
      scopeIndex: string | null;
      undoHeadIndex: string | null;
    }>
  >`
    SELECT
      (
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'story_agent_runs'
          AND column_name = 'expires_at'
      ) AS "expiresAt",
      to_regclass(
        'public.story_agent_runs_active_conversation_proposal_unique'
      )::text AS "scopeIndex",
      to_regclass(
        'public.story_agent_runs_undo_head_idx'
      )::text AS "undoHeadIndex"
  `;
  if (
    hardening[0]?.expiresAt !== 'expires_at' ||
    hardening[0]?.scopeIndex !==
      'story_agent_runs_active_conversation_proposal_unique' ||
    hardening[0]?.undoHeadIndex !== 'story_agent_runs_undo_head_idx'
  ) {
    throw new Error(
      'Local PostgreSQL is missing Story Agent proposal lifecycle hardening. Run the local migration command first.',
    );
  }
}

async function removeAbandonedFixtures(
  prisma: ReturnType<typeof buildPrisma>,
): Promise<void> {
  const workspaces = await prisma.workspace.findMany({
    where: {
      name: { startsWith: `${TEST_PREFIX}-` },
      ownerUserId: { startsWith: `${TEST_PREFIX}-` },
    },
    select: { id: true },
  });
  await cleanupFixtures(
    prisma,
    workspaces.map((workspace) => workspace.id),
  );
}

async function cleanupFixtures(
  prisma: ReturnType<typeof buildPrisma>,
  workspaceIds: string[],
): Promise<void> {
  if (workspaceIds.length === 0) return;
  const projects = await prisma.storyProject.findMany({
    where: { workspaceId: { in: workspaceIds } },
    select: { id: true },
  });
  const projectIds = projects.map((project) => project.id);
  if (projectIds.length > 0) {
    await prisma.storyProjectWriteState.updateMany({
      where: { storyProjectId: { in: projectIds } },
      data: {
        activeAgentRunId: null,
        lockedAt: null,
        lockExpiresAt: null,
      },
    });
    await prisma.storyAgentRun.deleteMany({
      where: { storyProjectId: { in: projectIds } },
    });
    await prisma.storyProject.deleteMany({
      where: { id: { in: projectIds } },
    });
  }
  await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
}
