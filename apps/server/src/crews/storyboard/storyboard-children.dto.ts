import { z } from 'zod';

export const LinkStoryboardChildSchema = z
  .object({
    taskId: z.string().uuid(),
  })
  .strict();

export type LinkStoryboardChildInput = z.infer<
  typeof LinkStoryboardChildSchema
>;

export const CreateStoryboardChildSchema = z
  .object({
    title: z.string().trim().min(1).max(180).optional(),
  })
  .strict();

export type CreateStoryboardChildInput = z.infer<
  typeof CreateStoryboardChildSchema
>;

export interface StoryboardChildItem {
  nodeId: string;
  nodeType: string;
  title: string;
  taskId: string | null;
  status: string | null;
}

export const StoryboardTaskCandidatesSchema = z.object({
  q: z.string().trim().max(180).default(''),
  cursor: z.string().uuid().optional(),
});
export type StoryboardTaskCandidatesQuery = z.infer<
  typeof StoryboardTaskCandidatesSchema
>;
