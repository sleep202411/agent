import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { compareByOrder } from '@repo/shared';
import { z } from 'zod';
import { DocumentStateBuilder } from '../documents/document-crdt';
import { rootSchemaFor } from '../documents/document-modes';
import { readDocumentCrdtState } from '../documents/document-persisted-state';

const Node = z.object({
  id: z.string().min(1),
  type: z.string(),
  data: z.record(z.string(), z.unknown()).default({}),
});
const Edge = z.object({
  id: z.string().min(1),
  source: z.string(),
  target: z.string(),
});
const Snapshot = z.object({
  nodes: z.record(z.string(), Node),
  edges: z.record(z.string(), Edge),
});
const Reference = z.object({
  edgeId: z.string().optional(),
  url: z.string().optional(),
  assetId: z.string().uuid().optional(),
});
const Generation = z.object({
  status: z.string(),
  outputs: z
    .array(
      z.object({
        url: z.string().optional(),
        assetId: z.string().uuid().optional(),
      }),
    )
    .optional(),
});
export interface StoryboardExportSource {
  shotId: string;
  sourceNodeId: string;
  /** Identity hints only. Resolve through canonical media access; never fetch this URL. */
  mediaAssetId: string | null;
  sourceUrl: string;
}
/** Mirrors the canvas storyboard projection: saved fractional shot order,
 * then the first ready video, or the preferred/first ready still image. */
export function projectSavedStoryboard(raw: unknown): StoryboardExportSource[] {
  const snapshot = Snapshot.parse(raw);
  for (const [id, node] of Object.entries(snapshot.nodes))
    if (id !== node.id)
      throw new BadRequestException('Canvas node identity is inconsistent.');
  for (const [id, edge] of Object.entries(snapshot.edges))
    if (id !== edge.id)
      throw new BadRequestException('Canvas edge identity is inconsistent.');
  const shots = Object.values(snapshot.nodes)
    .filter((n) => n.type === 'shot')
    .sort((a, b) =>
      compareByOrder(
        { id: a.id, order: z.string().optional().parse(a.data.order) },
        { id: b.id, order: z.string().optional().parse(b.data.order) },
      ),
    );
  if (!shots.length || shots.length > 100)
    throw new BadRequestException('Export requires between 1 and 100 shots.');
  return shots.map((shot) => {
    const references = z
      .record(z.string(), z.array(Reference))
      .parse(shot.data.references ?? {});
    const bound = new Map(
      Object.values(references)
        .flat()
        .filter((r) => r.edgeId)
        .map((r) => [r.edgeId!, r]),
    );
    const incoming = Object.values(snapshot.edges).filter(
      (e) => e.target === shot.id,
    );
    // Stable sorting preserves saved edge order within each media priority.
    const priority = (edge: z.infer<typeof Edge>) => {
      const type = snapshot.nodes[edge.source]?.type;
      if (type === 'video' || type === 'videoAsset') return 0;
      return edge.id === shot.data.preferredFrameEdgeId ? 1 : 2;
    };
    for (const edge of incoming.sort((a, b) => priority(a) - priority(b))) {
      const source = snapshot.nodes[edge.source];
      if (
        !source ||
        !['video', 'videoAsset', 'image', 'panorama', 'prompt'].includes(
          source.type,
        )
      )
        continue;
      const generation = source.data.generation
        ? Generation.parse(source.data.generation)
        : null;
      if (generation && !['done', 'cancelled'].includes(generation.status))
        continue;
      const output = ['video', 'prompt'].includes(source.type)
        ? generation?.outputs?.[0]
        : undefined;
      const sourceUrl =
        output?.url ??
        (['videoAsset', 'image', 'panorama'].includes(source.type)
          ? z.string().optional().parse(source.data.src)
          : undefined);
      const reference = bound.get(edge.id);
      const url = reference?.url ?? sourceUrl;
      if (!url) continue;
      if (url.length > 4096 || /^(blob|data|file):/i.test(url))
        throw new BadRequestException(
          'Storyboard media is not saved as platform media.',
        );
      const sourceId =
        output?.assetId ??
        (['videoAsset', 'image', 'panorama'].includes(source.type)
          ? z.string().uuid().optional().parse(source.data.mediaAssetId)
          : undefined);
      // A bound reference can point to an older, deliberately selected output.
      // Never attach the new source asset ID to that older URL.
      const id =
        reference?.assetId ?? (url === sourceUrl ? sourceId : undefined);
      return {
        shotId: shot.id,
        sourceNodeId: source.id,
        mediaAssetId: id?.toLowerCase() ?? null,
        sourceUrl: url,
      };
    }
    throw new BadRequestException(
      `Shot ${shot.id} has no ready media. Attach an image or video before exporting.`,
    );
  });
}
/** Admission-only primitive: the caller must authorize before entering this
 * transaction and resolve/pin all source media before committing its job.
 * No route exposes this function directly. */
export async function captureSavedStoryboard(
  tx: Prisma.TransactionClient,
  documentId: string,
  expectedSequence: number,
) {
  z.string().uuid().parse(documentId);
  z.number().int().nonnegative().parse(expectedSequence);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`platform-document:${documentId}`})::bigint)`;
  const document = await tx.studioDocument.findFirst({
    where: {
      id: documentId,
      type: 'canvas',
      status: 'active',
      deletedAt: null,
    },
    select: {
      id: true,
      workspaceId: true,
      platformProjectId: true,
      storyProjectId: true,
      currentSequence: true,
    },
  });
  if (!document) throw new NotFoundException('Active canvas not found.');
  if (document.currentSequence !== expectedSequence)
    throw new ConflictException(
      'The saved canvas changed. Sync the storyboard before exporting.',
    );
  const state = await readDocumentCrdtState(tx, documentId);
  if (state.unsupported_sequence !== null)
    throw new ConflictException(
      'The canvas contains unsupported pending changes. Sync before exporting.',
    );
  let snapshot: unknown = state.content_snapshot;
  if (state.crdt_state || state.updates?.length) {
    if (!state.crdt_state && state.snapshot_sequence > 0)
      throw new ConflictException('The canvas checkpoint is unavailable.');
    const builder = new DocumentStateBuilder(
      state.crdt_state,
      rootSchemaFor('canvas'),
    );
    try {
      for (const update of state.updates ?? [])
        builder.apply(Buffer.from(update, 'base64'));
      if (builder.hasUnresolvedUpdates())
        throw new ConflictException(
          'Some canvas edits are waiting for dependencies. Sync before exporting.',
        );
      snapshot = builder.snapshot();
    } finally {
      builder.destroy();
    }
  }
  return {
    document,
    sequence: state.current_sequence,
    clips: projectSavedStoryboard(snapshot),
  };
}
