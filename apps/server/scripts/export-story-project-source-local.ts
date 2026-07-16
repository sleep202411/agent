import 'dotenv/config';

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { buildPrisma } from '../src/infra/db/db.module';
import {
  StoryProjectSourcePackageSchema,
  assertLocalDatabaseUrl,
} from './story-project-source';

interface Options {
  projectId: string;
  revisionNumber: number;
  sourceId: string;
  output: string;
}

async function main(): Promise<void> {
  assertLocalDatabaseUrl();
  const options = parseOptions(process.argv.slice(2));
  const prisma = buildPrisma();
  await prisma.$connect();
  try {
    const project = await prisma.storyProject.findUniqueOrThrow({
      where: { id: options.projectId },
      include: {
        canvasLayout: true,
        revisions: {
          where: { number: options.revisionNumber },
          include: {
            filmSpecs: {
              include: {
                defaultCanonicalModel: { select: { slug: true } },
              },
            },
            filmClips: {
              where: { archivedAt: null },
              orderBy: [{ rank: 'asc' }, { id: 'asc' }],
              include: {
                currentVideoAsset: true,
                currentVideoVariant: true,
              },
            },
          },
        },
      },
    });
    const revision = project.revisions[0];
    if (!revision) {
      throw new Error(
        `Revision ${options.revisionNumber} was not found in ${options.projectId}.`,
      );
    }
    const filmSpec = revision.filmSpecs[0];
    if (!filmSpec) throw new Error('The source Revision has no FilmSpec.');

    const source = StoryProjectSourcePackageSchema.parse({
      schemaVersion: 'story-project-source-v1',
      sourceId: options.sourceId,
      project: {
        title: project.title,
        summary: project.summary,
        defaultLocale: project.defaultLocale,
        frameProfile: project.frameProfile,
        tags: stringArray(project.tags),
      },
      sourceRevision: {
        number: revision.number,
        label: revision.label,
      },
      defaultVideoModelSlug: filmSpec.defaultCanonicalModel.slug,
      draft: revision.content,
      canvasLayout: project.canvasLayout?.nodePositions ?? {},
      clips: revision.filmClips.map((clip) => {
        const asset = clip.currentVideoAsset;
        const variant = clip.currentVideoVariant;
        if (
          !asset?.externalUrl ||
          !variant ||
          !clip.currentVideoChecksumSha256 ||
          !positiveInteger(variant.sizeBytes ?? asset.sizeBytes) ||
          !positiveInteger(variant.width ?? asset.width) ||
          !positiveInteger(variant.height ?? asset.height) ||
          !positiveInteger(variant.durationSeconds ?? asset.durationSeconds)
        ) {
          throw new Error(
            `Clip ${clip.graphNodeId} has no complete portable external current video.`,
          );
        }
        const sizeBytes = variant.sizeBytes ?? asset.sizeBytes;
        const width = variant.width ?? asset.width;
        const height = variant.height ?? asset.height;
        const durationSeconds =
          variant.durationSeconds ?? asset.durationSeconds;
        return {
          graphNodeId: clip.graphNodeId,
          media: {
            externalUrl: asset.externalUrl,
            contentType: 'video/mp4' as const,
            sizeBytes: String(sizeBytes),
            width,
            height,
            durationSeconds,
            checksumSha256: clip.currentVideoChecksumSha256,
          },
        };
      }),
    });

    const outputPath = path.resolve(options.output);
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(source, null, 2)}\n`, 'utf8');
    console.log(
      `Exported ${source.clips.length} clips from Revision ${revision.number} to ${outputPath}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

function parseOptions(args: string[]): Options {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || !value || value.startsWith('--')) {
      throw new Error(
        'Usage: --project-id <uuid> --revision-number <n> --source-id <id> --output <file>',
      );
    }
    values.set(key, value);
  }
  const projectId = values.get('--project-id');
  const sourceId = values.get('--source-id');
  const output = values.get('--output');
  const revisionNumber = Number(values.get('--revision-number'));
  if (
    !projectId ||
    !sourceId ||
    !output ||
    !Number.isInteger(revisionNumber) ||
    revisionNumber < 1
  ) {
    throw new Error(
      'Usage: --project-id <uuid> --revision-number <n> --source-id <id> --output <file>',
    );
  }
  return { projectId, revisionNumber, sourceId, output };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function positiveInteger(
  value: number | bigint | null | undefined,
): value is number | bigint {
  return value != null && Number.isInteger(Number(value)) && Number(value) > 0;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
