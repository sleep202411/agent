import type { Prisma } from '@prisma/client';
import { lockMediaAssetReferences } from '../media/media-asset-lifecycle-lock';
import { requireStoryCandidateMedia } from './story-candidate-media';
import {
  MAX_PLOT_IMPORT_SEQUENCE_DURATION_MS,
  MIN_PLOT_IMPORT_CLIP_DURATION_MS,
  StoryPlotImportError,
  type StoryPlotImport,
} from './story-plot-import';

export type StoryPlotMediaBinding = {
  nodeId: string;
  clipId: string;
  mediaAssetId: string;
};

/** Validate all references before any graph or production writes. */
export async function resolveStoryPlotImportMedia(
  tx: Prisma.TransactionClient,
  projectId: string,
  plot: StoryPlotImport,
  bindings: readonly StoryPlotMediaBinding[],
): Promise<{ plot: StoryPlotImport; mediaByClip: Map<string, string> }> {
  const mediaByClip = new Map<string, string>();
  const clipsByKey = new Map(
    plot.nodes.flatMap((node) =>
      node.type === 'scene'
        ? node.storyboard.clips.map(
            (clip) => [clipKey(node.id, clip.id), clip] as const,
          )
        : [],
    ),
  );
  for (const [index, binding] of bindings.entries()) {
    const key = clipKey(binding.nodeId, binding.clipId);
    const clip = clipsByKey.get(key);
    if (!clip?.videoFile || clip.kind !== 'video' || mediaByClip.has(key)) {
      throw new StoryPlotImportError('media', `$.media[${index}]`);
    }
    mediaByClip.set(key, binding.mediaAssetId);
  }
  if (
    bindings.length &&
    [...clipsByKey].some(
      ([key, clip]) => clip.videoFile && !mediaByClip.has(key),
    )
  ) {
    throw new StoryPlotImportError('media', '$.media');
  }
  const assetIds = [...new Set(mediaByClip.values())].sort();
  for (let offset = 0; offset < assetIds.length; offset += 500) {
    await lockMediaAssetReferences(tx, assetIds.slice(offset, offset + 500));
  }
  const durations = new Map<string, number>();
  for (const mediaAssetId of assetIds) {
    const media = await requireStoryCandidateMedia(
      tx,
      projectId,
      mediaAssetId,
      'video',
      'storyboard_clip',
    );
    if (
      media.durationMs === null ||
      !Number.isInteger(media.durationMs) ||
      media.durationMs < MIN_PLOT_IMPORT_CLIP_DURATION_MS ||
      media.durationMs > MAX_PLOT_IMPORT_SEQUENCE_DURATION_MS
    ) {
      throw new StoryPlotImportError('duration', '$.media');
    }
    durations.set(mediaAssetId, media.durationMs);
  }
  return {
    mediaByClip,
    plot: {
      ...plot,
      nodes: plot.nodes.map((node, index) => {
        if (node.type !== 'scene') return node;
        const clips = node.storyboard.clips.map((clip) => {
          const mediaAssetId = mediaByClip.get(clipKey(node.id, clip.id));
          return mediaAssetId
            ? { ...clip, durationMs: durations.get(mediaAssetId)! }
            : clip;
        });
        if (
          clips.reduce((sum, clip) => sum + clip.durationMs, 0) >
          MAX_PLOT_IMPORT_SEQUENCE_DURATION_MS
        ) {
          throw new StoryPlotImportError(
            'duration',
            `$.nodes[${index}].storyboard.clips`,
          );
        }
        return { ...node, storyboard: { clips } };
      }),
    },
  };
}

export function clipKey(nodeId: string, clipId: string): string {
  return `${nodeId}/${clipId}`;
}
