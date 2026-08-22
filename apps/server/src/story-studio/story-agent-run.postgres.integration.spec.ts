import { HttpException, HttpStatus } from '@nestjs/common';
import {
  Prisma,
  StoryAgentRunKind,
  StoryAgentRunStatus,
  StoryBuildKind,
  StoryBuildStatus,
  StoryDurationPreset,
  StoryExperiencePublicationStatus,
  StoryFrameProfile,
  StoryProjectMemberRole,
  StoryProjectStatus,
  StoryRevisionSource,
  StoryVisualStyle,
  StoryVisibility,
  StudioDocumentOperationType,
  StudioDocumentType,
  StudioDocumentVersionSource,
  WorkspaceMemberRole,
  WorkspaceType,
} from '@prisma/client';
import {
  STORY_SCREENPLAY_SCHEMA_VERSION,
  buildStoryScreenplayDocument,
  type StoryAgentRunDto,
  type StoryScreenplay,
} from '@repo/shared/story-agent';
import {
  STORY_PRODUCTION_PLAN_SCHEMA_VERSION,
  type StoryProductionPlan,
} from '@repo/shared/story-production';
import { config as loadEnv } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import * as Y from 'yjs';
import type { AuthUser } from '../auth';
import {
  AgentOsRunJournalService,
  storyProposalApprovalId,
} from '../agent-os-journal/agent-os-run-journal.service';
import { buildPrisma, type PrismaService } from '../infra/db/db.module';
import { ensureStoryScriptDocumentInTransaction } from '../documents/story-script-document';
import { canonicalJsonHash } from './canonical-json';
import {
  EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT,
  INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
  InteractiveStoryDraftContentSchema,
  STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
} from './dto';
import type { StoryAgentRunRealtimeService } from './story-agent-run-realtime.service';
import { StoryAgentRunContinuationWorkerService } from './story-agent-run-continuation-worker.service';
import { StoryAgentRunService } from './story-agent-run.service';
import type { StoryPermissionService } from './story-permission.service';
import { StoryProjectWriteGuardService } from './story-project-write-guard.service';
import { StoryProductionPlanService } from './story-production-plan.service';
import { readStoryScriptHead } from './story-script-stage';

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

  it('converges concurrent legacy Script provisioning on one durable chapter identity', async () => {
    const fixture = await createFixture(prisma, fixtureWorkspaceIds);

    const [first, second] = await Promise.all([
      prisma.$transaction((tx) =>
        ensureStoryScriptDocumentInTransaction(tx, {
          workspaceId: fixture.workspaceId,
          storyProjectId: fixture.projectId,
          storyChapterId: fixture.chapterId,
          actorUserId: fixture.user.userId,
        }),
      ),
      prisma.$transaction((tx) =>
        ensureStoryScriptDocumentInTransaction(tx, {
          workspaceId: fixture.workspaceId,
          storyProjectId: fixture.projectId,
          storyChapterId: fixture.chapterId,
          actorUserId: fixture.user.userId,
        }),
      ),
    ]);

    expect(first.document.id).toBe(second.document.id);
    expect([first.created, second.created].sort()).toEqual([false, true]);
    await expect(
      prisma.studioDocument.count({
        where: {
          storyProjectId: fixture.projectId,
          storyChapterId: fixture.chapterId,
          type: StudioDocumentType.script,
        },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.studioDocumentVersion.count({
        where: { documentId: first.document.id },
      }),
    ).resolves.toBe(1);
  });

  it('reports stale_base instead of landing operations when a human write advances the head during drafting', async () => {
    const fixture = await createFixture(prisma, fixtureWorkspaceIds);
    const filed = await fixture.service.createAuthoringRun(
      fixture.user,
      fixture.workspaceId,
      fixture.projectId,
      {
        chapterId: fixture.chapterId,
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
      const content = InteractiveStoryDraftContentSchema.parse(current.content);
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

  it('persists the approved screenplay before deriving the Plot Tree and records exact lineage', async () => {
    const fixture = await createFixture(prisma, fixtureWorkspaceIds);
    const filed = await fixture.service.createAuthoringRun(
      fixture.user,
      fixture.workspaceId,
      fixture.projectId,
      {
        chapterId: fixture.chapterId,
        title: 'The sealed order',
        summary: 'Review the screenplay before deriving the graph.',
        brief: 'Write a one-scene interactive screenplay.',
        idempotencyKey: `${fixture.prefix}:screenplay`,
        conversationId: `${fixture.prefix}:conversation:screenplay`,
      },
    );
    const authorWorker = `${fixture.prefix}:author:screenplay`;
    expect(await fixture.service.claimAuthoringRuns(authorWorker, 1)).toEqual([
      { id: filed.id },
    ]);
    const loaded = await fixture.service.loadAuthoringJob(
      filed.id,
      authorWorker,
    );
    if (loaded.kind !== 'job')
      throw new Error(`Expected job, got ${loaded.kind}.`);

    const screenplay: StoryScreenplay = {
      schemaVersion: STORY_SCREENPLAY_SCHEMA_VERSION,
      storyLanguage: 'en-US',
      title: 'The Sealed Order',
      logline: 'A city guard must choose between duty and mercy.',
      synopsis: 'At a city gate, one sealed order decides who may escape.',
      characters: [
        {
          id: 'guard',
          name: { 'en-US': 'Guard' },
          summary: 'A weary officer at the city gate.',
        },
      ],
      entrySceneId: 'city-gate',
      scenes: [
        {
          nodeId: 'city-gate',
          clipKey: 'CITY_GATE',
          name: 'The order',
          heading: 'EXT. CITY GATE – NIGHT',
          beat: 'The guard opens the order.',
          action: 'Rain strikes the paper while the refugees wait.',
          dialogue: [
            {
              characterId: 'guard',
              speaker: 'GUARD',
              text: 'Open the gate.',
            },
          ],
          exit: { kind: 'auto', nextNodeId: null },
        },
      ],
    };
    const productionPlan: StoryProductionPlan = {
      schemaVersion: STORY_PRODUCTION_PLAN_SCHEMA_VERSION,
      assetSpecs: [
        {
          stableKey: 'asset.character.guard',
          kind: 'character',
          name: 'Guard',
          description: 'A weary city guard in rain-dark armour.',
          imagePrompt: 'A neutral full-body reference of the city guard.',
          sourceCharacterId: 'guard',
          sourceNodeIds: ['city-gate'],
        },
      ],
      storyboardSequences: [
        {
          plotNodeId: 'city-gate',
          title: 'The order',
          description: 'The guard opens the sealed order in the rain.',
          durationMs: 10_000,
          clips: [
            {
              stableKey: 'shot.city-gate.main',
              kind: 'video',
              title: 'The sealed order',
              description: 'The guard opens the sealed order in the rain.',
              startMs: 0,
              durationMs: 10_000,
              videoPrompt:
                'A cinematic @asset.character.guard opens a sealed order in heavy rain.',
            },
          ],
          cues: [],
        },
      ],
    };
    const completed = await fixture.service.completeAuthoring(
      filed.id,
      authorWorker,
      {
        screenplay,
        authoredAgainst: loaded.job.snapshot,
      },
    );
    expect(completed.kind).toBe('completed');
    if (completed.kind !== 'completed') return;
    expect(completed.run.proposal).toMatchObject({
      screenplay,
      document: buildStoryScreenplayDocument(screenplay),
    });
    expect(completed.run.proposal).not.toHaveProperty('productionPlan');

    // Opening the Script page after drafting goes through the exact same
    // ensure path. It must return the identity pinned in the proposal instead
    // of creating a new empty document that would make approval stale.
    const ensuredAfterDraft = await prisma.$transaction((tx) =>
      ensureStoryScriptDocumentInTransaction(tx, {
        workspaceId: fixture.workspaceId,
        storyProjectId: fixture.projectId,
        storyChapterId: fixture.chapterId,
        actorUserId: fixture.user.userId,
      }),
    );
    expect(loaded.job.snapshot.scriptDocumentId).not.toBeNull();
    expect(ensuredAfterDraft).toMatchObject({
      created: false,
      document: { id: loaded.job.snapshot.scriptDocumentId },
    });

    await fixture.service.confirm(
      fixture.user,
      fixture.workspaceId,
      fixture.projectId,
      filed.id,
      `${fixture.prefix}:confirm:screenplay`,
    );
    const applyWorker = `${fixture.prefix}:apply:screenplay`;
    expect(await fixture.service.claimApplyingRuns(applyWorker, 1)).toEqual([
      { id: filed.id },
    ]);
    await fixture.service.executeClaimedRun(filed.id, applyWorker);

    const [scriptOnlyRun, scriptOnlyDocument, scriptOnlyDraft] =
      await Promise.all([
        prisma.storyAgentRun.findUniqueOrThrow({ where: { id: filed.id } }),
        prisma.studioDocument.findFirstOrThrow({
          where: {
            storyProjectId: fixture.projectId,
            storyChapterId: fixture.chapterId,
            type: StudioDocumentType.script,
          },
        }),
        prisma.storyDraft.findUniqueOrThrow({
          where: { storyProjectId: fixture.projectId },
        }),
      ]);
    expect(scriptOnlyRun).toMatchObject({
      status: StoryAgentRunStatus.authoring,
      authoringMode: 'downstream_reconcile',
    });
    expect(scriptOnlyDocument.currentSequence).toBe(1);
    expect(
      InteractiveStoryDraftContentSchema.parse(
        scriptOnlyDraft.content,
      ).graph.nodes.some((node) => node.nodeId === 'city-gate'),
    ).toBe(false);
    await expect(
      prisma.storyAssetSpec.count({
        where: { storyChapterId: fixture.chapterId },
      }),
    ).resolves.toBe(0);
    await expect(
      prisma.storyStoryboardSequence.count({
        where: { storyChapterId: fixture.chapterId },
      }),
    ).resolves.toBe(0);

    // The same durable run is recoverable after the Script-only commit. A
    // different worker/pod may claim it and derive downstream production from
    // the exact approved snapshot; no second approval is opened.
    const downstreamWorker = `${fixture.prefix}:author:downstream`;
    expect(
      await fixture.service.claimAuthoringRuns(downstreamWorker, 1),
    ).toEqual([{ id: filed.id }]);
    const downstream = await fixture.service.loadAuthoringJob(
      filed.id,
      downstreamWorker,
    );
    if (downstream.kind !== 'job') {
      throw new Error(`Expected downstream job, got ${downstream.kind}.`);
    }
    expect(downstream.job).toMatchObject({
      mode: 'downstream_reconcile',
      approvedScreenplay: { screenplay },
      scriptSource: null,
    });
    await expect(
      fixture.service.completeAutomaticAuthoring(filed.id, downstreamWorker, {
        mode: 'downstream_reconcile',
        productionPlan,
        authoredAgainst: downstream.job.snapshot,
      }),
    ).resolves.toMatchObject({
      kind: 'completed',
      run: { status: StoryAgentRunStatus.applying },
    });
    const downstreamApplyWorker = `${fixture.prefix}:apply:downstream`;
    expect(
      await fixture.service.claimApplyingRuns(downstreamApplyWorker, 1),
    ).toEqual([{ id: filed.id }]);
    await fixture.service.executeClaimedRun(filed.id, downstreamApplyWorker);

    const [run, script, draft, chapter, assetSpecs, storyboardSequences] =
      await Promise.all([
        prisma.storyAgentRun.findUniqueOrThrow({ where: { id: filed.id } }),
        prisma.studioDocument.findFirstOrThrow({
          where: {
            storyProjectId: fixture.projectId,
            storyChapterId: fixture.chapterId,
            type: StudioDocumentType.script,
          },
          include: { operations: { orderBy: { sequence: 'asc' } } },
        }),
        prisma.storyDraft.findUniqueOrThrow({
          where: { storyProjectId: fixture.projectId },
        }),
        prisma.storyChapter.findUniqueOrThrow({
          where: { id: fixture.chapterId },
        }),
        prisma.storyAssetSpec.findMany({
          where: { storyChapterId: fixture.chapterId },
        }),
        prisma.storyStoryboardSequence.findMany({
          where: { storyChapterId: fixture.chapterId },
          include: {
            clips: { include: { assetBindings: true } },
            cues: true,
          },
        }),
      ]);
    const currentVersion = await prisma.studioDocumentVersion.findUniqueOrThrow(
      {
        where: { id: script.currentVersionId! },
      },
    );
    expect(run.status).toBe(StoryAgentRunStatus.succeeded);
    expect(assetSpecs).toHaveLength(1);
    expect(assetSpecs[0]).toMatchObject({
      stableKey: 'asset.character.guard',
      selectedMediaVersionId: null,
    });
    expect(storyboardSequences).toHaveLength(1);
    expect(storyboardSequences[0]).toMatchObject({
      plotNodeId: 'city-gate',
      durationMs: 10_000,
      clips: [
        expect.objectContaining({
          stableKey: 'shot.city-gate.main',
          assetBindings: [
            expect.objectContaining({
              mode: 'follow_selected',
              pinnedMediaVersionId: null,
            }),
          ],
        }),
      ],
    });
    expect(script).toMatchObject({
      currentSequence: 1,
      title: screenplay.title,
      storyChapterId: fixture.chapterId,
    });
    await expect(
      prisma.studioDocument.count({
        where: {
          storyProjectId: fixture.projectId,
          type: StudioDocumentType.script,
        },
      }),
    ).resolves.toBe(1);
    expect(currentVersion).toMatchObject({
      source: StudioDocumentVersionSource.ai,
      sourceId: filed.id,
      sequence: 1,
      snapshot: {
        screenplay,
        document: buildStoryScreenplayDocument(screenplay),
      },
    });
    expect(script.operations).toHaveLength(1);
    expect(script.operations[0]).toMatchObject({
      sequence: 1,
      operationType: StudioDocumentOperationType.yjs_update,
      idempotencyKey: `story-screenplay:${filed.id}`,
    });
    expect(chapter).toMatchObject({
      sourceScriptDocumentId: script.id,
      sourceScriptVersionId: script.currentVersionId,
      sourceScriptSequence: 1,
    });
    const draftContent = InteractiveStoryDraftContentSchema.parse(
      draft.content,
    );
    const compiledScene = draftContent.graph.nodes.find(
      (node) => node.nodeId === 'city-gate',
    );
    expect(compiledScene?.kind).toBe('clip');
    if (compiledScene?.kind !== 'clip') {
      throw new Error('Expected the compiled city-gate Plot clip.');
    }
    expect(compiledScene.description).toContain('EXT. CITY GATE – NIGHT');
    await expect(
      fixture.productionPlans.getProductionState(
        fixture.user,
        fixture.workspaceId,
        fixture.projectId,
        fixture.chapterId,
      ),
    ).resolves.toMatchObject({ ready: true });

    const ydoc = new Y.Doc();
    if (script.crdtState) Y.applyUpdate(ydoc, script.crdtState);
    for (const operation of script.operations) {
      if (operation.yjsUpdate) Y.applyUpdate(ydoc, operation.yjsUpdate);
    }
    const scriptJson = ydoc.getXmlFragment('content').toJSON();
    let previousBlockIndex = -1;
    for (const block of buildStoryScreenplayDocument(screenplay).blocks) {
      const blockIndex = scriptJson.indexOf(block.text, previousBlockIndex + 1);
      expect(blockIndex).toBeGreaterThan(previousBlockIndex);
      previousBlockIndex = blockIndex;
    }
    ydoc.destroy();

    // A later human Script edit invalidates only the structured lineage. The
    // exact collaborative Script becomes the next downstream source; the
    // Agent must not reopen screenplay approval or append another Script
    // operation while rebuilding Plot/specs.
    const manualDoc = new Y.Doc();
    if (script.crdtState) Y.applyUpdate(manualDoc, script.crdtState);
    for (const operation of script.operations) {
      if (operation.yjsUpdate) Y.applyUpdate(manualDoc, operation.yjsUpdate);
    }
    const priorVector = Y.encodeStateVector(manualDoc);
    const paragraph = new Y.XmlElement('paragraph');
    const paragraphText = new Y.XmlText();
    paragraphText.insert(
      0,
      'CREATOR NOTE: The refugees carry a blue lantern through the rain.',
    );
    paragraph.insert(0, [paragraphText]);
    manualDoc
      .getXmlFragment('content')
      .insert(manualDoc.getXmlFragment('content').length, [paragraph]);
    const manualUpdate = Y.encodeStateAsUpdate(manualDoc, priorVector);
    manualDoc.destroy();
    await prisma.$transaction(async (tx) => {
      await tx.studioDocumentOperation.create({
        data: {
          documentId: script.id,
          sequence: 2,
          operationType: StudioDocumentOperationType.yjs_update,
          actorUserId: fixture.user.userId,
          idempotencyKey: `${fixture.prefix}:manual-script-edit`,
          baseSequence: 1,
          yjsUpdate: Buffer.from(manualUpdate),
          metadata: { source: 'creator' },
        },
      });
      await tx.studioDocument.update({
        where: { id: script.id },
        data: {
          currentSequence: 2,
          updatedById: fixture.user.userId,
        },
      });
    });
    const editedHead = await prisma.$transaction((tx) =>
      readStoryScriptHead(tx, fixture.projectId, fixture.chapterId),
    );
    expect(editedHead).toMatchObject({
      documentId: script.id,
      sequence: 2,
      hasContent: true,
    });

    const manualRun = await fixture.service.createAuthoringRun(
      fixture.user,
      fixture.workspaceId,
      fixture.projectId,
      {
        chapterId: fixture.chapterId,
        title: 'Rebuild from creator Script',
        summary: 'Use the current Script exactly as the source.',
        brief: 'Reconcile downstream production from the current Script.',
        idempotencyKey: `${fixture.prefix}:manual-reconcile`,
        conversationId: `${fixture.prefix}:conversation:manual-reconcile`,
      },
    );
    const manualWorker = `${fixture.prefix}:author:manual-reconcile`;
    expect(await fixture.service.claimAuthoringRuns(manualWorker, 1)).toEqual([
      { id: manualRun.id },
    ]);
    const manualJob = await fixture.service.loadAuthoringJob(
      manualRun.id,
      manualWorker,
    );
    if (manualJob.kind !== 'job') {
      throw new Error(`Expected manual Script job, got ${manualJob.kind}.`);
    }
    expect(manualJob.job).toMatchObject({
      mode: 'downstream_reconcile',
      approvedScreenplay: null,
      scriptSource: {
        documentId: script.id,
        sequence: 2,
        hash: editedHead.hash,
        hasContent: true,
      },
    });
    expect(manualJob.job.scriptSource?.sourceText).toContain(
      'CREATOR NOTE: The refugees carry a blue lantern',
    );
    await expect(
      fixture.service.completeAutomaticAuthoring(manualRun.id, manualWorker, {
        mode: 'downstream_reconcile',
        screenplay,
        productionPlan,
        authoredAgainst: manualJob.job.snapshot,
      }),
    ).resolves.toMatchObject({
      kind: 'completed',
      run: { status: StoryAgentRunStatus.applying },
    });
    const manualApplyWorker = `${fixture.prefix}:apply:manual-reconcile`;
    expect(
      await fixture.service.claimApplyingRuns(manualApplyWorker, 1),
    ).toEqual([{ id: manualRun.id }]);
    await fixture.service.executeClaimedRun(manualRun.id, manualApplyWorker);

    const [manualCompleted, preservedScript, preservedHead, productionState] =
      await Promise.all([
        prisma.storyAgentRun.findUniqueOrThrow({
          where: { id: manualRun.id },
        }),
        prisma.studioDocument.findUniqueOrThrow({
          where: { id: script.id },
          include: { operations: true },
        }),
        prisma.$transaction((tx) =>
          readStoryScriptHead(tx, fixture.projectId, fixture.chapterId),
        ),
        fixture.productionPlans.getProductionState(
          fixture.user,
          fixture.workspaceId,
          fixture.projectId,
          fixture.chapterId,
        ),
      ]);
    expect(manualCompleted.status).toBe(StoryAgentRunStatus.succeeded);
    expect(preservedScript.currentSequence).toBe(2);
    expect(preservedScript.operations).toHaveLength(2);
    expect(preservedHead.hash).toBe(editedHead.hash);
    expect(productionState.ready).toBe(true);
  });

  it('applies an Agent change to one chapter without replacing scenes owned by another chapter', async () => {
    const fixture = await createFixture(prisma, fixtureWorkspaceIds);
    const secondNodeId = 'chapter-two-scene';
    const projectContent = InteractiveStoryDraftContentSchema.parse({
      ...EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT,
      graph: {
        entryNodeId: null,
        nodes: [
          {
            kind: 'clip',
            nodeId: secondNodeId,
            clipKey: 'CHAPTER_TWO_SCENE',
            description: 'The second chapter waits beyond the gate.',
            exit: { kind: 'auto', nextNodeId: null },
          },
        ],
      },
    });
    const secondChapter = await prisma.storyChapter.create({
      data: {
        storyProjectId: fixture.projectId,
        title: 'Chapter 2',
        rank: 1,
        nodeIds: [secondNodeId],
        entryNodeId: secondNodeId,
        createdByUserId: fixture.user.userId,
      },
    });
    await prisma.storyCanvasLayout.create({
      data: {
        storyChapterId: secondChapter.id,
        storyProjectId: fixture.projectId,
        workspaceId: fixture.workspaceId,
        schemaVersion: STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
        nodePositions: {},
        updatedByUserId: fixture.user.userId,
      },
    });
    await prisma.storyDraft.update({
      where: { storyProjectId: fixture.projectId },
      data: {
        content: projectContent as Prisma.InputJsonObject,
        contentHash: canonicalJsonHash(projectContent),
        revision: { increment: 1 },
      },
    });

    const proposal = await fixture.authorProposal(
      'chapter-isolation',
      'The first chapter remembers the second.',
    );
    await fixture.service.confirm(
      fixture.user,
      fixture.workspaceId,
      fixture.projectId,
      proposal.id,
      `${fixture.prefix}:confirm:chapter-isolation`,
    );
    const workerId = `${fixture.prefix}:worker:chapter-isolation`;
    expect(await fixture.service.claimApplyingRuns(workerId, 1)).toEqual([
      { id: proposal.id },
    ]);
    await fixture.service.executeClaimedRun(proposal.id, workerId);

    const saved = await prisma.storyDraft.findUniqueOrThrow({
      where: { storyProjectId: fixture.projectId },
    });
    const savedContent = InteractiveStoryDraftContentSchema.parse(
      saved.content,
    );
    expect(savedContent.storyBible.logline).toBe(
      'The first chapter remembers the second.',
    );
    expect(savedContent.graph.nodes).toContainEqual(
      expect.objectContaining({ nodeId: secondNodeId }),
    );
    await expect(
      prisma.storyChapter.findUniqueOrThrow({
        where: { id: secondChapter.id },
      }),
    ).resolves.toMatchObject({ nodeIds: [secondNodeId] });
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
      InteractiveStoryDraftContentSchema.parse(draft.content).storyBible
        .logline,
    ).toMatch(/^The (first|second) premise\.$/);
    expect(
      runs.filter((run) => run.status === StoryAgentRunStatus.succeeded),
    ).toHaveLength(1);
    expect(
      runs.filter((run) => run.status === StoryAgentRunStatus.stale),
    ).toHaveLength(1);
    expect(state.activeAgentRunId).toBeNull();
  });

  it('lets only one continuation worker across pods append and deliver an external Story job', async () => {
    const fixture = await createFixture(prisma, fixtureWorkspaceIds);
    const handoff = await createExternalHandoffFixture(prisma, fixture);
    const schedule = jest.fn();
    const journal = new AgentOsRunJournalService(
      prisma as unknown as PrismaService,
      { schedule } as never,
    );
    const firstPod = new StoryAgentRunContinuationWorkerService(
      prisma as unknown as PrismaService,
      journal,
    );
    const secondPod = new StoryAgentRunContinuationWorkerService(
      prisma as unknown as PrismaService,
      journal,
    );

    await Promise.all([firstPod.drainOnce(1), secondPod.drainOnce(1)]);

    const storyRun = await prisma.storyAgentRun.findUniqueOrThrow({
      where: { id: handoff.storyRunId },
    });
    expect(storyRun.sourceProposalReadyDeliveredAt).not.toBeNull();
    expect(storyRun.sourceTerminalDeliveredAt).toBeNull();
    expect(storyRun.sourceResultDeliveryAttempts).toBe(0);
    expect(storyRun.sourceResultDeliveryLeaseOwner).toBeNull();
    await expect(
      prisma.agentOsRun.findUniqueOrThrow({
        where: { id: handoff.agentRunId },
      }),
    ).resolves.toMatchObject({
      status: 'waiting_for_approval',
      lastSequence: 7,
    });
    await expect(
      prisma.agentOsRunEvent.count({
        where: { runId: handoff.agentRunId },
      }),
    ).resolves.toBe(7);
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledWith(handoff.agentRunId);
  });

  it('atomically closes the Story row and Agent approval when a pending v2 proposal expires', async () => {
    const fixture = await createFixture(prisma, fixtureWorkspaceIds);
    const handoff = await createExternalHandoffFixture(prisma, fixture);
    const worker = new StoryAgentRunContinuationWorkerService(
      prisma as unknown as PrismaService,
      fixture.agentOsJournal,
    );
    await worker.drainOnce(1);
    await expect(
      prisma.agentOsRun.findUniqueOrThrow({
        where: { id: handoff.agentRunId },
      }),
    ).resolves.toMatchObject({ status: 'waiting_for_approval' });

    await prisma.$transaction(async (tx) => {
      const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`
        SELECT transaction_timestamp() AS "now"
      `;
      await tx.storyAgentRun.update({
        where: { id: handoff.storyRunId },
        data: {
          proposedAt: new Date(clock.now.getTime() - 120_000),
          expiresAt: new Date(clock.now.getTime() - 60_000),
        },
      });
    });

    await fixture.service.expireProposals(1);

    const [storyRun, agentRun, terminalEvents] = await Promise.all([
      prisma.storyAgentRun.findUniqueOrThrow({
        where: { id: handoff.storyRunId },
      }),
      prisma.agentOsRun.findUniqueOrThrow({
        where: { id: handoff.agentRunId },
      }),
      prisma.agentOsRunEvent.findMany({
        where: {
          runId: handoff.agentRunId,
          type: { in: ['ToolFailed', 'RunCancelled'] },
        },
        orderBy: { sequence: 'asc' },
        select: { type: true },
      }),
    ]);
    expect(storyRun).toMatchObject({
      status: StoryAgentRunStatus.stale,
      errorCode: 'STORY_AGENT_PROPOSAL_EXPIRED',
      sourceApprovalId: null,
    });
    expect(storyRun.sourceTerminalDeliveredAt).toBeInstanceOf(Date);
    expect(agentRun).toMatchObject({
      status: 'cancelled',
      pendingApproval: null,
    });
    expect(terminalEvents).toEqual([
      { type: 'ToolFailed' },
      { type: 'RunCancelled' },
    ]);
  });

  it('commits exactly one durable response when two pods race the same v2 approval', async () => {
    const fixture = await createFixture(prisma, fixtureWorkspaceIds);
    const handoff = await createExternalHandoffFixture(prisma, fixture);
    const worker = new StoryAgentRunContinuationWorkerService(
      prisma as unknown as PrismaService,
      fixture.agentOsJournal,
    );
    await worker.drainOnce(1);

    const approvalId = storyProposalApprovalId(handoff.storyRunId);
    const firstResponseId = randomUUID();
    const secondResponseId = randomUUID();
    const decisions = await Promise.allSettled([
      fixture.service.resolveAgentOsProposalDecision({
        user: fixture.user,
        workspaceId: fixture.workspaceId,
        projectId: fixture.projectId,
        agentRunId: handoff.agentRunId,
        conversationId: handoff.conversationId,
        storyRunId: handoff.storyRunId,
        approvalId,
        responseId: firstResponseId,
        responseText: 'Discard this proposal.',
        locale: 'en-US',
        decision: 'reject',
      }),
      fixture.service.resolveAgentOsProposalDecision({
        user: fixture.user,
        workspaceId: fixture.workspaceId,
        projectId: fixture.projectId,
        agentRunId: handoff.agentRunId,
        conversationId: handoff.conversationId,
        storyRunId: handoff.storyRunId,
        approvalId,
        responseId: secondResponseId,
        responseText: '放弃这个提案。',
        locale: 'zh-CN',
        decision: 'reject',
      }),
    ]);

    expect(
      decisions.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      decisions.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    const storyRun = await prisma.storyAgentRun.findUniqueOrThrow({
      where: { id: handoff.storyRunId },
    });
    expect(storyRun).toMatchObject({
      status: StoryAgentRunStatus.cancelled,
      sourceApprovalId: approvalId,
      sourceApprovalDecision: 'reject',
    });
    expect(storyRun.sourceTerminalDeliveredAt).toBeInstanceOf(Date);
    expect([firstResponseId, secondResponseId]).toContain(
      storyRun.sourceApprovalResponseId,
    );
    await expect(
      prisma.agentOsRun.findUniqueOrThrow({
        where: { id: handoff.agentRunId },
      }),
    ).resolves.toMatchObject({ status: 'completed' });
    const decisionEvents = await prisma.agentOsRunEvent.groupBy({
      by: ['type'],
      where: {
        runId: handoff.agentRunId,
        type: { in: ['UserMessage', 'ApprovalResolved', 'RunCompleted'] },
      },
      _count: { _all: true },
    });
    expect(
      Object.fromEntries(
        decisionEvents.map((event) => [event.type, event._count._all]),
      ),
    ).toEqual({ UserMessage: 1, ApprovalResolved: 1, RunCompleted: 1 });
  });

  it('repairs a crash before RunPaused and commits the handoff plus approval pause atomically', async () => {
    const fixture = await createFixture(prisma, fixtureWorkspaceIds);
    const handoff = await createExternalHandoffFixture(prisma, fixture, {
      leaveHandoffUnreconciled: true,
    });
    const schedule = jest.fn();
    const journal = new AgentOsRunJournalService(
      prisma as unknown as PrismaService,
      { schedule } as never,
    );
    const worker = new StoryAgentRunContinuationWorkerService(
      prisma as unknown as PrismaService,
      journal,
    );

    await worker.drainOnce(1);

    const deliveredStoryRun = await prisma.storyAgentRun.findUniqueOrThrow({
      where: { id: handoff.storyRunId },
    });
    expect(deliveredStoryRun).toMatchObject({
      sourceResultDeliveryAttempts: 0,
      sourceTerminalDeliveredAt: null,
      sourceResultDeliveryLeaseOwner: null,
      sourceResultDeliveryLastError: null,
    });
    expect(deliveredStoryRun.sourceProposalReadyDeliveredAt).toBeInstanceOf(
      Date,
    );
    const agentRun = await prisma.agentOsRun.findUniqueOrThrow({
      where: { id: handoff.agentRunId },
    });
    expect(agentRun).toMatchObject({
      status: 'waiting_for_approval',
      lastSequence: 13,
    });
    await expect(
      prisma.agentOsRunEvent.findMany({
        where: { runId: handoff.agentRunId },
        orderBy: { sequence: 'asc' },
        select: { sequence: true, type: true },
      }),
    ).resolves.toEqual([
      { sequence: 1, type: 'RunStarted' },
      { sequence: 2, type: 'ToolCompleted' },
      { sequence: 3, type: 'MessageStarted' },
      { sequence: 4, type: 'MessageDelta' },
      { sequence: 5, type: 'MessageCompleted' },
      { sequence: 6, type: 'RunPaused' },
      { sequence: 7, type: 'RunResumed' },
      { sequence: 8, type: 'MessageStarted' },
      { sequence: 9, type: 'MessageDelta' },
      { sequence: 10, type: 'MessageCompleted' },
      { sequence: 11, type: 'ToolProposed' },
      { sequence: 12, type: 'ApprovalRequired' },
      { sequence: 13, type: 'RunPaused' },
    ]);
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledWith(handoff.agentRunId);
  });

  it('rolls back journal append and delivery CAS together, then replays after a crash', async () => {
    const fixture = await createFixture(prisma, fixtureWorkspaceIds);
    const handoff = await createExternalHandoffFixture(prisma, fixture);
    const durableJournal = new AgentOsRunJournalService(
      prisma as unknown as PrismaService,
      { schedule: jest.fn() } as never,
    );
    const faultAfterAppend = new Error('fault after journal append');
    const crashingWorker = new StoryAgentRunContinuationWorkerService(
      prisma as unknown as PrismaService,
      {
        reconcileExternalHandoffInTransaction: (
          tx: Prisma.TransactionClient,
          externalJobId: string,
        ) =>
          durableJournal.reconcileExternalHandoffInTransaction(
            tx,
            externalJobId,
          ),
        appendStoryProposalReadyInTransaction: jest
          .fn()
          .mockImplementation(
            async (
              tx: Prisma.TransactionClient,
              input: Parameters<
                AgentOsRunJournalService['appendStoryProposalReadyInTransaction']
              >[1],
            ) => {
              await durableJournal.appendStoryProposalReadyInTransaction(
                tx,
                input,
              );
              throw faultAfterAppend;
            },
          ),
        publishCommitted: jest.fn(),
      } as never,
    );

    await crashingWorker.drainOnce(1);

    await expect(
      prisma.agentOsRun.findUniqueOrThrow({
        where: { id: handoff.agentRunId },
      }),
    ).resolves.toMatchObject({
      status: 'waiting_for_external',
      lastSequence: 0,
    });
    await expect(
      prisma.agentOsRunEvent.count({
        where: { runId: handoff.agentRunId },
      }),
    ).resolves.toBe(0);
    const afterCrash = await prisma.storyAgentRun.findUniqueOrThrow({
      where: { id: handoff.storyRunId },
    });
    expect(afterCrash.sourceProposalReadyDeliveredAt).toBeNull();
    expect(afterCrash.sourceTerminalDeliveredAt).toBeNull();
    expect(afterCrash.sourceResultDeliveryLeaseOwner).toBeNull();
    expect(afterCrash.sourceResultDeliveryNextAttemptAt).not.toBeNull();
    expect(afterCrash.sourceResultDeliveryLastError).toContain(
      faultAfterAppend.message,
    );

    await prisma.storyAgentRun.update({
      where: { id: handoff.storyRunId },
      data: { sourceResultDeliveryNextAttemptAt: null },
    });
    const schedule = jest.fn();
    const healthyJournal = new AgentOsRunJournalService(
      prisma as unknown as PrismaService,
      { schedule } as never,
    );
    const healthyWorker = new StoryAgentRunContinuationWorkerService(
      prisma as unknown as PrismaService,
      healthyJournal,
    );
    await healthyWorker.drainOnce(1);

    const recoveredStoryRun = await prisma.storyAgentRun.findUniqueOrThrow({
      where: { id: handoff.storyRunId },
    });
    expect(recoveredStoryRun).toMatchObject({
      sourceResultDeliveryAttempts: 0,
      sourceTerminalDeliveredAt: null,
      sourceResultDeliveryLeaseOwner: null,
      sourceResultDeliveryLastError: null,
    });
    expect(recoveredStoryRun.sourceProposalReadyDeliveredAt).toBeInstanceOf(
      Date,
    );
    await expect(
      prisma.agentOsRunEvent.count({
        where: { runId: handoff.agentRunId },
      }),
    ).resolves.toBe(7);
    expect(schedule).toHaveBeenCalledWith(handoff.agentRunId);
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
          storyChapterId: existing.storyChapterId,
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
      const content = InteractiveStoryDraftContentSchema.parse(current.content);
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
      frameProfile: StoryFrameProfile.landscape_16_9,
      durationPreset: StoryDurationPreset.short_5_15,
      visualStyle: StoryVisualStyle.cinematic_realism,
      creativeProfileConfirmedAt: new Date(),
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
          schemaVersion: INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
          content:
            EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT as Prisma.InputJsonObject,
          contentHash: canonicalJsonHash(EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT),
          updatedByUserId: user.userId,
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
      nodeIds: [],
      entryNodeId: null,
      createdByUserId: user.userId,
    },
  });
  await prisma.storyCanvasLayout.create({
    data: {
      storyChapterId: chapter.id,
      storyProjectId: project.id,
      workspaceId: workspace.id,
      schemaVersion: STORY_CANVAS_LAYOUT_SCHEMA_VERSION,
      nodePositions: {},
      updatedByUserId: user.userId,
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
    requireProjectInTransaction: jest.fn().mockResolvedValue(undefined),
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
  const agentOsJournal = new AgentOsRunJournalService(
    prisma as unknown as PrismaService,
    { schedule: jest.fn() } as never,
  );
  const productionPlans = new StoryProductionPlanService(
    prisma as unknown as PrismaService,
    permissions,
    writeGuard,
  );
  const service = new StoryAgentRunService(
    prisma as unknown as PrismaService,
    permissions,
    realtime,
    writeGuard,
    agentOsJournal,
    { scheduleCompaction: jest.fn() } as never,
    { publishDocumentOperation: jest.fn() } as never,
    productionPlans,
  );

  return {
    prefix,
    user,
    workspaceId: workspace.id,
    projectId: project.id,
    chapterId: chapter.id,
    service,
    productionPlans,
    agentOsJournal,
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
          chapterId: chapter.id,
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

async function createExternalHandoffFixture(
  prisma: ReturnType<typeof buildPrisma>,
  fixture: Awaited<ReturnType<typeof createFixture>>,
  options: { leaveHandoffUnreconciled?: boolean } = {},
) {
  const agentRunId = randomUUID();
  const conversationId = randomUUID();
  const turnId = randomUUID();
  const toolCallId = `call_story_author_${randomUUID()}`;
  const startedMessage = 'I am shaping your interactive-film proposal now.';
  const completionMessage =
    'Your interactive-film proposal is ready to review.';
  await prisma.agentOsRun.create({
    data: {
      id: agentRunId,
      projectId: fixture.projectId,
      conversationId,
      actorId: fixture.user.userId,
      modelProfileId: 'integration-test',
      status: 'running',
      projectKind: 'story',
      workbenchMode: 'story.canvas',
    },
  });
  const storyRun = await fixture.service.createAuthoringRun(
    fixture.user,
    fixture.workspaceId,
    fixture.projectId,
    {
      chapterId: fixture.chapterId,
      title: 'A durable external handoff',
      summary: 'Prove cross-pod continuation delivery.',
      brief:
        'Create a concise interactive-film proposal for the current project.',
      idempotencyKey: `${fixture.prefix}:external:${toolCallId}`,
      conversationId,
      sourceAgentRunId: agentRunId,
      sourceAgentTurnId: turnId,
      sourceAgentToolCallId: toolCallId,
      sourceStartedMessage: startedMessage,
      sourceCompletionMessage: completionMessage,
    },
  );
  const storyProposalUpdate = prisma.storyAgentRun.update({
    where: { id: storyRun.id },
    data: {
      status: StoryAgentRunStatus.proposed,
      authoringStages: Prisma.DbNull,
      leaseOwner: null,
      leaseAcquiredAt: null,
      leaseExpiresAt: null,
    },
  });
  if (options.leaveHandoffUnreconciled) {
    await prisma.$transaction([
      storyProposalUpdate,
      prisma.agentOsRunEvent.create({
        data: {
          id: randomUUID(),
          runId: agentRunId,
          conversationId,
          sequence: 1,
          protocolVersion: 'fizz.agent.v1',
          sessionId: `agent-os:v1:conversation:${conversationId}`,
          type: 'RunStarted',
          data: {
            turnId,
            status: 'running',
            workspaceType: 'story',
            modelProfileId: 'integration-test',
          },
          occurredAt: new Date(),
        },
      }),
      prisma.agentOsRun.update({
        where: { id: agentRunId },
        data: { status: 'running', lastSequence: 1 },
      }),
    ]);
  } else {
    await prisma.$transaction([
      storyProposalUpdate,
      prisma.agentOsRun.update({
        where: { id: agentRunId },
        data: {
          status: 'waiting_for_external',
          pendingExternal: {
            kind: 'external_job',
            jobId: storyRun.id,
            startedMessage,
            turnId,
            toolCallId,
            toolId: 'story.author',
          },
        },
      }),
    ]);
  }
  return {
    agentRunId,
    storyRunId: storyRun.id,
    conversationId,
    turnId,
    toolCallId,
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
      schemaVersion: INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
      content: EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT as Prisma.InputJsonObject,
      contentHash: canonicalJsonHash(EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT),
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
    {} as never,
    { scheduleCompaction: jest.fn() } as never,
    { publishDocumentOperation: jest.fn() } as never,
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
  const continuation = await prisma.$queryRaw<
    Array<{
      registrationTable: string | null;
      deliveryAttempts: string | null;
      deliveryPendingIndex: string | null;
      sourceToolIndex: string | null;
      sourceRunForeignKey: string | null;
    }>
  >`
    SELECT
      to_regclass(
        'public.agent_os_external_handoff_registrations'
      )::text AS "registrationTable",
      (
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'story_agent_runs'
          AND column_name = 'source_result_delivery_attempts'
      ) AS "deliveryAttempts",
      to_regclass(
        'public.story_agent_runs_agent_os_delivery_pending_idx'
      )::text AS "deliveryPendingIndex",
      to_regclass(
        'public.agent_os_external_handoffs_source_tool_unique'
      )::text AS "sourceToolIndex",
      (
        SELECT constraint_name
        FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = 'agent_os_external_handoff_registrations'
          AND constraint_name = 'agent_os_external_handoffs_source_run_fkey'
      ) AS "sourceRunForeignKey"
  `;
  if (
    continuation[0]?.registrationTable !==
      'agent_os_external_handoff_registrations' ||
    continuation[0]?.deliveryAttempts !== 'source_result_delivery_attempts' ||
    continuation[0]?.deliveryPendingIndex !==
      'story_agent_runs_agent_os_delivery_pending_idx' ||
    continuation[0]?.sourceToolIndex !==
      'agent_os_external_handoffs_source_tool_unique' ||
    continuation[0]?.sourceRunForeignKey !==
      'agent_os_external_handoffs_source_run_fkey'
  ) {
    throw new Error(
      'Local PostgreSQL is missing durable Story -> Agent OS handoff registration or delivery leasing. Run the local migration command first.',
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
    await prisma.agentOsExternalHandoffRegistration.deleteMany({
      where: { storyAgentRun: { storyProjectId: { in: projectIds } } },
    });
    await prisma.storyAgentRun.deleteMany({
      where: { storyProjectId: { in: projectIds } },
    });
    await prisma.agentOsRun.deleteMany({
      where: { projectId: { in: projectIds } },
    });
    await prisma.storyProject.deleteMany({
      where: { id: { in: projectIds } },
    });
  }
  await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
}
