import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Prisma, StoryboardExportJob } from '@prisma/client';
import { z } from 'zod';
import type { StudioDocumentAccessService } from '../documents/studio-document-access.service';
import type { MediaAccessService } from '../media/media-access.service';
import { resolveStoryboardSources } from './authorized-storyboard';

const Source = z.strictObject({
  assetId: z.uuid(),
  placementId: z.uuid().nullable(),
  storageProvider: z.enum(['azure_blob', 'aliyun_oss', 's3_compatible']),
  bucket: z.string().min(1),
  region: z.string().nullable(),
  objectKey: z.string().min(1),
  contentType: z.enum(['video/mp4', 'video/webm']),
  sizeBytes: z
    .string()
    .regex(/^[1-9]\d*$/)
    .nullable(),
});
const Clips = z
  .array(
    z.strictObject({
      shotId: z.string().min(1),
      sourceNodeId: z.string().min(1),
      source: Source,
    }),
  )
  .min(1)
  .max(100);

/** Recheck the retained snapshot, not today's edited canvas. Call inside the
 * transaction that publishes a result or issues its protected download URL. */
export async function reauthorizeStoryboardJob(
  tx: Prisma.TransactionClient,
  documents: Pick<StudioDocumentAccessService, 'requireDocumentRef'>,
  media: Pick<MediaAccessService, 'denialForUse'>,
  job: StoryboardExportJob,
) {
  // Refresh under a shared row lock so cancellation/expiry cannot commit while
  // this transaction authorizes publication or signs a download.
  await tx.$executeRaw`SELECT id FROM storyboard_export_jobs WHERE id = ${job.id}::uuid FOR SHARE`;
  const currentJob = await tx.storyboardExportJob.findUnique({
    where: { id: job.id },
  });
  if (!currentJob || currentJob.userId !== job.userId)
    throw new NotFoundException('Export is no longer available.');
  job = currentJob;
  if (
    !job.documentId ||
    job.expiresAt.getTime() <= Date.now() ||
    job.cancelRequested ||
    !['running', 'completed'].includes(job.status)
  )
    throw new NotFoundException('Export is no longer available.');
  await documents.requireDocumentRef(job.userId, job.documentId, 'read');
  const document = await tx.studioDocument.findUnique({
    where: { id: job.documentId },
    select: { status: true, deletedAt: true },
  });
  if (!document || document.deletedAt || document.status !== 'active')
    throw new NotFoundException('The source canvas is no longer available.');
  const clips = Clips.parse(job.clips);
  const ids = [...new Set(clips.map((clip) => clip.source.assetId))];
  const pins = await tx.mediaAssetUsage.findMany({
    where: {
      storyboardExportJobId: job.id,
      deletedAt: null,
      assetId: { in: ids },
    },
    select: { assetId: true },
  });
  if (ids.some((id) => !pins.some((pin) => pin.assetId === id)))
    throw new ConflictException('An export source is no longer retained.');
  const current = await resolveStoryboardSources(tx, media, job.userId, ids);
  for (const clip of clips) {
    const actual = current.get(clip.source.assetId)!;
    if (
      (Object.keys(clip.source) as Array<keyof typeof clip.source>).some(
        (key) => actual[key] !== clip.source[key],
      )
    )
      throw new ConflictException(
        'A storyboard source changed after this export was requested. Create a new export.',
      );
  }
  await documents.requireDocumentRef(job.userId, job.documentId, 'read');
  return clips;
}
