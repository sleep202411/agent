import 'dotenv/config';

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
  StoryFilmFrameMode,
  StoryFilmGenerationMode,
  StoryRevisionSource,
} from '@prisma/client';

import { buildPrisma } from '../src/infra/db/db.module';
import { ensureOriginalMediaPlacement } from '../src/infra/storage/media-asset-placement';
import { canonicalJsonHash } from '../src/story-studio/canonical-json';
import { INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION } from '../src/story-studio/interactive-film.schema';
import { projectStoryFilmRevision } from '../src/story-studio/story-film-revision-projector';
import { storyFilmTechnicalChecks } from '../src/story-studio/story-film-production.service';
import {
  assertLocalDatabaseUrl,
  readStoryProjectSourcePackage,
} from './story-project-source';

interface Options {
  projectId: string;
  input: string;
  dryRun: boolean;
}

async function main(): Promise<void> {
  assertLocalDatabaseUrl();
  const options = parseOptions(process.argv.slice(2));
  const source = readStoryProjectSourcePackage(options.input);
  const prisma = buildPrisma();
  await prisma.$connect();

  try {
    const project = await prisma.storyProject.findUniqueOrThrow({
      where: { id: options.projectId },
      include: {
        draft: true,
        canvasLayout: true,
        members: {
          where: { role: 'owner', status: 'active' },
          select: { userId: true },
          take: 1,
        },
        _count: {
          select: {
            revisions: true,
            filmClips: true,
            filmGenerationAttempts: true,
            builds: true,
          },
        },
      },
    });
    if (project.format !== 'interactive_film') {
      throw new Error('Target must be an interactive-film StoryProject.');
    }
    if (project.frameProfile !== source.project.frameProfile) {
      throw new Error(
        `Target frame profile ${project.frameProfile} does not match source ${source.project.frameProfile}.`,
      );
    }
    if (!project.draft || !project.canvasLayout) {
      throw new Error('Target project is missing its draft or canvas layout.');
    }
    if (
      project.draft.revision !== 0 ||
      project._count.revisions !== 0 ||
      project._count.filmClips !== 0 ||
      project._count.filmGenerationAttempts !== 0 ||
      project._count.builds !== 0
    ) {
      throw new Error(
        'Target is not an untouched StoryProject; refusing to replace authored or production data.',
      );
    }
    const ownerUserId = project.members[0]?.userId;
    if (!ownerUserId) {
      throw new Error('Target project has no active owner.');
    }
    const canonicalModel = await prisma.aiCanonicalModel.findFirstOrThrow({
      where: {
        slug: source.defaultVideoModelSlug,
        modality: 'video',
        status: 'active',
        archivedAt: null,
      },
      select: { id: true },
    });
    const projection = projectStoryFilmRevision({
      draft: source.draft,
      frameProfile: source.project.frameProfile,
      defaultLocale: source.project.defaultLocale,
      defaultCanonicalModelId: canonicalModel.id,
    });
    if (projection.clipSpecs.length !== source.clips.length) {
      throw new Error('Source clip projection and media bindings diverged.');
    }

    if (options.dryRun) {
      console.log(
        [
          'Dry run passed; no database rows were changed.',
          `sourceId=${source.sourceId}`,
          `projectId=${project.id}`,
          `ownerUserId=${ownerUserId}`,
          `clips=${projection.clipSpecs.length}`,
        ].join('\n'),
      );
      return;
    }

    const mediaByGraphNodeId = new Map(
      source.clips.map((clip) => [clip.graphNodeId, clip.media]),
    );
    const contentHash = canonicalJsonHash(source.draft);
    const now = new Date();

    await prisma.$transaction(
      async (tx) => {
        const claimedDraft = await tx.storyDraft.updateMany({
          where: {
            storyProjectId: project.id,
            revision: 0,
          },
          data: {
            schemaVersion: INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION,
            content: asJson(source.draft),
            contentHash,
            revision: 1,
            updatedByUserId: ownerUserId,
            updatedBySessionId: `source-import:${source.sourceId}`,
          },
        });
        if (claimedDraft.count !== 1) {
          throw new Error('Draft changed during import.');
        }

        await tx.storyProject.update({
          where: { id: project.id },
          data: {
            title: source.project.title,
            summary: source.project.summary,
            defaultLocale: source.project.defaultLocale,
            tags: asJson(source.project.tags),
            version: { increment: 1 },
          },
        });
        await tx.storyCanvasLayout.update({
          where: {
            storyProjectId_workspaceId: {
              storyProjectId: project.id,
              workspaceId: project.workspaceId,
            },
          },
          data: {
            schemaVersion: 'story-canvas-layout-v1',
            nodePositions: asJson(source.canvasLayout),
            revision: { increment: 1 },
            updatedByUserId: ownerUserId,
            updatedBySessionId: `source-import:${source.sourceId}`,
          },
        });

        const revision = await tx.storyRevision.create({
          data: {
            storyProjectId: project.id,
            number: 1,
            sourceDraftRevision: 1,
            schemaVersion: INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION,
            content: asJson(source.draft),
            contentHash,
            label: source.sourceRevision.label,
            source: StoryRevisionSource.import,
            createdByUserId: ownerUserId,
          },
        });
        const filmSpec = projection.filmSpec;
        await tx.storyFilmSpec.create({
          data: {
            revisionId: revision.id,
            storyProjectId: project.id,
            runtimeSchemaVersion: filmSpec.runtimeSchemaVersion,
            targetDurationMs: filmSpec.duration.targetMs,
            durationToleranceMs: filmSpec.duration.toleranceMs,
            maxContinuousDurationMs: filmSpec.duration.maxContinuousMs,
            maxGeneratedClipDurationMs: filmSpec.duration.maxGeneratedClipMs,
            targetClipCount: filmSpec.targets.clipCount,
            targetChoiceCount: filmSpec.targets.choiceCount,
            targetEndingCount: filmSpec.targets.endingCount,
            frameWidth: filmSpec.frame.width,
            frameHeight: filmSpec.frame.height,
            frameRateNumerator: filmSpec.frame.framesPerSecond.numerator,
            frameRateDenominator: filmSpec.frame.framesPerSecond.denominator,
            audioSampleRate: filmSpec.audioSampleRateHz,
            defaultLocale: filmSpec.locales.defaultLocale,
            enabledLocales: asJson(filmSpec.locales.enabledLocales),
            defaultCanonicalModelId: canonicalModel.id,
            specJson: asJson(filmSpec),
            specHash: canonicalJsonHash(filmSpec),
            createdByUserId: ownerUserId,
            updatedByUserId: ownerUserId,
          },
        });

        for (const clipSpec of projection.clipSpecs) {
          const media = mediaByGraphNodeId.get(clipSpec.graphNodeId);
          if (!media) {
            throw new Error(`Missing media for ${clipSpec.graphNodeId}.`);
          }
          const specHash = canonicalJsonHash(clipSpec);
          const productionInputManifest = {
            schemaVersion: 1,
            sourcePackage: source.sourceId,
            clip: { graphNodeId: clipSpec.graphNodeId, specHash },
            model: {
              canonicalModelId: canonicalModel.id,
              slug: source.defaultVideoModelSlug,
            },
            outputContract: clipSpec.outputContract,
          };
          const productionInputHash = canonicalJsonHash(
            productionInputManifest,
          );
          const clip = await tx.storyFilmClip.create({
            data: {
              storyProjectId: project.id,
              revisionId: revision.id,
              key: clipSpec.key,
              graphNodeId: clipSpec.graphNodeId,
              title: clipSpec.title,
              generationMode:
                clipSpec.generationControl.mode === 'omni_reference'
                  ? StoryFilmGenerationMode.omni_reference
                  : StoryFilmGenerationMode.frame_lock,
              frameMode:
                clipSpec.generationControl.mode === 'frame_lock'
                  ? clipSpec.generationControl.frameMode === 'first_last_frame'
                    ? StoryFilmFrameMode.first_last_frame
                    : StoryFilmFrameMode.first_frame
                  : null,
              targetDurationMs: clipSpec.targetDurationMs,
              specJson: asJson(clipSpec),
              specHash,
              productionInputManifest: asJson(productionInputManifest),
              productionInputHash,
              rank: clipSpec.rank,
              createdByUserId: ownerUserId,
              updatedByUserId: ownerUserId,
            },
          });
          const asset = await tx.mediaAsset.create({
            data: {
              kind: MediaAssetKind.video,
              storageProvider: MediaStorageProvider.external_url,
              externalUrl: media.externalUrl,
              contentType: media.contentType,
              sizeBytes: BigInt(media.sizeBytes),
              width: media.width,
              height: media.height,
              durationSeconds: media.durationSeconds,
              checksumSha256: media.checksumSha256,
              visibility: MediaAssetVisibility.private,
              status: MediaAssetStatus.ready,
              source: MediaAssetSource.imported,
              moderationStatus: MediaAssetModerationStatus.approved,
              moderationReason: 'Trusted StoryProject source package.',
              moderatedAt: now,
              workspaceId: project.workspaceId,
              createdByUserId: ownerUserId,
              metadata: asJson({
                sourcePackage: source.sourceId,
                graphNodeId: clipSpec.graphNodeId,
              }),
            },
          });
          const placement = await ensureOriginalMediaPlacement(tx, {
            assetId: asset.id,
            storageProvider: MediaStorageProvider.external_url,
            bucket: null,
            region: null,
            objectKey: null,
            externalUrl: media.externalUrl,
            contentType: media.contentType,
            sizeBytes: BigInt(media.sizeBytes),
            width: media.width,
            height: media.height,
            durationSeconds: media.durationSeconds,
            checksumSha256: media.checksumSha256,
          });
          await tx.mediaAssetUsage.create({
            data: {
              assetId: asset.id,
              variantId: placement.variantId,
              userId: ownerUserId,
              workspaceId: project.workspaceId,
              surface: MediaAssetUsageSurface.project,
              sourceSurface: 'story-studio',
              role: MediaAssetUsageRole.output,
              idempotencyKey: `story-source:${source.sourceId}:${project.id}:${clipSpec.graphNodeId}`,
            },
          });
          const technicalChecks = storyFilmTechnicalChecks(
            {
              kind: MediaAssetKind.video,
              width: media.width,
              height: media.height,
              durationSeconds: media.durationSeconds,
              checksumSha256: media.checksumSha256,
            },
            clipSpec.outputContract,
          );
          if (
            technicalChecks.some(
              (check) =>
                typeof check === 'object' &&
                check !== null &&
                'status' in check &&
                check.status === 'failed',
            )
          ) {
            throw new Error(
              `Media for ${clipSpec.graphNodeId} violates its output contract.`,
            );
          }
          await tx.storyFilmClip.update({
            where: { id: clip.id },
            data: {
              currentVideoAssetId: asset.id,
              currentVideoVariantId: placement.variantId,
              currentVideoSpecHash: specHash,
              currentVideoInputHash: productionInputHash,
              currentVideoChecksumSha256: media.checksumSha256,
              currentVideoTechnicalChecks: technicalChecks,
              currentVideoRevision: 1,
              currentVideoSetByUserId: ownerUserId,
              currentVideoSetAt: now,
            },
          });
        }
      },
      { maxWait: 10_000, timeout: 180_000 },
    );

    console.log(
      [
        'Imported StoryProject source into the local database.',
        `sourceId=${source.sourceId}`,
        `projectId=${project.id}`,
        `clips=${projection.clipSpecs.length}`,
        'remoteWrites=0',
      ].join('\n'),
    );
  } finally {
    await prisma.$disconnect();
  }
}

function parseOptions(args: string[]): Options {
  const values = new Map<string, string>();
  let dryRun = false;
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (key === '--dry-run') {
      dryRun = true;
      continue;
    }
    const value = args[index + 1];
    if (!key?.startsWith('--') || !value || value.startsWith('--')) {
      throw new Error(
        'Usage: --project-id <uuid> --input <source.json> [--dry-run]',
      );
    }
    values.set(key, value);
    index += 1;
  }
  const projectId = values.get('--project-id');
  const input = values.get('--input');
  if (!projectId || !input) {
    throw new Error(
      'Usage: --project-id <uuid> --input <source.json> [--dry-run]',
    );
  }
  return { projectId, input, dryRun };
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
