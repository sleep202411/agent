import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import {
  AiJobStage,
  AiJobStatus,
  AiJobType,
  MediaAssetKind,
  MediaAssetSource,
  MediaStorageProvider,
  Prisma,
  StoryAssetSpecKind,
  StoryDurationPreset,
  StoryFrameProfile,
  StoryProductionGenerationKind,
  StoryProductionGenerationTargetKind,
  StoryProductionSpecStatus,
  StoryProjectMemberRole,
  StoryProjectStatus,
  StoryStoryboardBindingMode,
  StoryStoryboardClipKind,
  StoryVisibility,
  StudioDocumentStatus,
  StudioDocumentType,
  StudioDocumentVersionSource,
  WorkspaceMemberRole,
} from '@prisma/client';
import { storyVisualStyleSkillBySlug } from '@repo/shared';
import {
  STORY_SCREENPLAY_SCHEMA_VERSION,
  buildStoryScreenplayDocument,
  type StoryScreenplay,
} from '@repo/shared/story-agent';
import { STORY_PRODUCTION_PLAN_SCHEMA_VERSION } from '@repo/shared/story-production';
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import type { AiJob } from '../ai-generation/types';
import { STORY_STUDIO_WORKBENCH_SURFACE } from '../ai-generation/output-storage-target';
import { buildPrisma, type PrismaService } from '../infra/db/db.module';
import { canonicalJsonHash } from './canonical-json';
import {
  EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT,
  INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
  InteractiveStoryDraftContentSchema,
} from './dto';
import { StoryProductionGenerationService } from './story-production-generation.service';
import { StoryProductionPlanService } from './story-production-plan.service';
import { readStoryScriptHead } from './story-script-stage';

const CINEMATIC_REALISM_SKILL =
  storyVisualStyleSkillBySlug('cinematic-realism')!;

const INTEGRATION_ENABLED =
  Boolean(process.env.TASK01_TEST_DATABASE_URL) ||
  process.env.STORY_PRODUCTION_GENERATION_POSTGRES_INTEGRATION === '1';
const TEST_PREFIX = 'story-generation-pg-it';
const describePostgres = INTEGRATION_ENABLED ? describe : describe.skip;

describePostgres('Story production generation PostgreSQL integration', () => {
  const databaseUrl =
    process.env.TASK01_TEST_DATABASE_URL ??
    process.env.DATABASE_URL?.trim() ??
    '';
  let prisma: ReturnType<typeof buildPrisma>;
  const workspaceIds = new Set<string>();

  beforeAll(async () => {
    assertDedicatedLocalPostgres(databaseUrl);
    prisma = buildPrisma(databaseUrl);
    await prisma.$connect();
    await assertGenerationMigrationPresent(prisma);
  });

  afterEach(async () => {
    await cleanupFixtures(prisma, workspaceIds);
    workspaceIds.clear();
  });

  afterAll(async () => {
    if (!prisma) return;
    await cleanupFixtures(prisma, workspaceIds);
    await prisma.$disconnect();
  });

  it('persists subtitle languages with idempotency and version checks, rejecting invalid and stale uploads atomically', async () => {
    const fixture = await createFixture(prisma, workspaceIds);
    const materializer = materializationService(prisma, fixture);
    const reference = await createCompletedAssetGeneration(
      prisma,
      fixture,
      'subtitle-reference',
    );
    await materializer.onAiGenerationCompleted({
      id: reference.job.id,
      sourceSurface: STORY_STUDIO_WORKBENCH_SURFACE,
    } as AiJob);
    const generated = await createCompletedClipGeneration(
      prisma,
      fixture,
      'subtitle-video',
    );
    await materializer.onAiGenerationCompleted({
      id: generated.job.id,
      sourceSurface: STORY_STUDIO_WORKBENCH_SURFACE,
    } as AiJob);
    // This fixture represents a probed video; node timing must never guess
    // duration from planned shot coordinates.
    await prisma.mediaAssetVariant.upsert({
      where: {
        assetId_variantKey: {
          assetId: generated.output.assetId!,
          variantKey: 'original',
        },
      },
      create: {
        assetId: generated.output.assetId!,
        variantKey: 'original',
        kind: 'original',
        status: 'ready',
        contentType: 'video/mp4',
        durationMs: 10_000,
      },
      update: { status: 'ready', durationMs: 10_000 },
    });
    const plans = editablePlanService(prisma, fixture);
    const [sequence] = await plans.getStoryboard(
      { userId: fixture.userId } as never,
      fixture.projectId,
      fixture.chapterId,
    );
    const upload = {
      language: 'en-US' as const,
      timelineFingerprint: sequence.subtitleTimeline.fingerprint,
      fileName: 'english.srt',
      format: 'srt' as const,
      content: '1\n00:00:00,500 --> 00:00:02,000\nHello',
    };
    const patch = (
      key: string,
      input: Parameters<typeof plans.patchSequence>[5],
    ) =>
      plans.patchSequence(
        { userId: fixture.userId } as never,
        fixture.projectId,
        fixture.chapterId,
        fixture.sequenceId,
        `${fixture.prefix}:${key}`,
        input,
      );
    const first = await patch('subtitle-upload', {
      expectedVersion: sequence.version,
      subtitleUpload: upload,
    });
    const replay = await patch('subtitle-upload', {
      expectedVersion: sequence.version,
      subtitleUpload: upload,
    });
    expect(replay).toEqual(first);
    expect(first.version).toBe(sequence.version + 1);
    expect(first.subtitleTracks).toMatchObject([
      {
        language: 'en-US' as const,
        timelineFingerprint: upload.timelineFingerprint,
        cues: [{ startMs: 500, endMs: 2000, text: 'Hello' }],
      },
    ]);
    const second = await patch('subtitle-traditional', {
      expectedVersion: first.version,
      subtitleUpload: { ...upload, language: 'zh-HK' },
    });
    const replaced = await patch('subtitle-replace', {
      expectedVersion: second.version,
      subtitleUpload: {
        ...upload,
        content: upload.content.replace('Hello', 'Replaced'),
      },
    });
    expect(
      replaced.subtitleTracks.map((track) => track.language).sort(),
    ).toEqual(['en-US', 'zh-HK']);
    expect(
      replaced.subtitleTracks.find((track) => track.language === 'en-US')
        ?.cues[0].text,
    ).toBe('Replaced');
    for (const [key, invalidUpload, code] of [
      [
        'invalid',
        { ...upload, content: 'broken file' },
        'STORY_SUBTITLE_INVALID',
      ],
      [
        'stale-media',
        { ...upload, timelineFingerprint: 'f'.repeat(64) },
        'STORY_SUBTITLE_TIMELINE_CHANGED',
      ],
      [
        'duration',
        { ...upload, content: '1\n00:00:00,000 --> 00:00:59,000\nToo long' },
        'STORY_SUBTITLE_DURATION',
      ],
    ] as const) {
      await expect(
        patch(`subtitle-${key}`, {
          expectedVersion: replaced.version,
          subtitleUpload: invalidUpload,
        }),
      ).rejects.toMatchObject({ response: { code } });
    }
    await expect(
      patch('subtitle-cas-conflict', {
        expectedVersion: first.version,
        removeSubtitleLanguage: 'zh-HK',
      }),
    ).rejects.toMatchObject({
      response: { code: 'STORY_PRODUCTION_VERSION_CONFLICT' },
    });
    expect(
      await prisma.storyStoryboardSequence.findUniqueOrThrow({
        where: { id: fixture.sequenceId },
      }),
    ).toMatchObject({
      version: replaced.version,
      subtitleTracks: replaced.subtitleTracks,
    });
    const removed = await patch('subtitle-remove', {
      expectedVersion: replaced.version,
      removeSubtitleLanguage: 'zh-HK',
    });
    expect(removed.subtitleTracks).toHaveLength(1);
    expect(removed.subtitleTracks[0].language).toBe('en-US');
  });

  it('materializes a completed fake output exactly once, resolves follow-selected, and deletes a retry chain with its chapter', async () => {
    const fixture = await createFixture(prisma, workspaceIds);
    const [first, second] = await Promise.all([
      createCompletedAssetGeneration(prisma, fixture, 'completed-a'),
      createCompletedAssetGeneration(prisma, fixture, 'completed-b'),
    ]);
    const service = materializationService(prisma, fixture);
    const completions = [first, second].map(
      ({ job }) =>
        ({
          id: job.id,
          sourceSurface: STORY_STUDIO_WORKBENCH_SURFACE,
        }) as AiJob,
    );

    await Promise.all(
      completions.map((completion) =>
        service.onAiGenerationCompleted(completion),
      ),
    );
    await Promise.all(
      completions.map((completion) =>
        service.onAiGenerationCompleted(completion),
      ),
    );

    const versions = await prisma.storyAssetMediaVersion.findMany({
      where: { assetSpecId: fixture.assetSpecId },
      orderBy: { versionNumber: 'asc' },
    });
    expect(versions).toHaveLength(2);
    expect(versions.map((version) => version.versionNumber)).toEqual([1, 2]);
    expect(new Set(versions.map((version) => version.generationId))).toEqual(
      new Set([first.generation.id, second.generation.id]),
    );
    expect(new Set(versions.map((version) => version.aiJobOutputId))).toEqual(
      new Set([first.output.id, second.output.id]),
    );
    const binding =
      await prisma.storyStoryboardClipAssetBinding.findUniqueOrThrow({
        where: { id: fixture.bindingId },
        include: {
          assetSpec: { include: { selectedMediaVersion: true } },
        },
      });
    expect(binding).toMatchObject({
      mode: StoryStoryboardBindingMode.follow_selected,
      pinnedMediaVersionId: null,
      assetSpec: { selectedMediaVersionId: versions[0].id },
    });
    const materialized = await prisma.storyProductionGeneration.findMany({
      where: { id: { in: [first.generation.id, second.generation.id] } },
    });
    expect(
      materialized.every((row) => row.materializedAt instanceof Date),
    ).toBe(true);

    const retryJob = await createAiJob(prisma, fixture, {
      status: AiJobStatus.failed,
      suffix: 'retry',
      retryOfJobId: first.job.id,
    });
    await prisma.storyProductionGeneration.create({
      data: generationData(fixture, retryJob.id, {
        suffix: 'retry',
        retryOfGenerationId: first.generation.id,
      }),
    });

    await expect(
      prisma.storyChapter.delete({ where: { id: fixture.chapterId } }),
    ).resolves.toMatchObject({ id: fixture.chapterId });
    expect(
      await prisma.storyProductionGeneration.count({
        where: { storyProjectId: fixture.projectId },
      }),
    ).toBe(0);
    expect(
      await prisma.storyAssetMediaVersion.count({
        where: { storyProjectId: fixture.projectId },
      }),
    ).toBe(0);
  });

  it('returns the latest generation for each Asset purpose after many repeated runs', async () => {
    const fixture = await createFixture(prisma, workspaceIds);
    const turnaroundJob = await createAiJob(prisma, fixture, {
      status: AiJobStatus.failed,
      suffix: 'turnaround-history',
    });
    const turnaround = await prisma.storyProductionGeneration.create({
      data: generationData(fixture, turnaroundJob.id, {
        suffix: 'turnaround-history',
        purpose: 'turnaround',
      }),
    });

    for (let index = 0; index < 9; index += 1) {
      const job = await createAiJob(prisma, fixture, {
        status: AiJobStatus.failed,
        suffix: `primary-history-${index}`,
      });
      await prisma.storyProductionGeneration.create({
        data: generationData(fixture, job.id, {
          suffix: `primary-history-${index}`,
        }),
      });
    }

    const service = new StoryProductionPlanService(
      prisma as unknown as PrismaService,
      {
        requireProject: jest.fn().mockResolvedValue({
          project: { workspaceId: fixture.workspaceId },
        }),
      } as never,
      {} as never,
    );
    const [asset] = await service.listAssetSpecs(
      { userId: fixture.userId } as never,
      fixture.projectId,
      fixture.chapterId,
    );

    expect(asset.latestGenerations.turnaround).toMatchObject({
      id: turnaround.id,
      purpose: 'turnaround',
    });
    expect(asset.latestGenerations.primary).toMatchObject({
      purpose: 'primary',
    });
  });

  it('imports a project-candidate image as a new Asset Spec media version and selects it atomically', async () => {
    const fixture = await createFixture(prisma, workspaceIds);
    const uploaded = await prisma.mediaAsset.create({
      data: {
        kind: MediaAssetKind.image,
        storageProvider: MediaStorageProvider.external_url,
        workspaceId: fixture.workspaceId,
        externalUrl: `https://example.test/${fixture.prefix}-upload.png`,
        contentType: 'image/png',
        source: MediaAssetSource.user_upload,
        createdByUserId: fixture.userId,
      },
    });
    await prisma.storyCandidateAsset.create({
      data: {
        storyProjectId: fixture.projectId,
        mediaAssetId: uploaded.id,
        addedByUserId: fixture.userId,
      },
    });
    const permissions = {
      requireProject: jest.fn().mockResolvedValue({
        project: { workspaceId: fixture.workspaceId },
      }),
      requireProjectInTransaction: jest.fn().mockResolvedValue(undefined),
    };
    const plans = new StoryProductionPlanService(
      prisma as unknown as PrismaService,
      permissions as never,
      {
        assertHumanWriteAllowed: jest.fn().mockResolvedValue(undefined),
      } as never,
    );

    const result = await plans.patchAssetSpec(
      { userId: fixture.userId } as never,
      fixture.projectId,
      fixture.chapterId,
      fixture.assetSpecId,
      `${fixture.prefix}:replace-asset-image`,
      {
        expectedVersion: fixture.assetVersion,
        sourceMediaAssetId: uploaded.id,
      },
    );

    expect(result).toMatchObject({
      id: fixture.assetSpecId,
      version: fixture.assetVersion + 1,
      userModifiedAt: null,
      selectedMediaVersion: {
        mediaAssetId: uploaded.id,
        versionNumber: 1,
      },
    });
    const [version] = await prisma.storyAssetMediaVersion.findMany({
      where: { assetSpecId: fixture.assetSpecId },
    });
    expect(version).toMatchObject({
      mediaAssetId: uploaded.id,
      sourceFingerprint: fixture.assetSourceFingerprint,
      generationSnapshot: {
        version: 1,
        source: 'user_media',
        mediaAssetId: uploaded.id,
      },
    });
  });

  it('uses the database reconciliation deadline so repeated GET polling cannot burn attempts', async () => {
    const fixture = await createFixture(prisma, workspaceIds);
    const job = await createAiJob(prisma, fixture, {
      status: AiJobStatus.completed,
      suffix: 'deferred-poll',
    });
    const targetSnapshot = assetTargetSnapshot(fixture);
    const generation = await prisma.storyProductionGeneration.create({
      data: generationData(fixture, job.id, {
        suffix: 'deferred-poll',
        promptSnapshot: {
          version: 1,
          targetSnapshotFingerprint: canonicalJsonHash(targetSnapshot),
          target: targetSnapshot,
        },
      }),
    });
    const service = materializationService(prisma, fixture, false);
    const user = { userId: fixture.userId } as never;
    const get = () =>
      service.getAssetGeneration(
        user,
        fixture.projectId,
        fixture.chapterId,
        fixture.assetSpecId,
        generation.id,
      );

    await get();
    await Promise.all([get(), get(), get(), get()]);

    const [row] = await prisma.$queryRaw<
      Array<{ attempts: number; deadlineInFuture: boolean }>
    >`
      SELECT
        "reconcile_attempts" AS attempts,
        "next_reconcile_at" > transaction_timestamp() AS "deadlineInFuture"
      FROM "story_production_generations"
      WHERE "id" = ${generation.id}::uuid
    `;
    expect(row).toEqual({ attempts: 1, deadlineInFuture: true });
  });

  it('keeps generated selection non-semantic so a new approved plan reconciles Asset and Storyboard targets to ready', async () => {
    const fixture = await createFixture(prisma, workspaceIds);
    const service = materializationService(prisma, fixture);
    const assetGeneration = await createCompletedAssetGeneration(
      prisma,
      fixture,
      'semantic-asset',
    );
    await service.onAiGenerationCompleted({
      id: assetGeneration.job.id,
      sourceSurface: STORY_STUDIO_WORKBENCH_SURFACE,
    } as AiJob);
    const clipGeneration = await createCompletedClipGeneration(
      prisma,
      fixture,
      'semantic-clip',
    );
    await service.onAiGenerationCompleted({
      id: clipGeneration.job.id,
      sourceSurface: STORY_STUDIO_WORKBENCH_SURFACE,
    } as AiJob);
    const completedClipGeneration = await service.getStoryboardClipGeneration(
      { userId: fixture.userId } as never,
      fixture.projectId,
      fixture.chapterId,
      fixture.sequenceId,
      fixture.clipId,
      clipGeneration.generation.id,
    );
    expect(completedClipGeneration.timing).toEqual({
      timelineDurationMs: 7_000,
      requestedSourceDurationSeconds: 10,
      generatedSourceDurationSeconds: 10,
      trimToTimeline: true,
    });

    const [generatedAsset, generatedClip, generatedSequence] =
      await Promise.all([
        prisma.storyAssetSpec.findUniqueOrThrow({
          where: { id: fixture.assetSpecId },
        }),
        prisma.storyStoryboardClip.findUniqueOrThrow({
          where: { id: fixture.clipId },
        }),
        prisma.storyStoryboardSequence.findUniqueOrThrow({
          where: { id: fixture.sequenceId },
        }),
      ]);
    expect(generatedAsset.userModifiedAt).toBeNull();
    expect(generatedAsset.selectedMediaVersionId).not.toBeNull();
    expect(generatedClip.userModifiedAt).toBeNull();
    expect(generatedClip.selectedMediaVersionId).not.toBeNull();
    expect(generatedClip.durationMs).toBe(10_000);
    expect(generatedSequence.durationMs).toBe(10_000);
    // Legacy reconciliation left archived ranks in successive million bands.
    // Moving rank zero by that same constant collides with the first archive.
    await prisma.storyStoryboardClip.createMany({
      data: [1_000_000, 2_000_000].map((rank) => ({
        storyProjectId: fixture.projectId,
        storyChapterId: fixture.chapterId,
        sequenceId: fixture.sequenceId,
        stableKey: `${fixture.prefix}.archived.${rank}`,
        rank,
        status: StoryProductionSpecStatus.archived,
        kind: StoryStoryboardClipKind.image,
        track: 'visual',
        title: 'Archived shot',
        startMs: 0,
        durationMs: 250,
        imagePrompt: 'Archived frame.',
        sourceFingerprint: 'a'.repeat(64),
        createdByUserId: fixture.userId,
      })),
    });

    const permissions = {
      requireProject: jest.fn().mockResolvedValue({
        project: { workspaceId: fixture.workspaceId },
      }),
    };
    const plans = new StoryProductionPlanService(
      prisma as unknown as PrismaService,
      permissions as never,
      {} as never,
    );
    await prisma.$transaction((tx) =>
      plans.applyApprovedProductionPlanInTransaction(tx, {
        storyProjectId: fixture.projectId,
        storyChapterId: fixture.chapterId,
        actorUserId: fixture.userId,
        sourceFingerprint: fixture.chapterPlotFingerprint,
        canonicalCharacterIds: ['char-courier'],
        productionPlan: {
          schemaVersion: STORY_PRODUCTION_PLAN_SCHEMA_VERSION,
          assetSpecs: [
            {
              stableKey: fixture.assetStableKey,
              kind: 'character',
              sourceCharacterId: 'char-courier',
              name: 'Reconciled character asset',
              description: 'Updated from the newly approved plan.',
              imagePrompt: 'A newly reconciled neutral character reference.',
              sourceNodeIds: ['node-1'],
            },
          ],
          storyboardSequences: [
            {
              plotNodeId: 'node-1',
              title: 'Reconciled gate sequence',
              description: 'Reconciled footage of the courier at the gate.',
              durationMs: 7_000,
              clips: [
                {
                  stableKey: fixture.clipStableKey,
                  kind: 'video',
                  title: 'Reconciled seven second clip',
                  description: 'The revised plan keeps the same visual beat.',
                  startMs: 0,
                  durationMs: 7_000,
                  videoPrompt: `A revised cinematic seven-second gate shot with @${fixture.assetStableKey} in frame.`,
                },
              ],
              cues: [],
            },
          ],
        },
      }),
    );

    const [asset, sequence, clip, productionState] = await Promise.all([
      prisma.storyAssetSpec.findUniqueOrThrow({
        where: { id: fixture.assetSpecId },
      }),
      prisma.storyStoryboardSequence.findUniqueOrThrow({
        where: { id: fixture.sequenceId },
      }),
      prisma.storyStoryboardClip.findUniqueOrThrow({
        where: { id: fixture.clipId },
      }),
      plans.getProductionState(
        { userId: fixture.userId } as never,
        fixture.projectId,
        fixture.chapterId,
      ),
    ]);
    expect(asset).toMatchObject({
      status: 'current',
      userModifiedAt: null,
      selectedMediaVersionId: generatedAsset.selectedMediaVersionId,
    });
    expect(sequence).toMatchObject({
      status: 'current',
    });
    expect(clip).toMatchObject({
      status: 'current',
      userModifiedAt: null,
      selectedMediaVersionId: generatedClip.selectedMediaVersionId,
    });
    expect(productionState).toMatchObject({
      assets: { status: 'current' },
      storyboard: { status: 'current' },
      ready: true,
    });
    const ranked = await prisma.storyStoryboardClip.findMany({
      where: { sequenceId: fixture.sequenceId },
      orderBy: { rank: 'asc' },
      select: { rank: true, status: true },
    });
    expect(ranked).toEqual([
      { rank: 0, status: 'current' },
      { rank: 1, status: 'archived' },
      { rank: 2, status: 'archived' },
    ]);
  });

  it('allows a clip to generate without an upstream freshness gate', async () => {
    const fixture = await createFixture(prisma, workspaceIds);
    const reference = await createCompletedAssetGeneration(
      prisma,
      fixture,
      'stale-parent-reference',
    );
    const aiGeneration = acceptingGenerationGateway(prisma, fixture);
    const service = materializationService(prisma, fixture, true, aiGeneration);
    await service.onAiGenerationCompleted({
      id: reference.job.id,
      sourceSurface: STORY_STUDIO_WORKBENCH_SURFACE,
    } as AiJob);
    await expect(
      service.createStoryboardClipGeneration(
        { userId: fixture.userId } as never,
        fixture.projectId,
        fixture.chapterId,
        fixture.sequenceId,
        fixture.clipId,
        `${fixture.prefix}:stale-parent-submit`,
        {
          expectedVersion: 0,
          modelId: 'fake-video',
          schemaVersion: 'test-v1',
          options: {},
        },
      ),
    ).resolves.toMatchObject({
      target: {
        kind: 'storyboard_clip',
        id: fixture.clipId,
        sequenceId: fixture.sequenceId,
      },
    });
    expect(aiGeneration.submitJob).toHaveBeenCalledTimes(1);
  });

  it('saves clip prompt mentions and sends their media references, then removes them on edit', async () => {
    const fixture = await createFixture(prisma, workspaceIds);
    await prisma.storyStoryboardClipAssetBinding.deleteMany({
      where: { storyboardClipId: fixture.clipId },
    });
    const reference = await createCompletedAssetGeneration(
      prisma,
      fixture,
      'prompt-reference',
    );
    const gateway = acceptingGenerationGateway(prisma, fixture);
    const generation = materializationService(prisma, fixture, true, gateway);
    await generation.onAiGenerationCompleted({
      id: reference.job.id,
      sourceSurface: STORY_STUDIO_WORKBENCH_SURFACE,
    } as AiJob);
    const plans = editablePlanService(prisma, fixture);
    const user = { userId: fixture.userId } as never;
    const prompt = `Follow @${fixture.assetStableKey} through the gate.`;
    const patched = await plans.patchClip(
      user,
      fixture.projectId,
      fixture.chapterId,
      fixture.sequenceId,
      fixture.clipId,
      `${fixture.prefix}:mention-add`,
      { expectedVersion: 0, videoPrompt: prompt },
    );
    expect(patched.videoPrompt).toBe(prompt);
    expect(patched.assetBindings).toHaveLength(1);
    expect(patched.assetBindings[0]).toMatchObject({
      assetSpecId: fixture.assetSpecId,
      mode: StoryStoryboardBindingMode.follow_selected,
      resolvedMediaVersion: { mediaAssetId: reference.output.assetId },
    });
    const submit = (version: number, key: string) =>
      generation.createStoryboardClipGeneration(
        user,
        fixture.projectId,
        fixture.chapterId,
        fixture.sequenceId,
        fixture.clipId,
        `${fixture.prefix}:${key}`,
        {
          expectedVersion: version,
          modelId: 'fake-video',
          schemaVersion: 'test-v1',
          options: {},
        },
      );
    await submit(patched.version, 'mention-generate');
    expect(gateway.submitJob.mock.calls[0][1]).toMatchObject({
      referenceBindings: [{ assetId: reference.output.assetId }],
      promptDocument: {
        nodes: [
          { type: 'text', text: 'Follow ' },
          { type: 'asset_ref', refId: patched.assetBindings[0].id },
          { type: 'text', text: ' through the gate.' },
        ],
      },
    });
    const cleared = await plans.patchClip(
      user,
      fixture.projectId,
      fixture.chapterId,
      fixture.sequenceId,
      fixture.clipId,
      `${fixture.prefix}:mention-remove`,
      { expectedVersion: patched.version, videoPrompt: 'An empty gate.' },
    );
    expect(cleared.assetBindings).toEqual([]);
    await submit(cleared.version, 'mention-cleared-generate');
    expect(gateway.submitJob.mock.calls[1][1]).toMatchObject({
      referenceBindings: [],
      promptDocument: { nodes: [{ type: 'text', text: 'An empty gate.' }] },
    });
  });

  it('preserves a pinned clip reference while editing its prompt and deduplicates repeated mentions', async () => {
    const fixture = await createFixture(prisma, workspaceIds);
    const reference = await createCompletedAssetGeneration(
      prisma,
      fixture,
      'pinned-prompt-reference',
    );
    await materializationService(prisma, fixture).onAiGenerationCompleted({
      id: reference.job.id,
      sourceSurface: STORY_STUDIO_WORKBENCH_SURFACE,
    } as AiJob);
    const asset = await prisma.storyAssetSpec.findUniqueOrThrow({
      where: { id: fixture.assetSpecId },
    });
    await prisma.storyStoryboardClipAssetBinding.update({
      where: { id: fixture.bindingId },
      data: {
        role: 'reference',
        mode: StoryStoryboardBindingMode.pinned,
        pinnedMediaVersionId: asset.selectedMediaVersionId,
      },
    });
    const patched = await editablePlanService(prisma, fixture).patchClip(
      { userId: fixture.userId } as never,
      fixture.projectId,
      fixture.chapterId,
      fixture.sequenceId,
      fixture.clipId,
      `${fixture.prefix}:mention-pinned`,
      {
        expectedVersion: 0,
        videoPrompt: `Follow @${fixture.assetStableKey}. Close up on @${fixture.assetStableKey}.`,
      },
    );
    expect(patched.assetBindings).toHaveLength(1);
    expect(patched.assetBindings[0]).toMatchObject({
      id: fixture.bindingId,
      mode: StoryStoryboardBindingMode.pinned,
      pinnedMediaVersionId: asset.selectedMediaVersionId,
      required: true,
    });
  });

  it('rejects unavailable clip mentions and rolls bindings back when the clip version conflicts', async () => {
    const fixture = await createFixture(prisma, workspaceIds);
    const foreign = await createFixture(prisma, workspaceIds);
    const plans = editablePlanService(prisma, fixture);
    const patch = (key: string, prompt: string, expectedVersion = 0) =>
      plans.patchClip(
        { userId: fixture.userId } as never,
        fixture.projectId,
        fixture.chapterId,
        fixture.sequenceId,
        fixture.clipId,
        `${fixture.prefix}:${key}`,
        { expectedVersion, videoPrompt: prompt },
      );
    for (const [index, stableKey] of [
      'missing.asset',
      foreign.assetStableKey,
    ].entries()) {
      await expect(
        patch(`unavailable-${index}`, `Follow @${stableKey}.`),
      ).rejects.toMatchObject({
        response: { code: 'STORYBOARD_CLIP_ASSET_NOT_FOUND' },
      });
    }
    await expect(
      patch('conflicting-version', `Follow @${fixture.assetStableKey}.`, 99),
    ).rejects.toMatchObject({
      response: { code: 'STORY_PRODUCTION_VERSION_CONFLICT' },
    });
    expect(
      await prisma.storyStoryboardClip.findUniqueOrThrow({
        where: { id: fixture.clipId },
      }),
    ).toMatchObject({
      version: 0,
      videoPrompt: 'A cinematic seven-second shot.',
    });
    expect(
      await prisma.storyStoryboardClipAssetBinding.findMany({
        where: { storyboardClipId: fixture.clipId },
      }),
    ).toMatchObject([{ id: fixture.bindingId, role: 'character' }]);
  });

  it('keeps current Asset and Storyboard specs ready and generatable after Script edits', async () => {
    const fixture = await createFixture(prisma, workspaceIds);
    const reference = await createCompletedAssetGeneration(
      prisma,
      fixture,
      'stale-lineage-reference',
    );
    const aiGeneration = acceptingGenerationGateway(prisma, fixture);
    const service = materializationService(prisma, fixture, true, aiGeneration);
    await service.onAiGenerationCompleted({
      id: reference.job.id,
      sourceSurface: STORY_STUDIO_WORKBENCH_SURFACE,
    } as AiJob);
    await driftScriptWithoutInvalidatingProductionRows(prisma, fixture);
    const plans = new StoryProductionPlanService(
      prisma as unknown as PrismaService,
      {
        requireProject: jest.fn().mockResolvedValue({
          project: { workspaceId: fixture.workspaceId },
        }),
      } as never,
      {} as never,
    );

    const [asset, sequence, productionState] = await Promise.all([
      prisma.storyAssetSpec.findUniqueOrThrow({
        where: { id: fixture.assetSpecId },
        select: { status: true, version: true },
      }),
      prisma.storyStoryboardSequence.findUniqueOrThrow({
        where: { id: fixture.sequenceId },
        select: { status: true },
      }),
      plans.getProductionState(
        { userId: fixture.userId } as never,
        fixture.projectId,
        fixture.chapterId,
      ),
    ]);
    expect(asset.status).toBe(StoryProductionSpecStatus.current);
    expect(sequence.status).toBe(StoryProductionSpecStatus.current);
    expect(productionState).toMatchObject({
      script: { status: 'current' },
      assets: { status: 'current' },
      storyboard: { status: 'current' },
      ready: true,
    });

    await expect(
      service.createAssetGeneration(
        { userId: fixture.userId } as never,
        fixture.projectId,
        fixture.chapterId,
        fixture.assetSpecId,
        `${fixture.prefix}:stale-lineage-asset-submit`,
        {
          expectedVersion: asset.version,
          modelId: 'fake-image',
          schemaVersion: 'test-v1',
          outputKind: 'image',
          options: {},
        },
      ),
    ).resolves.toMatchObject({
      target: { kind: 'asset_spec', id: fixture.assetSpecId },
    });
    await expect(
      service.createStoryboardClipGeneration(
        { userId: fixture.userId } as never,
        fixture.projectId,
        fixture.chapterId,
        fixture.sequenceId,
        fixture.clipId,
        `${fixture.prefix}:stale-lineage-clip-submit`,
        {
          expectedVersion: 0,
          modelId: 'fake-video',
          schemaVersion: 'test-v1',
          options: {},
        },
      ),
    ).resolves.toMatchObject({
      target: { kind: 'storyboard_clip', id: fixture.clipId },
    });
    expect(aiGeneration.submitJob).toHaveBeenCalledTimes(2);
  });

  it('allows an editable Asset to generate from its persisted snapshot', async () => {
    const fixture = await createFixture(prisma, workspaceIds);
    const aiGeneration = acceptingGenerationGateway(prisma, fixture);
    const service = materializationService(prisma, fixture, true, aiGeneration);

    await expect(
      service.createAssetGeneration(
        { userId: fixture.userId } as never,
        fixture.projectId,
        fixture.chapterId,
        fixture.assetSpecId,
        `${fixture.prefix}:manual-asset-submit`,
        {
          expectedVersion: fixture.assetVersion,
          modelId: 'fake-image',
          schemaVersion: 'test-v1',
          outputKind: 'image',
          options: {},
        },
      ),
    ).resolves.toMatchObject({
      target: { kind: 'asset_spec', id: fixture.assetSpecId },
      purpose: 'primary',
    });
    expect(aiGeneration.submitJob).toHaveBeenCalledTimes(1);
  });

  it('rejects generation for an archived Asset', async () => {
    const fixture = await createFixture(prisma, workspaceIds);
    await prisma.storyAssetSpec.update({
      where: { id: fixture.assetSpecId },
      data: { status: StoryProductionSpecStatus.archived },
    });
    const aiGeneration = acceptingGenerationGateway(prisma, fixture);
    const service = materializationService(prisma, fixture, true, aiGeneration);

    await expect(
      service.createAssetGeneration(
        { userId: fixture.userId } as never,
        fixture.projectId,
        fixture.chapterId,
        fixture.assetSpecId,
        `${fixture.prefix}:archived-asset-submit`,
        {
          expectedVersion: fixture.assetVersion,
          modelId: 'fake-image',
          schemaVersion: 'test-v1',
          outputKind: 'image',
          options: {},
        },
      ),
    ).rejects.toMatchObject({
      response: { code: 'STORY_GENERATION_TARGET_ARCHIVED' },
    });
    expect(aiGeneration.submitJob).not.toHaveBeenCalled();
  });

  it('does not reject paid work when unrelated upstream lineage changes during submission', async () => {
    const fixture = await createFixture(prisma, workspaceIds);
    const aiGeneration = acceptingGenerationGateway(prisma, fixture, (tx) =>
      driftScriptWithoutInvalidatingProductionRows(tx, fixture),
    );
    const service = materializationService(prisma, fixture, true, aiGeneration);

    await expect(
      service.createAssetGeneration(
        { userId: fixture.userId } as never,
        fixture.projectId,
        fixture.chapterId,
        fixture.assetSpecId,
        `${fixture.prefix}:locked-race-asset-submit`,
        {
          expectedVersion: fixture.assetVersion,
          modelId: 'fake-image',
          schemaVersion: 'test-v1',
          outputKind: 'image',
          options: {},
        },
      ),
    ).resolves.toMatchObject({
      target: { kind: 'asset_spec', id: fixture.assetSpecId },
    });
    expect(aiGeneration.submitJob).toHaveBeenCalledTimes(1);
    await expect(
      prisma.storyProductionGeneration.count({
        where: { storyProjectId: fixture.projectId },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.aiJob.count({
        where: { storyProjectId: fixture.projectId },
      }),
    ).resolves.toBe(1);
  });

  it('selects a late Asset output when only unrelated upstream lineage changed', async () => {
    const fixture = await createFixture(prisma, workspaceIds);
    const completed = await createCompletedAssetGeneration(
      prisma,
      fixture,
      'stale-lineage-asset-output',
    );
    await driftScriptWithoutInvalidatingProductionRows(prisma, fixture);
    const service = materializationService(prisma, fixture);

    await service.onAiGenerationCompleted({
      id: completed.job.id,
      sourceSurface: STORY_STUDIO_WORKBENCH_SURFACE,
    } as AiJob);

    const [asset, version] = await Promise.all([
      prisma.storyAssetSpec.findUniqueOrThrow({
        where: { id: fixture.assetSpecId },
        select: { selectedMediaVersionId: true },
      }),
      prisma.storyAssetMediaVersion.findFirstOrThrow({
        where: { generationId: completed.generation.id },
        select: { id: true },
      }),
    ]);
    expect(asset.selectedMediaVersionId).toBe(version.id);
    await expect(
      prisma.storyAssetMediaVersion.count({
        where: { generationId: completed.generation.id },
      }),
    ).resolves.toBe(1);
    const materialized =
      await prisma.storyProductionGeneration.findUniqueOrThrow({
        where: { id: completed.generation.id },
        select: { materializedAt: true },
      });
    expect(materialized.materializedAt).toBeInstanceOf(Date);
  });

  it('selects late media without parsing unrelated canonical production state', async () => {
    const fixture = await createFixture(prisma, workspaceIds);
    const completed = await createCompletedAssetGeneration(
      prisma,
      fixture,
      'unavailable-canonical-state-output',
    );
    const corruptDraft = { schemaVersion: 'corrupt-test-only' };
    await prisma.storyDraft.update({
      where: { storyProjectId: fixture.projectId },
      data: {
        content: corruptDraft,
        contentHash: canonicalJsonHash(corruptDraft),
        revision: { increment: 1 },
        updatedByUserId: fixture.userId,
      },
    });
    const service = materializationService(prisma, fixture);

    await service.onAiGenerationCompleted({
      id: completed.job.id,
      sourceSurface: STORY_STUDIO_WORKBENCH_SURFACE,
    } as AiJob);

    const [asset, version] = await Promise.all([
      prisma.storyAssetSpec.findUniqueOrThrow({
        where: { id: fixture.assetSpecId },
        select: { selectedMediaVersionId: true },
      }),
      prisma.storyAssetMediaVersion.findFirstOrThrow({
        where: { generationId: completed.generation.id },
        select: { id: true },
      }),
    ]);
    expect(asset.selectedMediaVersionId).toBe(version.id);
    await expect(
      prisma.storyAssetMediaVersion.count({
        where: { generationId: completed.generation.id },
      }),
    ).resolves.toBe(1);
    const materialized =
      await prisma.storyProductionGeneration.findUniqueOrThrow({
        where: { id: completed.generation.id },
        select: { materializedAt: true, materializationError: true },
      });
    expect(materialized.materializedAt).toBeInstanceOf(Date);
    expect(materialized.materializationError).toBeNull();
  });

  it('selects a late Storyboard output when only unrelated upstream lineage changed', async () => {
    const fixture = await createFixture(prisma, workspaceIds);
    const service = materializationService(prisma, fixture);
    const reference = await createCompletedAssetGeneration(
      prisma,
      fixture,
      'stale-lineage-clip-reference',
    );
    await service.onAiGenerationCompleted({
      id: reference.job.id,
      sourceSurface: STORY_STUDIO_WORKBENCH_SURFACE,
    } as AiJob);
    const completed = await createCompletedClipGeneration(
      prisma,
      fixture,
      'stale-lineage-clip-output',
    );
    await driftScriptWithoutInvalidatingProductionRows(prisma, fixture);

    await service.onAiGenerationCompleted({
      id: completed.job.id,
      sourceSurface: STORY_STUDIO_WORKBENCH_SURFACE,
    } as AiJob);

    const [clip, version] = await Promise.all([
      prisma.storyStoryboardClip.findUniqueOrThrow({
        where: { id: fixture.clipId },
        select: { selectedMediaVersionId: true },
      }),
      prisma.storyStoryboardClipMediaVersion.findFirstOrThrow({
        where: { generationId: completed.generation.id },
        select: { id: true },
      }),
    ]);
    expect(clip.selectedMediaVersionId).toBe(version.id);
    await expect(
      prisma.storyStoryboardClipMediaVersion.count({
        where: { generationId: completed.generation.id },
      }),
    ).resolves.toBe(1);
    const materialized =
      await prisma.storyProductionGeneration.findUniqueOrThrow({
        where: { id: completed.generation.id },
        select: { materializedAt: true },
      });
    expect(materialized.materializedAt).toBeInstanceOf(Date);
  });

  it('materializes but never selects a completed clip output after its parent sequence changes', async () => {
    const fixture = await createFixture(prisma, workspaceIds);
    const service = materializationService(prisma, fixture);
    const assetGeneration = await createCompletedAssetGeneration(
      prisma,
      fixture,
      'parent-stale-asset',
    );
    await service.onAiGenerationCompleted({
      id: assetGeneration.job.id,
      sourceSurface: STORY_STUDIO_WORKBENCH_SURFACE,
    } as AiJob);
    const clipGeneration = await createCompletedClipGeneration(
      prisma,
      fixture,
      'parent-stale-clip',
    );
    await prisma.storyStoryboardSequence.update({
      where: { id: fixture.sequenceId },
      data: {
        description: 'A concurrent creator edit.',
        version: { increment: 1 },
      },
    });
    await prisma.storyStoryboardSequence.update({
      where: { id: fixture.sequenceId },
      data: {
        description: 'A second concurrent creator edit.',
        version: { increment: 1 },
      },
    });

    await service.onAiGenerationCompleted({
      id: clipGeneration.job.id,
      sourceSurface: STORY_STUDIO_WORKBENCH_SURFACE,
    } as AiJob);

    await expect(
      prisma.storyStoryboardClip.findUniqueOrThrow({
        where: { id: fixture.clipId },
        select: { selectedMediaVersionId: true },
      }),
    ).resolves.toEqual({ selectedMediaVersionId: null });
    await expect(
      prisma.storyStoryboardClipMediaVersion.count({
        where: { generationId: clipGeneration.generation.id },
      }),
    ).resolves.toBe(1);
    const materialized =
      await prisma.storyProductionGeneration.findUniqueOrThrow({
        where: { id: clipGeneration.generation.id },
        select: { materializedAt: true },
      });
    expect(materialized.materializedAt).toBeInstanceOf(Date);
  });

  it('retries only materialization idempotently and never creates another AI job', async () => {
    const fixture = await createFixture(prisma, workspaceIds);
    const completed = await createCompletedAssetGeneration(
      prisma,
      fixture,
      'reattach-success',
    );
    await prisma.storyProductionGeneration.update({
      where: { id: completed.generation.id },
      data: {
        reconcileAttempts: 12,
        nextReconcileAt: null,
        materializationError: {
          code: 'STORY_PROJECT_WRITE_BUSY',
          message: 'Deferred write fence was busy.',
          retryable: false,
          attachmentRetryable: true,
        },
      },
    });
    const aiGeneration = { submitJob: jest.fn() };
    const service = materializationService(prisma, fixture, true, aiGeneration);
    const user = { userId: fixture.userId } as never;
    const beforeJobs = await prisma.aiJob.count({
      where: { storyProjectId: fixture.projectId },
    });
    const retry = () =>
      service.reattachAssetGeneration(
        user,
        fixture.projectId,
        fixture.chapterId,
        fixture.assetSpecId,
        completed.generation.id,
        `${fixture.prefix}:reattach-same-key`,
      );

    await Promise.all([retry(), retry()]);
    const final = await service.getAssetGeneration(
      user,
      fixture.projectId,
      fixture.chapterId,
      fixture.assetSpecId,
      completed.generation.id,
    );

    expect(final.materialization.status).toBe('completed');
    expect(aiGeneration.submitJob).not.toHaveBeenCalled();
    await expect(
      prisma.aiJob.count({ where: { storyProjectId: fixture.projectId } }),
    ).resolves.toBe(beforeJobs);
    await expect(
      prisma.storyAssetMediaVersion.count({
        where: { generationId: completed.generation.id },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.storyProductionMutationReceipt.count({
        where: {
          storyChapterId: fixture.chapterId,
          idempotencyKey: `${fixture.prefix}:reattach-same-key`,
        },
      }),
    ).resolves.toBe(1);
  });

  it('returns a terminal attachment failure without resubmitting the completed job', async () => {
    const fixture = await createFixture(prisma, workspaceIds);
    const job = await createAiJob(prisma, fixture, {
      status: AiJobStatus.completed,
      suffix: 'reattach-fails-again',
    });
    const generation = await prisma.storyProductionGeneration.create({
      data: generationData(fixture, job.id, {
        suffix: 'reattach-fails-again',
      }),
    });
    await prisma.storyProductionGeneration.update({
      where: { id: generation.id },
      data: {
        reconcileAttempts: 12,
        materializationError: {
          code: 'STORY_PROJECT_WRITE_BUSY',
          message: 'Deferred write fence was busy.',
          retryable: false,
          attachmentRetryable: true,
        },
      },
    });
    const aiGeneration = { submitJob: jest.fn() };
    const service = materializationService(prisma, fixture, true, aiGeneration);

    const result = await service.reattachAssetGeneration(
      { userId: fixture.userId } as never,
      fixture.projectId,
      fixture.chapterId,
      fixture.assetSpecId,
      generation.id,
      `${fixture.prefix}:reattach-terminal`,
    );

    expect(result.materialization).toMatchObject({
      status: 'failed',
      canRetry: false,
      error: { code: 'STORY_GENERATION_OUTPUT_MISSING' },
    });
    expect(aiGeneration.submitJob).not.toHaveBeenCalled();
    await expect(
      prisma.aiJob.count({ where: { storyProjectId: fixture.projectId } }),
    ).resolves.toBe(1);
  });

  it('keeps retry lineage target-local and permits asset/clip cascades without mutating immutable generations', async () => {
    const fixture = await createFixture(prisma, workspaceIds);
    const assetOriginalJob = await createAiJob(prisma, fixture, {
      status: AiJobStatus.failed,
      suffix: 'asset-original',
    });
    const assetOriginal = await prisma.storyProductionGeneration.create({
      data: generationData(fixture, assetOriginalJob.id, {
        suffix: 'asset-original',
      }),
    });
    const otherAsset = await prisma.storyAssetSpec.create({
      data: {
        storyProjectId: fixture.projectId,
        storyChapterId: fixture.chapterId,
        stableKey: `${fixture.prefix}.other-asset`,
        kind: StoryAssetSpecKind.location,
        sourceNodeIds: ['node-1'],
        name: 'Other asset',
        imagePrompt: 'A second empty Story asset.',
        sourceFingerprint: 'b'.repeat(64),
        createdByUserId: fixture.userId,
      },
    });
    const invalidRetryJob = await createAiJob(prisma, fixture, {
      status: AiJobStatus.failed,
      suffix: 'cross-target-retry',
      retryOfJobId: assetOriginalJob.id,
    });
    await expect(
      prisma.storyProductionGeneration.create({
        data: {
          ...generationData(fixture, invalidRetryJob.id, {
            suffix: 'cross-target-retry',
            retryOfGenerationId: assetOriginal.id,
          }),
          assetSpecId: otherAsset.id,
          targetSourceFingerprint: otherAsset.sourceFingerprint,
        },
      }),
    ).rejects.toBeDefined();

    const assetRetryJob = await createAiJob(prisma, fixture, {
      status: AiJobStatus.failed,
      suffix: 'asset-retry',
      retryOfJobId: assetOriginalJob.id,
    });
    const assetRetry = await prisma.storyProductionGeneration.create({
      data: generationData(fixture, assetRetryJob.id, {
        suffix: 'asset-retry',
        retryOfGenerationId: assetOriginal.id,
      }),
    });
    await prisma.storyAssetSpec.delete({ where: { id: fixture.assetSpecId } });
    expect(
      await prisma.storyProductionGeneration.count({
        where: { id: { in: [assetOriginal.id, assetRetry.id] } },
      }),
    ).toBe(0);

    const clipOriginalJob = await createAiJob(prisma, fixture, {
      status: AiJobStatus.failed,
      suffix: 'clip-original',
      type: AiJobType.video,
    });
    const clipOriginal = await prisma.storyProductionGeneration.create({
      data: clipGenerationData(fixture, clipOriginalJob.id, {
        suffix: 'clip-original',
      }),
    });
    const clipRetryJob = await createAiJob(prisma, fixture, {
      status: AiJobStatus.failed,
      suffix: 'clip-retry',
      retryOfJobId: clipOriginalJob.id,
      type: AiJobType.video,
    });
    const clipRetry = await prisma.storyProductionGeneration.create({
      data: clipGenerationData(fixture, clipRetryJob.id, {
        suffix: 'clip-retry',
        retryOfGenerationId: clipOriginal.id,
      }),
    });
    // A bare clip delete would break the deferred full-coverage timeline
    // trigger; deleting the sequence cascades the clip and exercises the same
    // generation-cascade FK chain.
    await prisma.storyStoryboardSequence.delete({
      where: { id: fixture.sequenceId },
    });
    expect(
      await prisma.storyProductionGeneration.count({
        where: { id: { in: [clipOriginal.id, clipRetry.id] } },
      }),
    ).toBe(0);
  });
});

async function createFixture(
  prisma: ReturnType<typeof buildPrisma>,
  workspaceIds: Set<string>,
) {
  const prefix = `${TEST_PREFIX}-${randomUUID()}`;
  const userId = `${prefix}:user`.slice(0, 64);
  const screenplay: StoryScreenplay = {
    schemaVersion: STORY_SCREENPLAY_SCHEMA_VERSION,
    storyLanguage: 'en-US',
    title: 'Generated light',
    logline: 'A courier follows a generated light through the gate.',
    synopsis: 'One visual beat proves generated media remains downstream.',
    characters: [
      {
        id: 'char-courier',
        name: { 'en-US': 'The Courier' },
        summary: 'A courier crossing the gate at night.',
      },
    ],
    entrySceneId: 'node-1',
    scenes: [
      {
        nodeId: 'node-1',
        clipKey: 'NODE_1',
        heading: 'EXT. CITY GATE - NIGHT',
        beat: 'The courier crosses the threshold.',
        action: 'A generated light leads the courier through the gate.',
        dialogue: [],
        exit: { kind: 'auto', nextNodeId: null },
      },
    ],
  };
  const draftContent = InteractiveStoryDraftContentSchema.parse({
    ...EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT,
    storyBible: {
      ...EMPTY_INTERACTIVE_STORY_DRAFT_CONTENT.storyBible,
      logline: screenplay.logline,
      synopsis: screenplay.synopsis,
      characters: [
        {
          id: 'char-courier',
          name: { 'en-US': 'The Courier' },
          summary: 'A courier crossing the gate at night.',
        },
      ],
    },
    graph: {
      entryNodeId: screenplay.entrySceneId,
      nodes: screenplay.scenes.map((scene) => ({
        kind: 'clip' as const,
        nodeId: scene.nodeId,
        clipKey: scene.clipKey,
        description: `${scene.heading}\n\n${scene.action}`,
        interactions: [],
        exit: scene.exit,
      })),
    },
  });
  const workspace = await prisma.workspace.create({
    data: {
      defaultForUserId: null,
      name: prefix,
      ownerUserId: userId,
      createdById: userId,
      members: {
        create: {
          userId,
          role: WorkspaceMemberRole.owner,
        },
      },
    },
  });
  workspaceIds.add(workspace.id);
  const project = await prisma.storyProject.create({
    data: {
      workspaceId: workspace.id,
      frameProfile: StoryFrameProfile.landscape_16_9,
      durationPreset: StoryDurationPreset.short_5_15,
      visualStyle: 'cinematic-realism',
      visualStyleSkillId: CINEMATIC_REALISM_SKILL.skillId,
      visualStyleSkillVersionId: CINEMATIC_REALISM_SKILL.versionId,
      creativeProfileConfirmedAt: new Date(),
      status: StoryProjectStatus.active,
      visibility: StoryVisibility.private,
      title: prefix,
      defaultLocale: 'en-US',
      createdByUserId: userId,
      members: {
        create: {
          userId,
          role: StoryProjectMemberRole.owner,
          grantedByUserId: userId,
        },
      },
      draft: {
        create: {
          schemaVersion: INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
          content: draftContent as Prisma.InputJsonObject,
          contentHash: canonicalJsonHash(draftContent),
          updatedByUserId: userId,
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
      nodeIds: ['node-1'],
      entryNodeId: 'node-1',
      createdByUserId: userId,
    },
  });
  const scriptDoc = new Y.Doc();
  const paragraph = new Y.XmlElement('paragraph');
  const paragraphText = new Y.XmlText();
  paragraphText.insert(0, `${screenplay.title}: ${screenplay.synopsis}`);
  paragraph.insert(0, [paragraphText]);
  scriptDoc.getXmlFragment('content').insert(0, [paragraph]);
  const crdtState = Buffer.from(Y.encodeStateAsUpdate(scriptDoc));
  scriptDoc.destroy();
  const script = await prisma.studioDocument.create({
    data: {
      workspaceId: workspace.id,
      storyProjectId: project.id,
      storyChapterId: chapter.id,
      type: StudioDocumentType.script,
      status: StudioDocumentStatus.active,
      title: screenplay.title,
      crdtState,
      currentSequence: 0,
      snapshotSequence: 0,
      createdById: userId,
      updatedById: userId,
    },
  });
  const scriptVersion = await prisma.studioDocumentVersion.create({
    data: {
      documentId: script.id,
      versionNumber: 1,
      schemaVersion: script.schemaVersion,
      sequence: 0,
      title: screenplay.title,
      label: 'Approved integration screenplay',
      source: StudioDocumentVersionSource.system,
      snapshot: {
        screenplay,
        document: buildStoryScreenplayDocument(screenplay),
      } as Prisma.InputJsonObject,
      crdtState,
      createdById: userId,
    },
  });
  await prisma.studioDocument.update({
    where: { id: script.id },
    data: { currentVersionId: scriptVersion.id, version: 1 },
  });
  const scriptHead = await prisma.$transaction((tx) =>
    readStoryScriptHead(tx, project.id, chapter.id),
  );
  await prisma.storyChapter.update({
    where: { id: chapter.id },
    data: {
      sourceScriptDocumentId: script.id,
      sourceScriptVersionId: scriptVersion.id,
      sourceScriptSequence: 0,
      sourceScriptHash: scriptHead.hash,
    },
  });
  const asset = await prisma.storyAssetSpec.create({
    data: {
      storyProjectId: project.id,
      storyChapterId: chapter.id,
      stableKey: `${prefix}.asset`,
      kind: StoryAssetSpecKind.character,
      sourceCharacterId: 'char-courier',
      sourceNodeIds: ['node-1'],
      name: 'Empty character asset',
      imagePrompt: 'A neutral full-body character reference.',
      sourceFingerprint: 'a'.repeat(64),
      createdByUserId: userId,
    },
  });
  // Assets are downstream of the approved Plot, so their approval marker must
  // be fenced by the chapter-scoped Plot projection rather than the Script
  // head. This fixture owns the complete one-node draft, making its canonical
  // content hash identical to chapterPlotFingerprint() in production.
  const chapterPlotFingerprint = canonicalJsonHash(draftContent);
  const approvedAssetPlan = {
    assetSpecs: [
      {
        stableKey: asset.stableKey,
        kind: 'character' as const,
        sourceCharacterId: 'char-courier',
        sourceNodeIds: ['node-1'],
        name: asset.name,
        description: 'A courier crossing the city gate at night.',
        imagePrompt: asset.imagePrompt,
      },
    ],
  };
  const approvedAssetPlanFingerprint = canonicalJsonHash({
    sourceFingerprint: chapterPlotFingerprint,
    productionPlan: approvedAssetPlan,
  });
  const approvedAssetPlanSnapshot =
    await prisma.storyProductionPlanSnapshot.create({
      data: {
        storyProjectId: project.id,
        storyChapterId: chapter.id,
        sourceFingerprint: chapterPlotFingerprint,
        planFingerprint: approvedAssetPlanFingerprint,
        productionPlan: approvedAssetPlan,
        createdByUserId: userId,
      },
    });
  await prisma.storyChapter.update({
    where: { id: chapter.id },
    data: { approvedAssetPlanSnapshotId: approvedAssetPlanSnapshot.id },
  });
  // The deferred timeline trigger checks full clip coverage at COMMIT, so the
  // sequence and its clips must land in one transaction — same as the plan
  // reconcile and the human timeline PUT do in production code.
  const { sequence, clip } = await prisma.$transaction(async (tx) => {
    const sequence = await tx.storyStoryboardSequence.create({
      data: {
        storyProjectId: project.id,
        storyChapterId: chapter.id,
        plotNodeId: 'node-1',
        stableKey: `${prefix}.sequence`,
        suggestedDurationMs: 7_000,
        durationMs: 7_000,
        sourceFingerprint: 'c'.repeat(64),
        createdByUserId: userId,
      },
    });
    const clip = await tx.storyStoryboardClip.create({
      data: {
        storyProjectId: project.id,
        storyChapterId: chapter.id,
        sequenceId: sequence.id,
        stableKey: `${prefix}.clip`,
        title: 'Seven second clip',
        rank: 0,
        kind: StoryStoryboardClipKind.video,
        track: 'visual',
        startMs: 0,
        durationMs: 7_000,
        videoPrompt: 'A cinematic seven-second shot.',
        sourceFingerprint: 'd'.repeat(64),
        createdByUserId: userId,
      },
    });
    return { sequence, clip };
  });
  const binding = await prisma.storyStoryboardClipAssetBinding.create({
    data: {
      storyProjectId: project.id,
      storyChapterId: chapter.id,
      storyboardClipId: clip.id,
      assetSpecId: asset.id,
      role: 'character',
      mode: StoryStoryboardBindingMode.follow_selected,
      required: true,
      rank: 0,
      sourceFingerprint: 'e'.repeat(64),
      createdByUserId: userId,
    },
  });
  return {
    prefix,
    userId,
    workspaceId: workspace.id,
    projectId: project.id,
    chapterId: chapter.id,
    assetSpecId: asset.id,
    assetSourceFingerprint: asset.sourceFingerprint,
    assetVersion: asset.version,
    sequenceId: sequence.id,
    clipId: clip.id,
    bindingId: binding.id,
    chapterPlotFingerprint,
    assetStableKey: asset.stableKey,
    clipStableKey: clip.stableKey,
    screenplay,
  };
}

async function driftScriptWithoutInvalidatingProductionRows(
  prisma: ReturnType<typeof buildPrisma> | Prisma.TransactionClient,
  fixture: Awaited<ReturnType<typeof createFixture>>,
): Promise<void> {
  const script = await prisma.studioDocument.findFirstOrThrow({
    where: {
      storyProjectId: fixture.projectId,
      storyChapterId: fixture.chapterId,
      type: StudioDocumentType.script,
      status: StudioDocumentStatus.active,
      deletedAt: null,
    },
  });
  const screenplay: StoryScreenplay = {
    ...fixture.screenplay,
    logline: `${fixture.screenplay.logline} The approved Script source has changed.`,
  };
  const ydoc = new Y.Doc();
  const paragraph = new Y.XmlElement('paragraph');
  const paragraphText = new Y.XmlText();
  paragraphText.insert(0, `${screenplay.title}: ${screenplay.logline}`);
  paragraph.insert(0, [paragraphText]);
  ydoc.getXmlFragment('content').insert(0, [paragraph]);
  const crdtState = Buffer.from(Y.encodeStateAsUpdate(ydoc));
  ydoc.destroy();
  const sequence = script.currentSequence + 1;
  const version = await prisma.studioDocumentVersion.create({
    data: {
      documentId: script.id,
      versionNumber: script.version + 1,
      schemaVersion: script.schemaVersion,
      sequence,
      title: screenplay.title,
      label: 'Drifted integration screenplay',
      source: StudioDocumentVersionSource.system,
      snapshot: {
        screenplay,
        document: buildStoryScreenplayDocument(screenplay),
      } as Prisma.InputJsonObject,
      crdtState,
      createdById: fixture.userId,
    },
  });
  await prisma.studioDocument.update({
    where: { id: script.id },
    data: {
      currentVersionId: version.id,
      currentSequence: sequence,
      snapshotSequence: sequence,
      crdtState,
      version: { increment: 1 },
      updatedById: fixture.userId,
    },
  });
}

async function createAiJob(
  prisma: ReturnType<typeof buildPrisma>,
  fixture: Awaited<ReturnType<typeof createFixture>>,
  input: {
    status: AiJobStatus;
    suffix: string;
    type?: AiJobType;
    retryOfJobId?: string;
  },
) {
  const type = input.type ?? AiJobType.image;
  const terminalStage =
    input.status === AiJobStatus.completed
      ? AiJobStage.completed
      : AiJobStage.failed;
  return prisma.aiJob.create({
    data: {
      id: randomUUID(),
      userId: fixture.userId,
      type,
      provider: 'fake-story-integration',
      modelId: `fake-${type}`,
      deployment: 'never-called',
      schemaVersion: 'test-v1',
      workspaceId: fixture.workspaceId,
      storyProjectId: fixture.projectId,
      sourceSurface: STORY_STUDIO_WORKBENCH_SURFACE,
      outputStorageProvider:
        type === AiJobType.video ? MediaStorageProvider.s3_compatible : null,
      status: input.status,
      stage: terminalStage,
      queueName: 'story-generation-integration',
      prompt: 'No provider is called by this integration fixture.',
      idempotencyKey: `${fixture.prefix}:${input.suffix}`,
      input: {},
      normalizedInput: {},
      logs: [],
      metrics: {},
      progress: 1,
      retryOfJobId: input.retryOfJobId,
      completedAt: new Date(),
    },
  });
}

async function createCompletedAssetGeneration(
  prisma: ReturnType<typeof buildPrisma>,
  fixture: Awaited<ReturnType<typeof createFixture>>,
  suffix: string,
) {
  const job = await createAiJob(prisma, fixture, {
    status: AiJobStatus.completed,
    suffix,
  });
  const publicUrl = `https://example.test/${suffix}.png`;
  const mediaAsset = await prisma.mediaAsset.create({
    data: {
      kind: MediaAssetKind.image,
      storageProvider: MediaStorageProvider.external_url,
      workspaceId: fixture.workspaceId,
      externalUrl: publicUrl,
      contentType: 'image/png',
      source: MediaAssetSource.ai_output,
      createdByUserId: fixture.userId,
    },
  });
  const output = await prisma.aiJobOutput.create({
    data: {
      id: `${fixture.prefix}:output:${suffix}`,
      jobId: job.id,
      assetId: mediaAsset.id,
      type: AiJobType.image,
      url: publicUrl,
      storagePath: `${fixture.prefix}/${suffix}.png`,
      outputIndex: 0,
      mimeType: 'image/png',
    },
  });
  const targetSnapshot = assetTargetSnapshot(fixture);
  const generation = await prisma.storyProductionGeneration.create({
    data: generationData(fixture, job.id, {
      suffix,
      promptSnapshot: {
        version: 1,
        targetSnapshotFingerprint: canonicalJsonHash(targetSnapshot),
        target: targetSnapshot,
      },
    }),
  });
  return { job, output, generation };
}

async function createCompletedClipGeneration(
  prisma: ReturnType<typeof buildPrisma>,
  fixture: Awaited<ReturnType<typeof createFixture>>,
  suffix: string,
) {
  const job = await createAiJob(prisma, fixture, {
    status: AiJobStatus.completed,
    suffix,
    type: AiJobType.video,
  });
  const publicUrl = `https://example.test/${suffix}.mp4`;
  const mediaAsset = await prisma.mediaAsset.create({
    data: {
      kind: MediaAssetKind.video,
      storageProvider: MediaStorageProvider.external_url,
      workspaceId: fixture.workspaceId,
      externalUrl: publicUrl,
      contentType: 'video/mp4',
      durationSeconds: 10,
      source: MediaAssetSource.ai_output,
      createdByUserId: fixture.userId,
    },
  });
  const output = await prisma.aiJobOutput.create({
    data: {
      id: `${fixture.prefix}:output:${suffix}`,
      jobId: job.id,
      assetId: mediaAsset.id,
      type: AiJobType.video,
      url: publicUrl,
      storagePath: `${fixture.prefix}/${suffix}.mp4`,
      outputIndex: 0,
      mimeType: 'video/mp4',
    },
  });
  const clip = await prisma.storyStoryboardClip.findUniqueOrThrow({
    where: { id: fixture.clipId },
    include: {
      project: { select: { frameProfile: true } },
      sequence: {
        select: {
          id: true,
          status: true,
          version: true,
          sourceFingerprint: true,
        },
      },
      assetBindings: {
        orderBy: [{ rank: 'asc' }, { id: 'asc' }],
        include: { assetSpec: true },
      },
    },
  });
  const selectedReference =
    await prisma.storyAssetMediaVersion.findUniqueOrThrow({
      where: {
        id: clip.assetBindings[0].assetSpec.selectedMediaVersionId!,
      },
      select: { mediaAssetId: true },
    });
  const targetSnapshot = {
    version: 2,
    targetKind: 'storyboard_clip',
    id: clip.id,
    sequenceId: clip.sequenceId,
    sequence: {
      id: clip.sequence.id,
      versionNumber: clip.sequence.version,
      status: clip.sequence.status,
      sourceFingerprint: clip.sequence.sourceFingerprint,
    },
    versionNumber: clip.version,
    status: clip.status,
    sourceFingerprint: clip.sourceFingerprint,
    selectedMediaVersionId: clip.selectedMediaVersionId,
    kind: clip.kind,
    startMs: clip.startMs,
    durationMs: clip.durationMs,
    imagePrompt: clip.imagePrompt,
    videoPrompt: clip.videoPrompt,
    negativePrompt: clip.negativePrompt,
    generationConfig: clip.generationConfig,
    frameProfile: clip.project.frameProfile,
    bindings: clip.assetBindings.map((binding) => ({
      id: binding.id,
      versionNumber: binding.version,
      status: binding.status,
      sourceFingerprint: binding.sourceFingerprint,
      mode: binding.mode,
      role: binding.role,
      required: binding.required,
      rank: binding.rank,
      assetSpec: {
        id: binding.assetSpec.id,
        versionNumber: binding.assetSpec.version,
        status: binding.assetSpec.status,
        sourceFingerprint: binding.assetSpec.sourceFingerprint,
        selectedMediaVersionId: binding.assetSpec.selectedMediaVersionId,
      },
      pinnedMediaVersionId: binding.pinnedMediaVersionId,
      resolvedMediaVersionId: binding.assetSpec.selectedMediaVersionId,
      resolvedMediaAssetId: selectedReference.mediaAssetId,
    })),
  };
  const generation = await prisma.storyProductionGeneration.create({
    data: {
      ...clipGenerationData(fixture, job.id, { suffix }),
      targetVersion: clip.version,
      targetSourceFingerprint: clip.sourceFingerprint,
      promptSnapshot: {
        version: 1,
        targetSnapshotFingerprint: canonicalJsonHash(targetSnapshot),
        target: targetSnapshot,
      },
    },
  });
  return { job, output, generation };
}

function generationData(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  aiJobId: string,
  input: {
    suffix: string;
    purpose?: 'primary' | 'turnaround';
    retryOfGenerationId?: string;
    promptSnapshot?: Prisma.InputJsonValue;
  },
): Prisma.StoryProductionGenerationUncheckedCreateInput {
  return {
    id: randomUUID(),
    storyProjectId: fixture.projectId,
    storyChapterId: fixture.chapterId,
    targetKind: StoryProductionGenerationTargetKind.asset_spec,
    generationKind: StoryProductionGenerationKind.image,
    purpose: input.purpose ?? 'primary',
    assetSpecId: fixture.assetSpecId,
    aiJobId,
    actorUserId: fixture.userId,
    idempotencyKey: `${fixture.prefix}:${input.suffix}`,
    requestFingerprint: canonicalJsonHash({ suffix: input.suffix }),
    targetVersion: fixture.assetVersion,
    targetSourceFingerprint: fixture.assetSourceFingerprint,
    promptSnapshot: input.promptSnapshot ?? {},
    submissionSnapshot: {
      version: 1,
      modelId: 'fake-image',
      schemaVersion: 'test-v1',
      outputKind: 'image',
      purpose: input.purpose ?? 'primary',
      clientOptions: {},
      effectiveOptions: {},
      timelineDurationMs: null,
      requestedSourceDurationSeconds: null,
      sourceSurface: STORY_STUDIO_WORKBENCH_SURFACE,
    },
    retryOfGenerationId: input.retryOfGenerationId,
  };
}

function clipGenerationData(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  aiJobId: string,
  input: { suffix: string; retryOfGenerationId?: string },
): Prisma.StoryProductionGenerationUncheckedCreateInput {
  return {
    id: randomUUID(),
    storyProjectId: fixture.projectId,
    storyChapterId: fixture.chapterId,
    targetKind: StoryProductionGenerationTargetKind.storyboard_clip,
    generationKind: StoryProductionGenerationKind.video,
    storyboardClipId: fixture.clipId,
    aiJobId,
    actorUserId: fixture.userId,
    idempotencyKey: `${fixture.prefix}:${input.suffix}`,
    requestFingerprint: canonicalJsonHash({ suffix: input.suffix }),
    targetVersion: 0,
    targetSourceFingerprint: 'd'.repeat(64),
    promptSnapshot: {},
    submissionSnapshot: {
      version: 1,
      modelId: 'fake-video',
      schemaVersion: 'test-v1',
      outputKind: 'video',
      purpose: 'primary',
      clientOptions: {},
      effectiveOptions: { durationSeconds: 10 },
      timelineDurationMs: 7_000,
      requestedSourceDurationSeconds: 10,
      sourceSurface: STORY_STUDIO_WORKBENCH_SURFACE,
    },
    retryOfGenerationId: input.retryOfGenerationId,
  };
}

function assetTargetSnapshot(
  fixture: Awaited<ReturnType<typeof createFixture>>,
) {
  return {
    version: 1,
    targetKind: 'asset_spec',
    id: fixture.assetSpecId,
    versionNumber: fixture.assetVersion,
    status: 'current',
    sourceFingerprint: fixture.assetSourceFingerprint,
    selectedMediaVersionId: null,
    purpose: 'primary',
    promptProfile: null,
    imagePrompt: 'A neutral full-body character reference.',
    videoPrompt: null,
    negativePrompt: null,
    generationConfig: {},
    frameProfile: StoryFrameProfile.landscape_16_9,
    references: [],
  };
}

function editablePlanService(
  prisma: ReturnType<typeof buildPrisma>,
  fixture: Awaited<ReturnType<typeof createFixture>>,
) {
  return new StoryProductionPlanService(
    prisma as unknown as PrismaService,
    {
      requireProject: jest
        .fn()
        .mockResolvedValue({ project: { workspaceId: fixture.workspaceId } }),
      requireProjectInTransaction: jest.fn().mockResolvedValue(undefined),
    } as never,
    {
      assertHumanWriteAllowed: jest.fn().mockResolvedValue(undefined),
    } as never,
  );
}

function materializationService(
  prisma: ReturnType<typeof buildPrisma>,
  fixture: Awaited<ReturnType<typeof createFixture>>,
  writeFenceAvailable = true,
  aiGeneration: { submitJob: jest.Mock } = { submitJob: jest.fn() },
): StoryProductionGenerationService {
  const permissions = {
    requireProject: jest.fn().mockResolvedValue({
      project: { workspaceId: fixture.workspaceId },
    }),
    requireProjectInTransaction: jest.fn().mockResolvedValue(undefined),
  };
  const writeGuard = {
    assertHumanWriteAllowed: jest.fn().mockResolvedValue(undefined),
    tryAcquireDeferredWriteFence: jest
      .fn()
      .mockResolvedValue(writeFenceAvailable),
  };
  return new StoryProductionGenerationService(
    prisma as unknown as PrismaService,
    permissions as never,
    writeGuard as never,
    aiGeneration as never,
    {} as never,
    {
      resolvePublicUrl: (asset: { externalUrl: string | null }) =>
        asset.externalUrl ?? 'https://example.test/resolved',
      resolveVariant: () => 'https://example.test/resolved-variant',
    } as never,
    new StoryProductionPlanService(
      prisma as unknown as PrismaService,
      permissions as never,
      writeGuard as never,
    ),
  );
}

function acceptingGenerationGateway(
  prisma: ReturnType<typeof buildPrisma>,
  fixture: Awaited<ReturnType<typeof createFixture>>,
  beforeLockedCreate?: (tx: Prisma.TransactionClient) => Promise<void>,
) {
  return {
    listCatalog: jest.fn().mockResolvedValue({
      models: [
        {
          id: 'fake-image',
          enabled: true,
          type: 'image',
          schemaVersion: 'test-v1',
          input_schema: {
            type: 'object',
            required: ['prompt'],
            properties: { prompt: { type: 'string' } },
          },
          ui_policy: {},
          access: { allowed: true },
        },
        {
          id: 'fake-video',
          enabled: true,
          type: 'video',
          schemaVersion: 'test-v1',
          input_schema: {
            type: 'object',
            required: ['prompt'],
            properties: {
              prompt: { type: 'string' },
              durationSeconds: { type: 'number' },
              referenceImages: { type: 'array', maxItems: 8 },
            },
          },
          ui_policy: {},
          access: { allowed: true },
        },
      ],
      presets: [],
    }),
    submitJob: jest.fn(
      async (
        _user: unknown,
        body: { modelId: string },
        _workspaceId: string,
        hooks: {
          afterJobCreate?: (
            tx: Prisma.TransactionClient,
            job: AiJob,
          ) => Promise<void>;
        },
      ) =>
        prisma.$transaction(async (tx) => {
          await beforeLockedCreate?.(tx);
          const job = await tx.aiJob.create({
            data: {
              id: randomUUID(),
              userId: fixture.userId,
              type:
                body.modelId === 'fake-video'
                  ? AiJobType.video
                  : AiJobType.image,
              provider: 'fake-story-integration',
              modelId: body.modelId,
              deployment: 'never-called',
              schemaVersion: 'test-v1',
              workspaceId: fixture.workspaceId,
              storyProjectId: fixture.projectId,
              sourceSurface: STORY_STUDIO_WORKBENCH_SURFACE,
              status: AiJobStatus.in_queue,
              stage: AiJobStage.queued,
              queueName: 'story-generation-integration',
              prompt: 'No provider is called by this integration fixture.',
              idempotencyKey: `${fixture.prefix}:accepted-image-ai-job:${randomUUID()}`,
              input: {},
              normalizedInput: {},
              logs: [],
              metrics: {},
              progress: 0,
            },
          });
          await hooks.afterJobCreate?.(tx, job as unknown as AiJob);
          return { id: job.id };
        }),
    ),
  };
}

async function assertGenerationMigrationPresent(
  prisma: ReturnType<typeof buildPrisma>,
): Promise<void> {
  const [row] = await prisma.$queryRaw<
    Array<{ tableName: string | null; retryDeleteRule: string | null }>
  >`
    SELECT
      to_regclass('public.story_production_generations')::text AS "tableName",
      (
        SELECT delete_rule
        FROM information_schema.referential_constraints
        WHERE constraint_schema = 'public'
          AND constraint_name = 'story_production_generations_retry_fkey'
      ) AS "retryDeleteRule"
  `;
  if (
    row?.tableName !== 'story_production_generations' ||
    row.retryDeleteRule !== 'CASCADE'
  ) {
    throw new Error(
      'Local PostgreSQL is missing the Story production generation bridge migration.',
    );
  }
}

async function cleanupFixtures(
  prisma: ReturnType<typeof buildPrisma>,
  workspaceIds: Set<string>,
): Promise<void> {
  if (workspaceIds.size === 0) return;
  const ids = [...workspaceIds];
  // Selected-version pointers are NO ACTION scoped FKs — release them before
  // deleting the media-version rows they point at.
  await prisma.storyAssetSpec.updateMany({
    where: { project: { workspaceId: { in: ids } } },
    data: { selectedMediaVersionId: null },
  });
  await prisma.storyStoryboardClip.updateMany({
    where: { project: { workspaceId: { in: ids } } },
    data: { selectedMediaVersionId: null },
  });
  await prisma.storyStoryboardClipAssetBinding.deleteMany({
    where: { project: { workspaceId: { in: ids } } },
  });
  await prisma.storyAssetMediaVersion.deleteMany({
    where: { project: { workspaceId: { in: ids } } },
  });
  await prisma.storyStoryboardClipMediaVersion.deleteMany({
    where: { project: { workspaceId: { in: ids } } },
  });
  await prisma.storyProductionGeneration.deleteMany({
    where: { project: { workspaceId: { in: ids } } },
  });
  const jobs = await prisma.aiJob.findMany({
    where: { workspaceId: { in: ids }, userId: { startsWith: TEST_PREFIX } },
    select: { id: true },
  });
  await prisma.aiJob.deleteMany({
    where: { id: { in: jobs.map((job) => job.id) } },
  });
  await prisma.storyProject.deleteMany({
    where: { workspaceId: { in: ids } },
  });
  await prisma.mediaAsset.deleteMany({
    where: {
      workspaceId: { in: ids },
      createdByUserId: { startsWith: TEST_PREFIX },
    },
  });
  await prisma.workspace.deleteMany({ where: { id: { in: ids } } });
}

function assertDedicatedLocalPostgres(rawUrl: string): void {
  const url = postgresFixtureUrl(rawUrl);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !(
      (url.port === '5433' && url.pathname === '/fizzdragon_outbox_test') ||
      (url.port === '55439' && url.pathname === '/task01')
    )
  ) {
    throw new Error(
      'Explicitly selected named loopback test database required.',
    );
  }
}
