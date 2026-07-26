import { z } from 'zod';
import { canonicalJsonHash } from './canonical-json';

const StoryVideoSelectionMutationFields = {
  // Optional for the same reason the Build tokens are: binding a clip is a
  // routine authoring act, and making every caller first read a version number
  // to perform it buys nothing a re-bind would not fix.
  expectedSelectionVersion: z.number().int().nonnegative().optional(),
  assetId: z.string().uuid().nullable(),
  variantId: z.string().uuid().nullable(),
} as const;

function validateSelectedAsset(
  input: { assetId: string | null; variantId: string | null },
  context: z.RefinementCtx,
): void {
  if ((input.assetId === null) !== (input.variantId === null)) {
    context.addIssue({
      code: 'custom',
      path: input.assetId === null ? ['assetId'] : ['variantId'],
      message: 'assetId and variantId must both be UUIDs or both be null.',
    });
  }
}

export const PutStoryClipVideoSelectionSchema = z
  .object({
    expectedDraftRevision: z.number().int().nonnegative().optional(),
    ...StoryVideoSelectionMutationFields,
  })
  .strict()
  .superRefine(validateSelectedAsset);
export type PutStoryClipVideoSelectionInput = z.infer<
  typeof PutStoryClipVideoSelectionSchema
>;

const StoryVideoSnapshotNullableMediaFields = {
  assetId: z.string().uuid().nullable(),
  variantId: z.string().uuid().nullable(),
  checksumSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  contentType: z
    .string()
    .refine((value) => value.toLowerCase().startsWith('video/'), {
      message: 'contentType must be a video/* MIME type',
    })
    .nullable(),
  durationMs: z.number().int().positive().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  browserSafeMp4: z.boolean().nullable(),
} as const;

/**
 * The exact current-video identity consumed by preview and immutable Builds.
 * Asset and variant IDs are the durable playback identity. Technical metadata
 * is advisory: it may be populated by probing, but its absence never makes a
 * ready, accessible video selection invalid.
 */
export const StoryVideoSnapshotEntrySchema = z
  .object({
    graphNodeId: z.string().trim().min(1).max(128),
    selectionVersion: z.number().int().nonnegative(),
    ...StoryVideoSnapshotNullableMediaFields,
  })
  .strict()
  .superRefine((entry, context) => {
    const hasAsset = entry.assetId !== null;
    const hasVariant = entry.variantId !== null;
    const hasContentType = entry.contentType !== null;
    if (hasAsset !== hasVariant || hasAsset !== hasContentType) {
      context.addIssue({
        code: 'custom',
        message:
          'A video snapshot entry must contain assetId, variantId, and contentType together.',
      });
    }
    if (
      !hasAsset &&
      [
        entry.checksumSha256,
        entry.durationMs,
        entry.width,
        entry.height,
        entry.browserSafeMp4,
      ].some((value) => value !== null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'An empty video selection cannot contain technical metadata.',
      });
    }
  });
export type StoryVideoSnapshotEntry = z.infer<
  typeof StoryVideoSnapshotEntrySchema
>;

export function storyVideoSnapshotHash(
  entries: readonly StoryVideoSnapshotEntry[],
): string {
  const canonicalEntries = entries
    .map((entry) => StoryVideoSnapshotEntrySchema.parse(entry))
    .sort((left, right) => left.graphNodeId.localeCompare(right.graphNodeId));
  const nodeIds = new Set(canonicalEntries.map((entry) => entry.graphNodeId));
  if (nodeIds.size !== canonicalEntries.length) {
    throw new Error('A video snapshot may contain each graph node only once.');
  }
  return canonicalJsonHash(canonicalEntries);
}
