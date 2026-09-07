import { MediaProcessingJobType, Prisma } from '@prisma/client';

export const VIDEO_POSTER_VARIANT_KEY = 'poster_480';

/** Original bytes are immutable. Repeated reads/ingestion must not restart work. */
export function ensureVideoPosterJob(
  client: Prisma.TransactionClient,
  assetId: string,
) {
  return client.mediaProcessingJob.upsert({
    where: { idempotencyKey: `video-poster:${assetId}` },
    create: {
      assetId,
      jobType: MediaProcessingJobType.poster,
      idempotencyKey: `video-poster:${assetId}`,
      priority: 20,
      maxAttempts: 4,
    },
    update: {},
  });
}
