import { UnprocessableEntityException } from '@nestjs/common';
import { z } from 'zod';
import {
  StoreListingSchema,
  StoredStoreListingSchema,
  type StoryProjectSummaryDto,
} from './dto';

export const StoryPublicationListingSnapshotSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    defaultLocale: z.string().trim().min(2).max(16),
    coverAssetId: z.uuid().nullable(),
    listing: StoredStoreListingSchema.pipe(StoreListingSchema),
  })
  .strict();

export type StoryPublicationListingSnapshot = z.infer<
  typeof StoryPublicationListingSnapshotSchema
>;

export function publicationListingSnapshot(
  project: StoryProjectSummaryDto,
): StoryPublicationListingSnapshot {
  const parsed = StoreListingSchema.safeParse(
    project.storeListing ?? {
      description: '',
      tags: [],
      developer: '',
      trailerAssetId: null,
      screenshotAssetIds: [],
    },
  );
  if (!parsed.success) {
    throw new UnprocessableEntityException({
      code: 'STORY_RELEASE_INTRODUCTION_INVALID',
      message: 'The work introduction contains invalid fields.',
      fields: [
        ...new Set(
          parsed.error.issues.map((issue) =>
            String(issue.path[0] ?? 'storeListing'),
          ),
        ),
      ],
    });
  }
  return StoryPublicationListingSnapshotSchema.parse({
    title: project.title,
    defaultLocale: project.defaultLocale,
    coverAssetId: project.cover?.id ?? null,
    listing: parsed.data,
  });
}
