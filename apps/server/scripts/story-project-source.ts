import { readFileSync } from 'node:fs';

import { z } from 'zod';

import { LockableInteractiveFilmDraftContentSchema } from '../src/story-studio/interactive-film.schema';

const SourceMediaSchema = z
  .object({
    externalUrl: z
      .string()
      .url()
      .refine((value) => new URL(value).protocol === 'https:', {
        message: 'Source media must use HTTPS.',
      }),
    contentType: z.literal('video/mp4'),
    sizeBytes: z.string().regex(/^[1-9]\d*$/),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    durationSeconds: z.number().int().positive(),
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

const SourceClipSchema = z
  .object({
    graphNodeId: z.string().min(1).max(128),
    media: SourceMediaSchema,
  })
  .strict();

export const StoryProjectSourcePackageSchema = z
  .object({
    schemaVersion: z.literal('story-project-source-v1'),
    sourceId: z.string().min(1).max(160),
    project: z
      .object({
        title: z.string().min(1).max(160),
        summary: z.string().nullable(),
        defaultLocale: z.string().min(2).max(16),
        frameProfile: z.enum(['landscape_16_9', 'portrait_9_16']),
        tags: z.array(z.string().min(1).max(80)).max(64),
      })
      .strict(),
    sourceRevision: z
      .object({
        number: z.number().int().positive(),
        label: z.string().nullable(),
      })
      .strict(),
    defaultVideoModelSlug: z.string().min(1).max(120),
    draft: LockableInteractiveFilmDraftContentSchema,
    canvasLayout: z.record(
      z.string(),
      z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
    ),
    clips: z.array(SourceClipSchema).min(1).max(500),
  })
  .strict()
  .superRefine((source, context) => {
    const graphNodeIds = new Set(
      source.draft.graph.nodes
        .filter((node) => node.kind === 'clip')
        .map((node) => node.nodeId),
    );
    const mediaNodeIds = new Set<string>();
    source.clips.forEach((clip, index) => {
      if (mediaNodeIds.has(clip.graphNodeId)) {
        context.addIssue({
          code: 'custom',
          path: ['clips', index, 'graphNodeId'],
          message: `Duplicate media binding for ${clip.graphNodeId}.`,
        });
      }
      mediaNodeIds.add(clip.graphNodeId);
      if (!graphNodeIds.has(clip.graphNodeId)) {
        context.addIssue({
          code: 'custom',
          path: ['clips', index, 'graphNodeId'],
          message: `Unknown graph clip ${clip.graphNodeId}.`,
        });
      }
    });
    graphNodeIds.forEach((graphNodeId) => {
      if (!mediaNodeIds.has(graphNodeId)) {
        context.addIssue({
          code: 'custom',
          path: ['clips'],
          message: `Missing current video for ${graphNodeId}.`,
        });
      }
    });
  });

export type StoryProjectSourcePackage = z.infer<
  typeof StoryProjectSourcePackageSchema
>;

export function readStoryProjectSourcePackage(
  filePath: string,
): StoryProjectSourcePackage {
  return StoryProjectSourcePackageSchema.parse(
    JSON.parse(readFileSync(filePath, 'utf8')),
  );
}

export function assertLocalDatabaseUrl(): void {
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
