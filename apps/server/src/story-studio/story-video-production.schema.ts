import { z } from 'zod';
import { canonicalJsonHash } from './canonical-json';

const StoryVideoSnapshotNullableMediaFields = {
  assetId: z.string().uuid().nullable(),
  variantId: z.string().uuid().nullable(),
  checksumSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  contentType: z
    .string()
    .refine(
      (value) => {
        const lower = value.toLowerCase();
        // Storyboard segments are video footage or still images.
        return lower.startsWith('video/') || lower.startsWith('image/');
      },
      { message: 'contentType must be a video/* or image/* MIME type' },
    )
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

/** Advisory browser-compatibility probe result carried on variant metadata. */
export function isBrowserSafeMp4Metadata(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { browserSafeMp4?: unknown }).browserSafeMp4 === true
  );
}

/**
 * Structural shape of a storyboard clip row as every snapshot consumer loads
 * it. Build, Working Preview and the workbench projection all hash the SAME
 * entry through {@link storyboardClipSnapshotEntry}, so the publish conflict
 * gate can compare hashes computed in different services.
 */
export interface StoryboardSnapshotVariant {
  id: string;
  variantKey: string;
  checksumSha256: string | null;
  contentType: string;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  metadata: unknown;
}

export interface StoryboardClipSnapshotSource {
  id: string;
  version: number;
  selectedMediaVersion: {
    mediaAssetId: string;
    archivedAt: Date | null;
    preferredVariant: StoryboardSnapshotVariant | null;
    mediaAsset: { variants: StoryboardSnapshotVariant[] };
  } | null;
}

/**
 * The playable rendition of a clip's selected creative media: the explicitly
 * preferred rendition when one is set, otherwise the original upload/output.
 */
export function chooseStoryboardClipVariant<
  V extends Pick<StoryboardSnapshotVariant, 'variantKey'>,
>(media: {
  preferredVariant: V | null;
  mediaAsset: { variants: V[] };
}): V | null {
  return (
    media.preferredVariant ??
    media.mediaAsset.variants.find(
      (variant) => variant.variantKey === 'original',
    ) ??
    null
  );
}

/**
 * One clip's contribution to the video snapshot hash. The identity is the
 * storyboard clip itself; its version covers every selection change (and any
 * clip edit) since the last snapshot.
 */
export function storyboardClipSnapshotEntry(
  clip: StoryboardClipSnapshotSource,
): StoryVideoSnapshotEntry {
  const media =
    clip.selectedMediaVersion && clip.selectedMediaVersion.archivedAt === null
      ? clip.selectedMediaVersion
      : null;
  const variant = media ? chooseStoryboardClipVariant(media) : null;
  const candidate = {
    graphNodeId: clip.id,
    selectionVersion: clip.version,
    assetId: media && variant ? media.mediaAssetId : null,
    variantId: variant?.id ?? null,
    checksumSha256: variant?.checksumSha256 ?? null,
    contentType: variant?.contentType ?? null,
    durationMs: variant?.durationMs ?? null,
    width: variant?.width ?? null,
    height: variant?.height ?? null,
    browserSafeMp4: variant ? isBrowserSafeMp4Metadata(variant.metadata) : null,
  };
  const parsed = StoryVideoSnapshotEntrySchema.safeParse(candidate);
  // A partial selection still needs a deterministic identity; the clip version
  // changes whenever the creator edits it.
  if (parsed.success) return parsed.data;
  return StoryVideoSnapshotEntrySchema.parse({
    graphNodeId: clip.id,
    selectionVersion: clip.version,
    assetId: null,
    variantId: null,
    checksumSha256: null,
    contentType: null,
    durationMs: null,
    width: null,
    height: null,
    browserSafeMp4: null,
  });
}

/** Sequence edits include node subtitle changes, and must invalidate immutable Builds. */
export function storyboardSequenceSnapshotEntries(sequence: {
  id: string;
  version: number;
  clips: readonly StoryboardClipSnapshotSource[];
}): StoryVideoSnapshotEntry[] {
  return [
    {
      graphNodeId: sequence.id,
      selectionVersion: sequence.version,
      assetId: null,
      variantId: null,
      checksumSha256: null,
      contentType: null,
      durationMs: null,
      width: null,
      height: null,
      browserSafeMp4: null,
    },
    ...sequence.clips.map(storyboardClipSnapshotEntry),
  ];
}
