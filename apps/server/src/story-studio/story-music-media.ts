import { MediaAssetKind, Prisma, type PrismaClient } from '@prisma/client';
import { isRuntimeMediaUri } from '@repo/shared/interactive-film-runtime';
import { resolveMediaPublicUrl } from '../infra/storage/media-asset-url-resolver.service';
import type { CreatableStoryFormat } from './dto';
import type { InteractiveStoryDraftContent } from './interactive-film.schema';

/**
 * Background music is a PLAIN MEDIA REFERENCE, not a frozen build asset.
 *
 * The freeze pipeline exists because losing a clip breaks the story; losing a
 * music bed only means silence, so music resolves to the same ordinary public
 * media URL every other product surface hands out — unguessable, cacheable, no
 * expiry. A signed URL would be wrong here on its own terms: a bed loops for a
 * whole run (session TTL 2h) and a 5-minute `no-store` link cannot serve that.
 *
 * The contract of this module is that it CANNOT FAIL. Every reason a track
 * might not play — deleted, blocked, still processing, another workspace's
 * asset, no storage placement — resolves to "no URL", which the compiler reads
 * as "this scene has no music". Publishing never blocks on a bed.
 */

const MUSIC_ASSET_SELECT = Prisma.validator<Prisma.MediaAssetSelect>()({
  id: true,
  storageProvider: true,
  bucket: true,
  region: true,
  objectKey: true,
  externalUrl: true,
  status: true,
  moderationStatus: true,
  deletedAt: true,
  placements: true,
});

/** The DISTINCT music assets a draft binds — a theme on five scenes is one. */
export function boundMusicAssetIds(
  draft: InteractiveStoryDraftContent,
): string[] {
  return [
    ...new Set(
      draft.graph.nodes.flatMap((node) =>
        node.music ? [node.music.mediaAssetId] : [],
      ),
    ),
  ].sort();
}

/**
 * Playable URL per bound music asset. Assets that resolve to nothing are simply
 * absent from the map.
 *
 * The workspace filter is the one real gate: an asset from another workspace
 * must never be published inside someone else's release. It is expressed as a
 * query predicate rather than a diagnostic, so a stray binding is silence
 * instead of a publish blocker.
 *
 * `format` is the second gate, and it is here rather than at each caller so no
 * caller can forget it: only the narrative runtime reads a scene's bed, and the
 * compiler drops music outright for `interactive_film`, so resolving it for a
 * film project would be a query whose result is thrown away.
 */
export async function resolveStoryMusicUrls(
  db: Pick<PrismaClient, 'mediaAsset'>,
  workspaceId: string,
  format: CreatableStoryFormat,
  draft: InteractiveStoryDraftContent,
): Promise<Map<string, string>> {
  if (format === 'interactive_film') return new Map();
  const assetIds = boundMusicAssetIds(draft);
  // The overwhelming majority of stories bind nothing, and those must cost no
  // query at all.
  if (assetIds.length === 0) return new Map();
  const assets = await db.mediaAsset.findMany({
    where: {
      id: { in: assetIds },
      workspaceId,
      kind: MediaAssetKind.audio,
    },
    select: MUSIC_ASSET_SELECT,
  });
  const urls = new Map<string, string>();
  assets.forEach((asset) => {
    // `resolvePublicUrl` is the single gate for deleted / unready / blocked
    // media and never throws — exactly the "no URL means silence" shape.
    const url = resolveMediaPublicUrl(asset)?.trim();
    if (url && isRuntimeMediaUri(url)) urls.set(asset.id, url);
  });
  return urls;
}
