import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, MediaStorageProvider } from '@prisma/client';
import type { StudioDocumentAccessService } from '../documents/studio-document-access.service';
import type { MediaAccessService } from '../media/media-access.service';
import { lockMediaAssetReferences } from '../media/media-asset-lifecycle-lock';
import { captureSavedStoryboard } from './saved-storyboard';

/** Storage identity only: never persist a browser URL or use it as a fetch capability. */
export interface StoryboardSourceObject {
  assetId: string;
  placementId: string | null;
  storageProvider: Exclude<MediaStorageProvider, 'external_url'>;
  bucket: string;
  region: string | null;
  objectKey: string;
  contentType:
    | 'video/mp4'
    | 'video/webm'
    | 'image/png'
    | 'image/jpeg'
    | 'image/webp';
  sizeBytes: string | null;
}

/** Admission primitive. The caller must persist its durable job and retention
 * usages in this SAME transaction before these reference locks are released.
 * Workers and downloads must recheck access; capture does not grant future access. */
export async function captureAuthorizedStoryboard(
  tx: Prisma.TransactionClient,
  documents: Pick<StudioDocumentAccessService, 'requireDocumentRef'>,
  media: Pick<MediaAccessService, 'denialForUse'>,
  userId: string,
  documentId: string,
  expectedSequence: number,
) {
  await documents.requireDocumentRef(userId, documentId, 'read');
  const captured = await captureSavedStoryboard(
    tx,
    documentId,
    expectedSequence,
  );
  const ids = captured.clips.map((clip) => {
    if (!clip.mediaAssetId)
      throw new BadRequestException(
        'A storyboard asset has no saved media identity. Reattach its uploaded or generated media before exporting.',
      );
    return clip.mediaAssetId;
  });
  const objects = await resolveStoryboardSources(tx, media, userId, ids);
  let totalBytes = 0n;
  const clips = captured.clips.map((clip, index) => {
    const source = objects.get(ids[index])!;
    totalBytes += BigInt(source.sizeBytes ?? '0');
    return { shotId: clip.shotId, sourceNodeId: clip.sourceNodeId, source };
  });
  if (totalBytes > 2n * 1024n * 1024n * 1024n)
    throw new BadRequestException(
      'Storyboard media exceed the total export size limit.',
    );
  await documents.requireDocumentRef(userId, documentId, 'read');
  return { document: captured.document, sequence: captured.sequence, clips };
}

/** Resolve exact persisted identities after the caller verifies their sharing
 * context; this helper never grants access based on an arbitrary asset ID. */
export async function resolveStoryboardSources(
  tx: Prisma.TransactionClient,
  media: Pick<MediaAccessService, 'denialForUse'>,
  userId: string,
  ids: readonly string[],
) {
  await lockMediaAssetReferences(tx, ids);
  const assets = await tx.mediaAsset.findMany({
    where: { id: { in: [...new Set(ids)] } },
    include: {
      variants: {
        where: { variantKey: 'original', deletedAt: null },
        include: {
          placements: {
            where: { deletedAt: null },
            orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          },
        },
      },
      placements: {
        where: { variantId: null, deletedAt: null },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      },
    },
  });
  const objects = new Map<string, StoryboardSourceObject>();
  for (const id of [...new Set(ids)]) {
    const asset = assets.find((row) => row.id === id);
    if (!asset || asset.deletedAt)
      throw new NotFoundException('A storyboard asset is no longer available.');
    const denial = media.denialForUse(userId, asset);
    if (denial) throw denial;
    if (asset.kind !== 'video' && asset.kind !== 'image')
      throw new BadRequestException(
        'Every storyboard shot must reference an image or video asset.',
      );
    // The captured saved canvas is the canonical sharing context. Its current
    // read grant covers these exact referenced IDs, including acknowledged edits
    // not compacted into contentSnapshot yet. Common lifecycle/moderation/receipt
    // gates above still apply, exactly as for canvas media consumption.
    const original = asset.variants[0];
    if (original && original.status !== 'ready')
      throw new ConflictException('An original storyboard asset is not ready.');
    const placements = original ? original.placements : asset.placements;
    const placement = placements.find(
      (row) =>
        row.status === 'active' &&
        row.storageProvider !== 'external_url' &&
        row.bucket &&
        row.objectKey,
    );
    if (placements.length && !placement)
      throw new ConflictException(
        'No active managed storage copy is available for a storyboard media.',
      );
    if (original && !placement)
      throw new ConflictException(
        'The original storyboard asset has no active storage copy.',
      );
    const ref = placement ?? asset;
    if (ref.storageProvider === 'external_url' || !ref.bucket || !ref.objectKey)
      throw new BadRequestException(
        'Upload external storyboard media to platform storage before exporting.',
      );
    const contentType = original?.contentType ?? asset.contentType;
    if (
      contentType !== 'video/mp4' &&
      contentType !== 'video/webm' &&
      contentType !== 'image/png' &&
      contentType !== 'image/jpeg' &&
      contentType !== 'image/webp'
    )
      throw new BadRequestException(
        'Storyboard export supports original MP4/WebM videos and PNG/JPEG/WebP images.',
      );
    if (!contentType.startsWith(`${asset.kind}/`))
      throw new BadRequestException(
        'Storyboard media type does not match its asset kind.',
      );
    const size = original?.sizeBytes ?? asset.sizeBytes;
    if (size !== null && (size <= 0n || size > 512n * 1024n * 1024n))
      throw new BadRequestException(
        'A storyboard asset exceeds the export size limit.',
      );
    objects.set(id, {
      assetId: id,
      placementId: placement?.id ?? null,
      storageProvider: ref.storageProvider,
      bucket: ref.bucket,
      region: ref.region,
      objectKey: ref.objectKey,
      contentType,
      sizeBytes: size?.toString() ?? null,
    });
  }
  return objects;
}
