import { UnprocessableEntityException } from '@nestjs/common';
import { z } from 'zod';
import {
  StoreListingSchema,
  StoredStoreListingSchema,
  type StoryProjectSummaryDto,
} from './dto';

/** A release introduction requires a description; creator metadata may be empty. */
export const PublishedStoreListingSchema = StoreListingSchema.superRefine(
  (listing, context) => {
    if (!listing.description) {
      context.addIssue({
        code: 'custom',
        path: ['description'],
        message: 'Add a work description before submitting for review.',
      });
    }
  },
);

export const StoryPublicationListingSnapshotSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    defaultLocale: z.string().trim().min(2).max(16),
    coverAssetId: z.uuid(),
    listing: StoredStoreListingSchema.pipe(PublishedStoreListingSchema),
  })
  .strict();

export type StoryPublicationListingSnapshot = z.infer<
  typeof StoryPublicationListingSnapshotSchema
>;

export function publicationListingSnapshot(
  project: StoryProjectSummaryDto,
): StoryPublicationListingSnapshot {
  const parsed = PublishedStoreListingSchema.safeParse(project.storeListing);
  if (!parsed.success) {
    throw new UnprocessableEntityException({
      code: 'STORY_RELEASE_INTRODUCTION_REQUIRED',
      message: 'Add a work description before submitting for review.',
      fields: [
        ...new Set(
          parsed.error.issues.map((issue) =>
            String(issue.path[0] ?? 'storeListing'),
          ),
        ),
      ],
    });
  }
  if (!project.cover?.id) {
    throw new UnprocessableEntityException({
      code: 'STORY_RELEASE_COVER_REQUIRED',
      message:
        'Select a ready project cover before submitting this work for review.',
    });
  }
  return StoryPublicationListingSnapshotSchema.parse({
    title: project.title,
    defaultLocale: project.defaultLocale,
    coverAssetId: project.cover.id,
    listing: parsed.data,
  });
}
