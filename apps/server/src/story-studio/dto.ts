/**
 * Story Studio (文字游戏) request/response contracts.
 *
 * Sovereign domain (docs/story-studio-project-schema-v1.md v2): drafts,
 * releases, and the publish state machine all live here — no external
 * system's lifecycle shapes these DTOs. The studio editor autosaves whole
 * canvas snapshots (`story-studio-canvas-v1`) guarded by a CAS `revision`.
 */
import { z } from 'zod';

/** Display title cap — mirrored by the R1 write-through clamp. */
export const STORY_TITLE_MAX = 160;

const StoryTitleSchema = z.string().trim().min(1).max(STORY_TITLE_MAX);
const StoryTagsSchema = z.array(z.string().trim().min(1).max(40)).max(12);

export const CreateStoryProjectSchema = z.object({
  title: StoryTitleSchema.optional(),
  /** Personal workspace id — only anchors cover MediaAssets; optional. */
  workspaceId: z.string().uuid().optional(),
  locale: z.string().trim().min(2).max(16).optional(),
  sourceIpId: z.string().uuid().optional(),
  /** Optional initial draft snapshot (lazy-create from a drawn canvas). */
  content: z.record(z.string(), z.unknown()).optional(),
});
export type CreateStoryProjectInput = z.infer<typeof CreateStoryProjectSchema>;

export const StoryProjectIdParamsSchema = z.object({
  id: z.string().uuid(),
});
export type StoryProjectIdParams = z.infer<typeof StoryProjectIdParamsSchema>;

export const PatchStoryProjectSchema = z
  .object({
    title: StoryTitleSchema.optional(),
    summary: z.string().trim().max(2000).nullable().optional(),
    coverAssetId: z.string().uuid().nullable().optional(),
    locale: z.string().trim().min(2).max(16).optional(),
    visibility: z.enum(['private', 'public', 'unlisted']).optional(),
    tags: StoryTagsSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });
export type PatchStoryProjectInput = z.infer<typeof PatchStoryProjectSchema>;

export const PutStoryDraftSchema = z.object({
  schemaVersion: z.literal('story-studio-canvas-v1'),
  /** Whole canvas snapshot: {title, summary, storyAnalysis, canvas:{nodes,edges}}. */
  content: z.record(z.string(), z.unknown()),
  /** CAS token — the revision this client last read (R5). */
  revision: z.number().int().min(0),
  /** Editor session id so a 409 can tell "my other tab" from a real conflict. */
  sessionId: z.string().trim().min(1).max(64).optional(),
});
export type PutStoryDraftInput = z.infer<typeof PutStoryDraftSchema>;

// ─── Response DTOs (mirror apps/studio/lib/story-projects-api.ts) ───

export type StoryPublishStateDto = 'unpublished' | 'published' | 'offline';

export interface StoryProjectSummaryDto {
  id: string;
  title: string;
  summary: string | null;
  coverAssetId: string | null;
  locale: string;
  visibility: 'private' | 'public' | 'unlisted';
  tags: string[];
  publishState: StoryPublishStateDto;
  publishedVersion: number | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoryDraftDto {
  schemaVersion: string;
  content: Record<string, unknown>;
  revision: number;
  updatedAt: string;
}

export interface StoryProjectDetailDto extends StoryProjectSummaryDto {
  workspaceId: string | null;
  sourceIpId: string | null;
  draft: StoryDraftDto;
}

/** R5 — body of the 409 CONFLICT on a stale draft write. */
export interface StoryDraftConflictDto {
  code: 'DRAFT_REVISION_CONFLICT';
  currentRevision: number;
  content: Record<string, unknown>;
  updatedAt: string;
  updatedBySessionId: string | null;
}
