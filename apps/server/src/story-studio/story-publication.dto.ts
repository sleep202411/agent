import { z } from 'zod';
import { ExperienceReleaseRequestSchema } from '@repo/shared/experience-runtime';

export const StoryPublicationStatusSchema = z.enum([
  'draft',
  'reviewing',
  'published',
  'offline',
]);

export interface StoryProjectPublicationDto {
  gameId: string;
  status: z.infer<typeof StoryPublicationStatusSchema>;
  rejectReason: string | null;
}

/** Only a prepared draft may enter review; the route never accepts moderation actions. */
export const SubmitStoryPublicationSchema =
  ExperienceReleaseRequestSchema.extend({
    status: z.literal('draft'),
    setCurrent: z.literal(true),
    // Malformed URLs must produce validation issues at this HTTP boundary.
    coverUrl: z
      .url()
      .refine(
        (value) => /^https?:\/\//i.test(value),
        'Release URLs must use HTTP or HTTPS',
      )
      .optional(),
  });
export type SubmitStoryPublicationInput = z.infer<
  typeof SubmitStoryPublicationSchema
>;

export const OfflineStoryPublicationSchema = z.object({}).strict();
