import 'dotenv/config';

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  MediaAssetKind,
  MediaAssetModerationStatus,
  MediaAssetSource,
  MediaAssetStatus,
  MediaAssetUsageRole,
  MediaAssetUsageSurface,
  MediaAssetVisibility,
  MediaStorageProvider,
  Prisma,
  StoryFilmGenerationMode,
  StoryFilmReviewPolicy,
  StoryFilmTakeStatus,
  StoryReviewDecision,
  StoryRevisionSource,
  type PrismaClient,
} from '@prisma/client';
import { newShortId, newUuidV7 } from '../src/common/id';
import { buildPrisma } from '../src/infra/db/db.module';
import { ensureOriginalMediaPlacement } from '../src/infra/storage/media-asset-placement';
import { canonicalJsonHash } from '../src/story-studio/canonical-json';
import {
  buildJinlingV2ImportBundle,
  JINLING_V2_CLIP_IDS,
  jinlingClipKey,
  type JinlingV2ClipId,
} from '../src/story-studio/import/jinling-v2.builder';
import { compileStoryFilmPrompt } from '../src/story-studio/story-film-prompt-compiler';
import { storyFilmTechnicalChecks } from '../src/story-studio/story-film-production.service';

const IMPORT_TAG = 'jinling-rumeng-v2-local-import-v1';
const DRAFT_SCHEMA_VERSION = 'interactive-film-draft-v1';
const MODEL_SLUG = 'seedance-2-0';
const PROVIDER = 'byteplus-modelark';
const BLOB_ROOT =
  'https://fizzdragonblob.blob.core.windows.net/foundry-outputs/interactive-films/jinling-rumeng/s01/v2/film-cut';
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const VIDEO_ROOT = path.join(
  REPO_ROOT,
  'apps/web/tmp/jinling-production/v2-clips',
);

interface CliOptions {
  projectId: string;
  dryRun: boolean;
}

interface VideoFile {
  clipId: JinlingV2ClipId;
  path: string;
  url: string;
  sha256: string;
  bytes: number;
  width: number;
  height: number;
  durationSeconds: number;
}

async function main(): Promise<void> {
  assertLocalDatabaseUrl();
  const options = parseCliOptions(process.argv.slice(2));
  const files = JINLING_V2_CLIP_IDS.map(readVideoFile);
  const prisma = buildPrisma();
  await prisma.$connect();

  try {
    const context = await loadContext(prisma, options.projectId);
    const bundle = buildJinlingV2ImportBundle(context.canonicalModelId);
    if (options.dryRun) {
      console.log(
        [
          'Dry run passed; no database rows were changed.',
          `projectId=${options.projectId}`,
          `workspaceId=${context.workspaceId}`,
          `ownerUserId=${context.ownerUserId}`,
          `clips=${bundle.clipSpecs.length}`,
          `videos=${files.length}`,
          `database=${maskedDatabaseUrl()}`,
        ].join('\n'),
      );
      return;
    }

    const existing = await findCompletedImport(prisma, options.projectId);
    if (existing) {
      console.log(
        `Import already complete: revision=${existing.revisionNumber} clips=${existing.clipCount} takes=${existing.takeCount}.`,
      );
      return;
    }

    await importBundle(prisma, options.projectId, context, bundle, files);
    console.log(
      [
        'Imported Jinling v2 into the local Story Studio project.',
        `projectId=${options.projectId}`,
        'revision=1',
        `clips=${files.length}`,
        `takes=${files.length}`,
        `masters=${files.length}`,
        'remoteWrites=0',
      ].join('\n'),
    );
  } finally {
    await prisma.$disconnect();
  }
}

function parseCliOptions(args: string[]): CliOptions {
  let projectId: string | undefined;
  let dryRun = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (argument === '--project-id') {
      projectId = args[index + 1]?.trim();
      if (!projectId || projectId.startsWith('--')) {
        throw new Error('--project-id requires a UUID.');
      }
      index += 1;
      continue;
    }
    if (argument === '--help') {
      console.log(
        'Usage: npm run story:import:jinling-v2:local -- --project-id <uuid> [--dry-run]',
      );
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (!projectId) {
    throw new Error(
      '--project-id is required; the importer never guesses a target.',
    );
  }
  return { projectId, dryRun };
}

function assertLocalDatabaseUrl(): void {
  const value = process.env.DATABASE_URL ?? '';
  let hostname = '';
  try {
    hostname = new URL(value).hostname;
  } catch {
    throw new Error('DATABASE_URL must be a valid local PostgreSQL URL.');
  }
  if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) {
    throw new Error(
      `Refusing non-local database host: ${hostname || '<empty>'}.`,
    );
  }
}

function maskedDatabaseUrl(): string {
  const url = new URL(process.env.DATABASE_URL ?? '');
  url.username = url.username ? '***' : '';
  url.password = url.password ? '***' : '';
  return url.toString();
}

function readVideoFile(clipId: JinlingV2ClipId): VideoFile {
  const filePath = path.join(VIDEO_ROOT, `${clipId}.mp4`);
  const bytes = readFileSync(filePath);
  const raw = execFileSync(
    'ffprobe',
    [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_streams',
      '-show_format',
      filePath,
    ],
    { encoding: 'utf8' },
  );
  const probe = JSON.parse(raw) as {
    streams: { codec_type: string; width?: number; height?: number }[];
    format: { duration?: string };
  };
  const video = probe.streams.find((stream) => stream.codec_type === 'video');
  const durationSeconds = Math.round(Number(probe.format.duration ?? 0));
  if (
    video?.width !== 1920 ||
    video.height !== 1080 ||
    durationSeconds !== 12
  ) {
    throw new Error(
      `${clipId} is not the locked 1920×1080 / 12s v2 master (${video?.width}×${video?.height}, ${durationSeconds}s).`,
    );
  }
  return {
    clipId,
    path: filePath,
    url: `${BLOB_ROOT}/${clipId}.mp4`,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.byteLength,
    width: video.width,
    height: video.height,
    durationSeconds,
  };
}

interface ImportContext {
  workspaceId: string;
  ownerUserId: string;
  draftRevision: number;
  canonicalModelId: string;
  canonicalModelDisplayName: string;
}

async function loadContext(
  prisma: PrismaClient,
  projectId: string,
): Promise<ImportContext> {
  const project = await prisma.storyProject.findUniqueOrThrow({
    where: { id: projectId },
    include: {
      draft: true,
      _count: { select: { revisions: true, filmClips: true, filmTakes: true } },
    },
  });
  if (
    project.format !== 'interactive_film' ||
    project.frameProfile !== 'landscape_16_9'
  ) {
    throw new Error('Target must be a 16:9 interactive-film StoryProject.');
  }
  if (!project.draft) throw new Error('Target project has no editable draft.');
  if (
    project._count.revisions !== 0 ||
    project._count.filmClips !== 0 ||
    project._count.filmTakes !== 0
  ) {
    const completed = await findCompletedImport(prisma, projectId);
    if (!completed) {
      throw new Error(
        'Target already contains production data; refusing to overwrite it.',
      );
    }
  }
  const draft = project.draft.content as {
    graph?: { nodes?: unknown[] };
    clipPrompts?: { masterDirection?: string }[];
  };
  if (
    project._count.revisions === 0 &&
    (draft.graph?.nodes?.length !== 1 ||
      draft.clipPrompts?.length !== 1 ||
      Boolean(draft.clipPrompts[0]?.masterDirection))
  ) {
    throw new Error(
      'Draft is no longer the untouched starter scene; refusing to replace it.',
    );
  }
  const owner = await prisma.storyProjectMember.findFirstOrThrow({
    where: { storyProjectId: projectId, role: 'owner', status: 'active' },
    select: { userId: true },
  });
  const model = await prisma.aiCanonicalModel.findFirstOrThrow({
    where: {
      slug: MODEL_SLUG,
      modality: 'video',
      status: 'active',
      archivedAt: null,
    },
    select: { id: true, displayName: true },
  });
  return {
    workspaceId: project.workspaceId,
    ownerUserId: owner.userId,
    draftRevision: project.draft.revision,
    canonicalModelId: model.id,
    canonicalModelDisplayName: model.displayName,
  };
}

async function findCompletedImport(prisma: PrismaClient, projectId: string) {
  const revision = await prisma.storyRevision.findFirst({
    where: { storyProjectId: projectId, label: '金陵入梦 v2 · 26 片段导入' },
    select: { id: true, number: true },
  });
  if (!revision) return null;
  const [clipCount, takeCount] = await Promise.all([
    prisma.storyFilmClip.count({
      where: { revisionId: revision.id, archivedAt: null },
    }),
    prisma.storyFilmTake.count({
      where: { revisionId: revision.id, status: StoryFilmTakeStatus.ready },
    }),
  ]);
  if (clipCount !== 26 || takeCount !== 26) {
    throw new Error(
      `Existing Jinling import is incomplete (${clipCount} clips, ${takeCount} takes).`,
    );
  }
  return { revisionNumber: revision.number, clipCount, takeCount };
}

async function importBundle(
  prisma: PrismaClient,
  projectId: string,
  context: ImportContext,
  bundle: ReturnType<typeof buildJinlingV2ImportBundle>,
  files: VideoFile[],
): Promise<void> {
  const draftContentHash = canonicalJsonHash(bundle.draftContent);
  const filmSpecHash = canonicalJsonHash(bundle.filmSpec);
  const fileByClipKey = new Map(
    files.map((file) => [jinlingClipKey(file.clipId), file]),
  );
  const promptByClipId = new Map(
    bundle.prompts.map((prompt) => [prompt.clipId, prompt]),
  );
  const now = new Date();

  await prisma.$transaction(
    async (tx) => {
      const updatedDraft = await tx.storyDraft.updateMany({
        where: {
          storyProjectId: projectId,
          revision: context.draftRevision,
        },
        data: {
          schemaVersion: DRAFT_SCHEMA_VERSION,
          content: asJson(bundle.draftContent),
          contentHash: draftContentHash,
          revision: { increment: 1 },
          updatedByUserId: context.ownerUserId,
          updatedBySessionId: IMPORT_TAG,
        },
      });
      if (updatedDraft.count !== 1)
        throw new Error(
          'Draft changed during import; retry from a fresh project.',
        );

      await tx.storyProject.update({
        where: { id: projectId },
        data: {
          summary: bundle.draftContent.storyBible.logline,
          defaultLocale: 'zh-CN',
          tags: asJson(['interactive_film', 'classical_literature', 'mystery']),
          version: { increment: 1 },
        },
      });
      const revision = await tx.storyRevision.create({
        data: {
          storyProjectId: projectId,
          number: 1,
          sourceDraftRevision: context.draftRevision + 1,
          schemaVersion: DRAFT_SCHEMA_VERSION,
          content: asJson(bundle.draftContent),
          contentHash: draftContentHash,
          label: '金陵入梦 v2 · 26 片段导入',
          source: StoryRevisionSource.import,
          createdByUserId: context.ownerUserId,
        },
      });
      await tx.storyFilmSpec.create({
        data: {
          revisionId: revision.id,
          storyProjectId: projectId,
          runtimeSchemaVersion: bundle.filmSpec.runtimeSchemaVersion,
          targetDurationMs: bundle.filmSpec.duration.targetMs,
          durationToleranceMs: bundle.filmSpec.duration.toleranceMs,
          maxContinuousDurationMs: bundle.filmSpec.duration.maxContinuousMs,
          maxGeneratedClipDurationMs:
            bundle.filmSpec.duration.maxGeneratedClipMs,
          targetClipCount: bundle.filmSpec.targets.clipCount,
          targetChoiceCount: bundle.filmSpec.targets.choiceCount,
          targetEndingCount: bundle.filmSpec.targets.endingCount,
          frameWidth: bundle.filmSpec.frame.width,
          frameHeight: bundle.filmSpec.frame.height,
          frameRateNumerator: bundle.filmSpec.frame.framesPerSecond.numerator,
          frameRateDenominator:
            bundle.filmSpec.frame.framesPerSecond.denominator,
          audioSampleRate: bundle.filmSpec.audioSampleRateHz,
          defaultLocale: bundle.filmSpec.locales.defaultLocale,
          enabledLocales: asJson(bundle.filmSpec.locales.enabledLocales),
          defaultCanonicalModelId:
            bundle.filmSpec.generation.defaultCanonicalModelId,
          reviewPolicy: StoryFilmReviewPolicy.explicit_approval,
          specJson: asJson(bundle.filmSpec),
          specHash: filmSpecHash,
          createdByUserId: context.ownerUserId,
          updatedByUserId: context.ownerUserId,
        },
      });

      for (const clipSpec of bundle.clipSpecs) {
        const file = fileByClipKey.get(clipSpec.key);
        if (!file) throw new Error(`No local master for ${clipSpec.key}.`);
        const parsedPrompt = promptByClipId.get(file.clipId);
        if (!parsedPrompt)
          throw new Error(`No source prompt for ${file.clipId}.`);
        const specHash = canonicalJsonHash(clipSpec);
        const compilation = compileStoryFilmPrompt({
          clip: clipSpec,
          maxLength: null,
        });
        const generationConfig = {
          mode: 'omni_reference',
          aspectRatio: '16:9',
          resolution: '1080p',
          durationSeconds: 12,
          generateAudio: true,
          seed: null,
        };
        const manifest = {
          version: 1,
          importSource: IMPORT_TAG,
          clip: { key: clipSpec.key, specHash },
          model: {
            canonicalModelId: context.canonicalModelId,
            slug: MODEL_SLUG,
          },
          generationConfig,
          sourcePrompt: {
            imageSlots: parsedPrompt.imageSlots,
            audioSlots: parsedPrompt.audioSlots,
            compiledPromptHash: canonicalJsonHash(compilation.text),
          },
          outputContract: clipSpec.outputContract,
        };
        const productionInputHash = canonicalJsonHash(manifest);
        const clip = await tx.storyFilmClip.create({
          data: {
            storyProjectId: projectId,
            revisionId: revision.id,
            key: clipSpec.key,
            graphNodeId: clipSpec.graphNodeId,
            title: clipSpec.title,
            generationMode: StoryFilmGenerationMode.omni_reference,
            frameMode: null,
            targetDurationMs: clipSpec.targetDurationMs,
            specJson: asJson(clipSpec),
            specHash,
            productionInputManifest: asJson(manifest),
            productionInputHash,
            rank: clipSpec.rank,
            createdByUserId: context.ownerUserId,
            updatedByUserId: context.ownerUserId,
          },
        });

        const jobId = newUuidV7();
        const outputId = newShortId();
        const submissionKey = `${IMPORT_TAG}:${projectId}:${clipSpec.key}`;
        await tx.aiJob.create({
          data: {
            id: jobId,
            userId: context.ownerUserId,
            workspaceId: context.workspaceId,
            sourceSurface: 'story-studio',
            type: 'video',
            provider: PROVIDER,
            modelId: MODEL_SLUG,
            canonicalModelId: context.canonicalModelId,
            deployment: 'external-import',
            schemaVersion: 'external-import-v1',
            status: 'completed',
            stage: 'completed',
            queueName: 'external-import',
            prompt: compilation.text,
            compiledPrompt: compilation.text,
            idempotencyKey: submissionKey,
            input: asJson({ ...generationConfig, sourcePrompt: parsedPrompt }),
            normalizedInput: asJson(generationConfig),
            logs: asJson([]),
            metrics: asJson({ importSource: IMPORT_TAG, remoteWrites: 0 }),
            queuedAt: now,
            startedAt: now,
            providerCompletedAt: now,
            outputFetchedAt: now,
            completedAt: now,
          },
        });
        const asset = await tx.mediaAsset.create({
          data: {
            kind: MediaAssetKind.video,
            storageProvider: MediaStorageProvider.external_url,
            externalUrl: file.url,
            contentType: 'video/mp4',
            sizeBytes: BigInt(file.bytes),
            width: file.width,
            height: file.height,
            durationSeconds: file.durationSeconds,
            checksumSha256: file.sha256,
            visibility: MediaAssetVisibility.private,
            status: MediaAssetStatus.ready,
            source: MediaAssetSource.imported,
            moderationStatus: MediaAssetModerationStatus.approved,
            moderationReason:
              'Existing Jinling v2 production master imported into local development.',
            moderatedAt: now,
            workspaceId: context.workspaceId,
            createdByUserId: context.ownerUserId,
            metadata: asJson({
              importSource: IMPORT_TAG,
              clipId: file.clipId,
              localSourcePath: file.path,
            }),
          },
        });
        const placement = await ensureOriginalMediaPlacement(tx, {
          assetId: asset.id,
          storageProvider: MediaStorageProvider.external_url,
          bucket: null,
          region: null,
          objectKey: null,
          externalUrl: file.url,
          contentType: 'video/mp4',
          sizeBytes: file.bytes,
          width: file.width,
          height: file.height,
          durationSeconds: file.durationSeconds,
          checksumSha256: file.sha256,
        });
        await tx.aiJobOutput.create({
          data: {
            id: outputId,
            jobId,
            assetId: asset.id,
            type: 'video',
            url: file.url,
            storagePath: file.url,
            contentHash: file.sha256.slice(0, 12),
            width: file.width,
            height: file.height,
            durationSeconds: file.durationSeconds,
            mimeType: 'video/mp4',
            bytes: file.bytes,
            outputIndex: 0,
            provenance: asJson({
              provider: PROVIDER,
              modelId: MODEL_SLUG,
              importSource: IMPORT_TAG,
              checksumSha256: file.sha256,
            }),
          },
        });
        await tx.mediaAssetUsage.create({
          data: {
            assetId: asset.id,
            variantId: placement.variantId,
            userId: context.ownerUserId,
            workspaceId: context.workspaceId,
            aiJobId: jobId,
            aiJobOutputId: outputId,
            surface: MediaAssetUsageSurface.standalone_generation,
            sourceSurface: 'story-studio',
            role: MediaAssetUsageRole.output,
            idempotencyKey: `${IMPORT_TAG}:${asset.id}`,
          },
        });
        const take = await tx.storyFilmTake.create({
          data: {
            storyProjectId: projectId,
            revisionId: revision.id,
            clipId: clip.id,
            takeNumber: 1,
            submissionKey,
            status: StoryFilmTakeStatus.ready,
            clipSpecHash: specHash,
            productionInputHash,
            promptSnapshot: asJson({
              version: 1,
              importSource: IMPORT_TAG,
              compiledPrompt: compilation.text,
              draftSource: {
                revision: context.draftRevision + 1,
                contentHash: draftContentHash,
              },
            }),
            generationConfig: asJson(generationConfig),
            modelSnapshot: asJson({
              version: 1,
              canonicalModelId: context.canonicalModelId,
              slug: MODEL_SLUG,
              displayName: context.canonicalModelDisplayName,
              schemaVersion: 'external-import-v1',
              generationModes: ['omni_reference'],
            }),
            aiJobId: jobId,
            aiJobOutputId: outputId,
            outputAssetId: asset.id,
            outputVariantId: placement.variantId,
            outputChecksumSha256: file.sha256,
            technicalChecks: storyFilmTechnicalChecks(
              {
                kind: MediaAssetKind.video,
                width: file.width,
                height: file.height,
                durationSeconds: file.durationSeconds,
                checksumSha256: file.sha256,
              },
              clipSpec.outputContract,
            ),
            createdByUserId: context.ownerUserId,
            queuedAt: now,
            startedAt: now,
            readyAt: now,
            completedAt: now,
            version: 1,
          },
        });
        const review = await tx.storyFilmTakeReview.create({
          data: {
            takeId: take.id,
            sequence: 1,
            decision: StoryReviewDecision.approve,
            technicalPassed: true,
            safetyPassed: true,
            checklist: asJson({
              technical: 'pass',
              safety: 'existing-release-approved',
            }),
            notes:
              'Existing Jinling v2 1080p master imported into local Story Studio.',
            reviewerUserId: context.ownerUserId,
          },
        });
        await tx.storyFilmTakeApproval.create({
          data: {
            takeId: take.id,
            reviewId: review.id,
            approvedByUserId: context.ownerUserId,
          },
        });
        await tx.storyFilmClip.update({
          where: { id: clip.id },
          data: {
            masterTakeId: take.id,
            masterRevision: 1,
            masterSelectedByUserId: context.ownerUserId,
            masterSelectedAt: now,
          },
        });
      }
    },
    { maxWait: 10_000, timeout: 180_000 },
  );
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
