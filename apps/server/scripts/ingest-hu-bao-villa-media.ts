import 'dotenv/config';

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

import { BlobServiceClient } from '@azure/storage-blob';
import {
  MediaAssetKind,
  MediaAssetSource,
  MediaAssetStatus,
  MediaAssetUsageRole,
  MediaAssetUsageSurface,
  MediaAssetVisibility,
  MediaStorageProvider,
  Prisma,
  StoryFilmReferenceSource,
  StoryFilmReferenceVersionStatus,
  StoryReviewDecision,
  type PrismaClient,
} from '@prisma/client';
import { buildPrisma } from '../src/infra/db/db.module';
import { newShortId, newUuidV7 } from '../src/common/id';
import { ensureOriginalMediaPlacement } from '../src/infra/storage/media-asset-placement';
import { canonicalJsonHash } from '../src/story-studio/canonical-json';
import { compileStoryFilmPrompt } from '../src/story-studio/story-film-prompt-compiler';
import { storyFilmTechnicalChecks } from '../src/story-studio/story-film-production.service';
import { HU_BAO_VILLA_PROJECT_ID } from '../src/story-studio/import/hu-bao-villa.fixture';

// One-to-one backfill of the externally produced hu-bao-villa media (docs/
// interactive-films runbook §"archive → backfill") into the seeded story-film
// project: approves the 16 reference slots from the real reference pack, then
// binds the 21 seedance-2.0 videos as each clip's current video. Local-DB
// only; uploads land in the shared dev/prod blob container like all local dev
// output. The videos are the boss-approved 720p draft batch while the seeded
// output contract is 1920×1080 — technicalChecks are recorded HONESTLY (the
// dimensions check fails), so working-preview/build stay gated until 1080p
// replacements exist; canvas cards and the shot composer play them regardless.

const PROJECT_ID = HU_BAO_VILLA_PROJECT_ID;
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const ASSETS_ROOT = path.join(
  REPO_ROOT,
  'docs/interactive-films/assets/hu-bao-villa',
);
const VIDEOS_ROOT = path.join(ASSETS_ROOT, 'videos');
const MODEL_SLUG = 'seedance-2-0';
const PROVIDER = 'byteplus-modelark';
const INGEST_TAG = 'hu-bao-villa-external-ingest-v1';
const CANDIDATE = 'candidate-001';

/** Fixture slot key → reference image on disk (the pack's approved 母版). */
const SLOT_FILES: Record<string, string> = {
  'REF-01': 'ref-01-present-entrance.png',
  'REF-02': 'ref-02-dragon-echo.png',
  'REF-03': 'ref-03-cheng-character.png',
  'REF-04': 'ref-04-maya-character.png',
  'REF-05': 'ref-05-dragon-passage-control-room.png',
  'REF-06': 'ref-06-lin-echo.png',
  'REF-07': 'ref-07-core-props.png',
  // REF-08 is a two-file scene family (exhibit/metro); the exhibit board is
  // the approved slot version, the metro sibling stays archived on disk.
  'REF-08': 'ref-08-exhibit.png',
  'JF-01': 'jf-01-s01-to-s02.png',
  'JF-02': 'jf-02-s02-to-s03.png',
  'JF-03': 'jf-03-s03-to-s04.png',
  'JF-04': 'jf-04-s04-to-s05.png',
  'JF-05': 'jf-05-s05-to-s06.png',
  'S00-FIRST': '01-locked-frames/s00-first.png',
  'S00-LAST': '01-locked-frames/s00-last.png',
  'E04-PREBLACK-END': 'e04-preblack-end.png',
};

interface VideoMeta {
  clipId: string;
  model: string;
  mode: string;
  resolution: string;
  duration?: number;
  durationSec?: number;
  audio?: boolean;
  taskId: string;
  sha256: string;
  bytes: number;
  seconds?: number;
  endpoint?: string;
  ratio?: string;
  refs?: string[];
}

interface ProbeResult {
  width: number;
  height: number;
  durationSeconds: number;
}

interface UploadedAsset {
  objectKey: string;
  publicUrl: string;
  sha256: string;
  bytes: number;
}

function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function ffprobe(filePath: string): ProbeResult {
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
  const parsed = JSON.parse(raw) as {
    streams: Array<{
      codec_type: string;
      width?: number;
      height?: number;
    }>;
    format: { duration?: string };
  };
  const video = parsed.streams.find((s) => s.codec_type === 'video');
  if (!video?.width || !video.height) {
    throw new Error(`ffprobe found no video/image stream in ${filePath}`);
  }
  return {
    width: video.width,
    height: video.height,
    durationSeconds: Math.round(Number(parsed.format.duration ?? 0)),
  };
}

/** Same derivation as the (private) builder helper storyKeyFromPromptKey. */
function storyKeyFromDirName(dirName: string): string {
  const match = /^hbln-((?:s\d{2}[a-z]?)|(?:e\d{2}))-/u.exec(dirName);
  if (!match) throw new Error(`Cannot derive clip key from ${dirName}`);
  return match[1].toUpperCase();
}

/** ModelArk task ids embed their creation time: cgt-YYYYMMDDHHMMSS-xxxxx. */
function taskTimestamp(taskId: string): Date {
  const match = /^cgt-(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})-/u.exec(
    taskId,
  );
  if (!match) return new Date('2026-07-13T13:30:00Z');
  const [, y, mo, d, h, mi, s] = match;
  return new Date(
    Date.UTC(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      Number(s),
    ),
  );
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

interface BlobUploader {
  upload(
    localPath: string,
    objectKey: string,
    contentType: string,
  ): Promise<UploadedAsset>;
  bucket: string;
  region: string | null;
}

function buildUploader(): BlobUploader {
  const connectionString = process.env.AZURE_BLOB_CONNECTION_STRING;
  if (!connectionString) {
    throw new Error('AZURE_BLOB_CONNECTION_STRING is required for ingest.');
  }
  const container = process.env.AZURE_BLOB_CONTAINER ?? 'foundry-outputs';
  const account = /AccountName=([^;]+)/u.exec(connectionString)?.[1];
  if (!account) throw new Error('Cannot parse AccountName from blob config.');
  const service = BlobServiceClient.fromConnectionString(connectionString);
  const containerClient = service.getContainerClient(container);
  return {
    bucket: container,
    region: process.env.AZURE_BLOB_REGION ?? null,
    async upload(localPath, objectKey, contentType) {
      const blob = containerClient.getBlockBlobClient(objectKey);
      if (!(await blob.exists())) {
        await blob.uploadFile(localPath, {
          blobHTTPHeaders: {
            blobContentType: contentType,
            blobCacheControl: 'public, max-age=31536000, immutable',
          },
        });
      }
      return {
        objectKey,
        publicUrl: `https://${account}.blob.core.windows.net/${container}/${objectKey}`,
        sha256: sha256File(localPath),
        bytes: readFileSync(localPath).byteLength,
      };
    },
  };
}

async function main(): Promise<void> {
  const prisma = buildPrisma();
  await prisma.$connect();
  const uploader = buildUploader();

  try {
    const context = await loadContext(prisma);
    await ensureCanvasLayout(prisma, context);
    await ingestReferencePlane(prisma, uploader, context);
    await ingestCurrentVideos(prisma, uploader, context);
    console.log(
      '\nDone. Canvas: /story-studio/projects/' + PROJECT_ID + '/canvas',
    );
  } finally {
    await prisma.$disconnect();
  }
}

interface IngestContext {
  ownerUserId: string;
  workspaceId: string;
  revisionId: string;
  canonicalModelId: string;
  modelArkAssets: Record<string, { assetId: string; asset_uri: string }>;
}

async function loadContext(prisma: PrismaClient): Promise<IngestContext> {
  const project = await prisma.storyProject.findUniqueOrThrow({
    where: { id: PROJECT_ID },
    select: { workspaceId: true },
  });
  const owner = await prisma.storyProjectMember.findFirstOrThrow({
    where: { storyProjectId: PROJECT_ID, role: 'owner', status: 'active' },
    select: { userId: true },
  });
  const revision = await prisma.storyRevision.findFirstOrThrow({
    where: { storyProjectId: PROJECT_ID, number: 1 },
    select: { id: true },
  });
  const model = await prisma.aiCanonicalModel.findFirstOrThrow({
    where: { slug: MODEL_SLUG, modality: 'video', status: 'active' },
    select: { id: true },
  });
  const registryPath = path.join(ASSETS_ROOT, 'byteplus-assets.json');
  const modelArkAssets = existsSync(registryPath)
    ? (
        JSON.parse(readFileSync(registryPath, 'utf8')) as {
          assets: IngestContext['modelArkAssets'];
        }
      ).assets
    : {};
  return {
    ownerUserId: owner.userId,
    workspaceId: project.workspaceId,
    revisionId: revision.id,
    canonicalModelId: model.id,
    modelArkAssets,
  };
}

/** The seed never creates the layout row and the canvas 404s without it. */
async function ensureCanvasLayout(
  prisma: PrismaClient,
  context: IngestContext,
): Promise<void> {
  const existing = await prisma.storyCanvasLayout.findUnique({
    where: {
      storyProjectId_workspaceId: {
        storyProjectId: PROJECT_ID,
        workspaceId: context.workspaceId,
      },
    },
    select: { revision: true },
  });
  if (existing) {
    console.log('[layout] exists — skip');
    return;
  }
  await prisma.storyCanvasLayout.create({
    data: {
      storyProjectId: PROJECT_ID,
      workspaceId: context.workspaceId,
      updatedByUserId: context.ownerUserId,
      updatedBySessionId: INGEST_TAG,
    },
  });
  console.log('[layout] created (empty positions → model defaults)');
}

async function ingestReferencePlane(
  prisma: PrismaClient,
  uploader: BlobUploader,
  context: IngestContext,
): Promise<void> {
  const slots = await prisma.storyFilmReferenceSlot.findMany({
    where: { storyProjectId: PROJECT_ID, archivedAt: null },
    orderBy: { rank: 'asc' },
  });

  for (const slot of slots) {
    if (slot.approvedVersionId) {
      console.log(`[ref ${slot.key}] already approved — skip`);
      continue;
    }
    const relativeFile = SLOT_FILES[slot.key];
    if (!relativeFile) {
      throw new Error(`No reference image mapped for slot ${slot.key}`);
    }
    const filePath = path.join(ASSETS_ROOT, relativeFile);
    const probe = ffprobe(filePath);
    const sha256 = sha256File(filePath);
    const uploaded = await uploader.upload(
      filePath,
      `imports/hu-bao-villa/references/${sha256.slice(0, 12)}-${path.basename(relativeFile)}`,
      'image/png',
    );
    const ledgerKey = path.basename(relativeFile, '.png');
    const modelArk = context.modelArkAssets[ledgerKey] ?? null;

    await prisma.$transaction(
      async (tx) => {
        const asset = await tx.mediaAsset.create({
          data: {
            kind: MediaAssetKind.image,
            storageProvider: MediaStorageProvider.azure_blob,
            bucket: uploader.bucket,
            region: uploader.region,
            objectKey: uploaded.objectKey,
            contentType: 'image/png',
            sizeBytes: BigInt(uploaded.bytes),
            width: probe.width,
            height: probe.height,
            checksumSha256: sha256,
            visibility: MediaAssetVisibility.private,
            status: MediaAssetStatus.ready,
            source: MediaAssetSource.imported,
            workspaceId: context.workspaceId,
            createdByUserId: context.ownerUserId,
            metadata: asJson({
              importSource: INGEST_TAG,
              slotKey: slot.key,
              packFile: relativeFile,
              modelArkAsset: modelArk,
              ...(slot.key === 'REF-08'
                ? { familySibling: 'ref-08-metro.png' }
                : {}),
            }),
          },
          select: { id: true },
        });
        await ensureOriginalMediaPlacement(tx, {
          assetId: asset.id,
          storageProvider: MediaStorageProvider.azure_blob,
          bucket: uploader.bucket,
          region: uploader.region,
          objectKey: uploaded.objectKey,
          contentType: 'image/png',
          sizeBytes: BigInt(uploaded.bytes),
          width: probe.width,
          height: probe.height,
          checksumSha256: sha256,
        });
        const version = await tx.storyFilmReferenceVersion.create({
          data: {
            storyProjectId: PROJECT_ID,
            revisionId: context.revisionId,
            referenceSlotId: slot.id,
            versionNumber: 1,
            submissionKey: `import:hu-bao-villa:ref:${slot.key}:v1`,
            source: StoryFilmReferenceSource.import,
            status: StoryFilmReferenceVersionStatus.ready,
            assetId: asset.id,
            checksumSha256: sha256,
            createdByUserId: context.ownerUserId,
            readyAt: new Date('2026-07-13T13:00:00Z'),
          },
          select: { id: true },
        });
        const review = await tx.storyFilmReferenceReview.create({
          data: {
            referenceVersionId: version.id,
            sequence: 1,
            decision: StoryReviewDecision.approve,
            technicalPassed: true,
            safetyPassed: true,
            checklist: asJson({ technical: 'pass', safety: 'pass' }),
            notes:
              'Imported approved 母版 from the external hu-bao-villa reference pack (seedream batch 2026-07-13).',
            reviewerUserId: context.ownerUserId,
          },
          select: { id: true },
        });
        await tx.storyFilmReferenceApproval.create({
          data: {
            referenceVersionId: version.id,
            reviewId: review.id,
            approvedByUserId: context.ownerUserId,
          },
        });
        await tx.storyFilmReferenceSlot.update({
          where: { id: slot.id },
          data: {
            approvedVersionId: version.id,
            version: slot.version + 1,
          },
        });
      },
      { timeout: 30_000 },
    );
    console.log(`[ref ${slot.key}] approved v1 ← ${relativeFile}`);
  }
}

async function ingestCurrentVideos(
  prisma: PrismaClient,
  uploader: BlobUploader,
  context: IngestContext,
): Promise<void> {
  const clips = await prisma.storyFilmClip.findMany({
    where: { storyProjectId: PROJECT_ID, archivedAt: null },
    include: {
      references: {
        include: {
          referenceSlot: {
            include: {
              approvedVersion: {
                select: { id: true, assetId: true, checksumSha256: true },
              },
            },
          },
        },
      },
    },
  });
  const clipsByKey = new Map(clips.map((clip) => [clip.key, clip]));

  const dirs = readdirSync(VIDEOS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('hbln-'))
    .map((entry) => entry.name)
    .sort();

  for (const dir of dirs) {
    const clipKey = storyKeyFromDirName(dir);
    const clip = clipsByKey.get(clipKey);
    if (!clip) throw new Error(`No seeded clip for video dir ${dir}`);
    if (clip.currentVideoAssetId) {
      console.log(`[clip ${clipKey}] already has a current video — skip`);
      continue;
    }

    const videoPath = path.join(
      VIDEOS_ROOT,
      dir,
      `${dir}__${CANDIDATE}__raw.mp4`,
    );
    const metaPath = path.join(VIDEOS_ROOT, dir, `${dir}__${CANDIDATE}.json`);
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as VideoMeta;
    const probe = ffprobe(videoPath);
    const sha256 = sha256File(videoPath);
    if (meta.sha256 && meta.sha256 !== sha256) {
      console.warn(
        `[clip ${clipKey}] WARN meta sha256 differs from file — using file hash`,
      );
    }

    const queuedAt = taskTimestamp(meta.taskId);
    const completedAt = new Date(
      queuedAt.getTime() + (meta.seconds ?? 300) * 1_000,
    );
    const jobId = newUuidV7();
    const sha12 = sha256.slice(0, 12);
    const objectKey = `${PROVIDER}/2026/07/13/${context.ownerUserId}/${jobId}/0-${sha12}.mp4`;
    const uploaded = await uploader.upload(videoPath, objectKey, 'video/mp4');

    const spec = clip.specJson as never;
    const compilation = compileStoryFilmPrompt({ clip: spec, maxLength: null });
    const outputContract = (
      clip.specJson as {
        outputContract: {
          width: number;
          height: number;
          durationMs: number;
          durationToleranceMs: number;
        };
      }
    ).outputContract;

    // Real external run parameters (boss-approved 720p draft batch).
    const generationConfig = {
      aspectRatio: meta.ratio ?? '16:9',
      resolution: meta.resolution,
      durationSeconds: meta.durationSec ?? meta.duration ?? 15,
      generateAudio: true,
      seed: null,
    };
    const bindings = [...clip.references].sort((a, b) =>
      a.role === b.role
        ? a.position - b.position
        : a.role.localeCompare(b.role),
    );
    for (const binding of bindings) {
      if (!binding.referenceSlot.approvedVersion) {
        throw new Error(
          `Slot ${binding.referenceSlotId} for clip ${clipKey} has no approved version`,
        );
      }
    }
    const manifest = {
      version: 1,
      clip: { id: clip.id, specHash: clip.specHash },
      model: { canonicalModelId: context.canonicalModelId, slug: MODEL_SLUG },
      generationConfig,
      prompt: {
        compilerVersion: compilation.stats.strategyVersion,
        compiledPromptHash: canonicalJsonHash(compilation.text),
        submittedLength: compilation.text.length,
      },
      references: bindings.map((binding) => ({
        referenceSlotId: binding.referenceSlotId,
        referenceVersionId: binding.referenceSlot.approvedVersion!.id,
        role: binding.role,
        position: binding.position,
        assetId: binding.referenceSlot.approvedVersion!.assetId,
        checksumSha256: binding.referenceSlot.approvedVersion!.checksumSha256,
      })),
      outputContract,
    };
    const productionInputHash = canonicalJsonHash(manifest);
    const idemKey = `${INGEST_TAG}:${clipKey}:${CANDIDATE}`;
    const submissionKey = `${context.ownerUserId}:${PROJECT_ID}:d:${canonicalJsonHash(clip.graphNodeId)}:${canonicalJsonHash(idemKey)}`;
    const outputId = newShortId();

    await prisma.$transaction(
      async (tx) => {
        await tx.storyFilmClip.update({
          where: { id: clip.id },
          data: {
            productionInputManifest: asJson(manifest),
            productionInputHash,
            version: clip.version + 1,
          },
        });
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
            deployment: meta.endpoint ?? 'ep-20260708234913-w8kjv',
            schemaVersion: 'external-import-v1',
            status: 'completed',
            stage: 'completed',
            queueName: 'ai-video-generation',
            prompt: compilation.text,
            idempotencyKey: `story-take:${canonicalJsonHash(submissionKey)}`,
            providerJobId: meta.taskId,
            input: asJson({
              prompt: compilation.text,
              mode: meta.mode,
              ...generationConfig,
              referenceAssets: meta.refs ?? null,
            }),
            normalizedInput: asJson({
              mode: meta.mode,
              ...generationConfig,
            }),
            logs: asJson([]),
            metrics: asJson({
              importSource: INGEST_TAG,
              generationSeconds: meta.seconds ?? null,
            }),
            queuedAt,
            startedAt: queuedAt,
            completedAt,
          },
        });
        const asset = await tx.mediaAsset.create({
          data: {
            kind: MediaAssetKind.video,
            storageProvider: MediaStorageProvider.azure_blob,
            bucket: uploader.bucket,
            region: uploader.region,
            objectKey: uploaded.objectKey,
            contentType: 'video/mp4',
            sizeBytes: BigInt(uploaded.bytes),
            width: probe.width,
            height: probe.height,
            durationSeconds: probe.durationSeconds,
            checksumSha256: sha256,
            visibility: MediaAssetVisibility.private,
            status: MediaAssetStatus.ready,
            source: MediaAssetSource.ai_output,
            workspaceId: context.workspaceId,
            createdByUserId: context.ownerUserId,
            metadata: asJson({
              aiJobId: jobId,
              provider: PROVIDER,
              modelId: MODEL_SLUG,
              canonicalModelId: context.canonicalModelId,
              importSource: INGEST_TAG,
              providerTaskId: meta.taskId,
            }),
          },
          select: { id: true },
        });
        const placement = await ensureOriginalMediaPlacement(tx, {
          assetId: asset.id,
          storageProvider: MediaStorageProvider.azure_blob,
          bucket: uploader.bucket,
          region: uploader.region,
          objectKey: uploaded.objectKey,
          contentType: 'video/mp4',
          sizeBytes: BigInt(uploaded.bytes),
          width: probe.width,
          height: probe.height,
          durationSeconds: probe.durationSeconds,
          checksumSha256: sha256,
        });
        await tx.aiJobOutput.create({
          data: {
            id: outputId,
            jobId,
            assetId: asset.id,
            type: 'video',
            url: uploaded.publicUrl,
            storagePath: uploaded.objectKey,
            contentHash: sha12,
            width: probe.width,
            height: probe.height,
            durationSeconds: probe.durationSeconds,
            mimeType: 'video/mp4',
            bytes: uploaded.bytes,
            outputIndex: 0,
            provenance: asJson({
              provider: PROVIDER,
              modelId: MODEL_SLUG,
              deployment: meta.endpoint ?? 'ep-20260708234913-w8kjv',
              checksumSha256: sha256,
              importSource: INGEST_TAG,
              providerTaskId: meta.taskId,
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
            idempotencyKey: `ai-output:${jobId}:${outputId}`,
          },
        });

        const technicalChecks = storyFilmTechnicalChecks(
          {
            kind: MediaAssetKind.video,
            width: probe.width,
            height: probe.height,
            durationSeconds: probe.durationSeconds,
            checksumSha256: sha256,
          },
          outputContract,
        );
        await tx.storyFilmClip.update({
          where: { id: clip.id },
          data: {
            currentVideoAssetId: asset.id,
            currentVideoVariantId: placement.variantId,
            currentVideoSpecHash: clip.specHash,
            currentVideoInputHash: productionInputHash,
            currentVideoChecksumSha256: sha256,
            currentVideoTechnicalChecks: asJson(technicalChecks),
            currentVideoRevision: clip.currentVideoRevision + 1,
            currentVideoSetByUserId: context.ownerUserId,
            currentVideoSetAt: completedAt,
          },
        });
      },
      { timeout: 60_000 },
    );
    console.log(
      `[clip ${clipKey}] current video ← ${dir} (${probe.width}x${probe.height}, ${(uploaded.bytes / 1024 / 1024).toFixed(1)}MB)`,
    );
  }
}

main().catch((error) => {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    console.error(error.message, { code: error.code, meta: error.meta });
  } else {
    console.error(
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
  }
  process.exit(1);
});
