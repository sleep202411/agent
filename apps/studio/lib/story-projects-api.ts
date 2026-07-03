import { api, ApiRequestError } from "@/lib/api";

/**
 * Story Studio project client — wraps the sovereign NestJS `/aurora/story-projects`
 * domain (satoken cookie auth, `{code,data}` envelope unwrapped by `api`).
 *
 * Story projects are their OWN domain: they no longer borrow
 * PlatformProject/PlatformDocument (that borrow polluted the project list and
 * collided with the Yjs canvas format on the shared `canvas` mode document).
 * The draft is a single JSON snapshot guarded by CAS (`revision`): every write
 * must carry the last revision the client read; a stale write returns 409
 * DRAFT_REVISION_CONFLICT with the current server state so the client can
 * merge, adopt, or overwrite deliberately.
 */

/** The draft snapshot wire schema this client reads and writes. */
export const STORY_STUDIO_SCHEMA_VERSION = "story-studio-canvas-v1";

export type StoryPublishState = "unpublished" | "published" | "offline";

export interface StoryProjectSummary {
  id: string;
  title: string;
  summary: string | null;
  coverAssetId: string | null;
  locale: string | null;
  visibility: string;
  tags: string[];
  publishState: StoryPublishState;
  publishedVersion: number | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoryDraft {
  schemaVersion: string;
  content: Record<string, unknown>;
  /** CAS token — echo it back on the next PUT. */
  revision: number;
  updatedAt: string;
}

export interface StoryProjectDetail extends StoryProjectSummary {
  workspaceId: string;
  sourceIpId: string | null;
  draft: StoryDraft;
}

export interface CreateStoryProjectInput {
  title?: string;
  workspaceId?: string;
  locale?: string;
  sourceIpId?: string;
  /** Optional initial canvas snapshot (lazy-create from a drawn canvas);
   *  the server extracts title/summary from it. */
  content?: Record<string, unknown>;
}

export async function createStoryProject(
  input: CreateStoryProjectInput
): Promise<StoryProjectDetail> {
  return api.post<StoryProjectDetail>(`/aurora/story-projects`, { data: input });
}

/** The caller's stories, newest-updated first. */
export async function listStoryProjects(): Promise<StoryProjectSummary[]> {
  const data = await api.get<{ items: StoryProjectSummary[] }>(`/aurora/story-projects`);
  return data.items;
}

export async function getStoryProject(id: string): Promise<StoryProjectDetail> {
  return api.get<StoryProjectDetail>(`/aurora/story-projects/${encodeURIComponent(id)}`);
}

export async function updateStoryProject(
  id: string,
  patch: Partial<{
    title: string;
    summary: string;
    coverAssetId: string | null;
    tags: string[];
    visibility: string;
    locale: string;
  }>
): Promise<StoryProjectSummary> {
  return api.patch<StoryProjectSummary>(`/aurora/story-projects/${encodeURIComponent(id)}`, {
    data: patch,
  });
}

/**
 * Save the draft snapshot. `revision` MUST be the last revision this client
 * read/received (CAS) — a stale write throws with a parseable
 * {@link DraftRevisionConflict} (see `draftRevisionConflict`).
 */
export async function putStoryDraft(
  id: string,
  input: { content: Record<string, unknown>; revision: number; sessionId?: string }
): Promise<{ revision: number; updatedAt: string }> {
  return api.put<{ revision: number; updatedAt: string }>(
    `/aurora/story-projects/${encodeURIComponent(id)}/draft`,
    { data: { schemaVersion: STORY_STUDIO_SCHEMA_VERSION, ...input } }
  );
}

/** Archive a story. 409 STORY_PUBLISHED while it is published. */
export async function archiveStoryProject(id: string): Promise<void> {
  await api.delete(`/aurora/story-projects/${encodeURIComponent(id)}`);
}

// ─── Typed errors ───────────────────────────────────────

/** Typed error code from a story-projects route (e.g. `STORY_PUBLISHED`). */
export function storyApiErrorCode(error: unknown): string | null {
  if (!(error instanceof ApiRequestError)) return null;
  if (typeof error.code === "string" && !error.code.startsWith("HTTP_")) return error.code;
  if (!error.responseBody) return null;
  try {
    const body = JSON.parse(error.responseBody) as Record<string, unknown>;
    return typeof body.code === "string" ? body.code : null;
  } catch {
    return null;
  }
}

/** Server state carried by a 409 DRAFT_REVISION_CONFLICT stale-write refusal. */
export interface DraftRevisionConflict {
  currentRevision: number;
  content: Record<string, unknown>;
  updatedAt: string;
  updatedBySessionId: string | null;
}

/** Parse a stale-write 409 into its conflict payload; null for anything else. */
export function draftRevisionConflict(error: unknown): DraftRevisionConflict | null {
  if (!(error instanceof ApiRequestError) || error.status !== 409 || !error.responseBody) {
    return null;
  }
  try {
    const body = JSON.parse(error.responseBody) as Record<string, unknown>;
    if (body.code !== "DRAFT_REVISION_CONFLICT") return null;
    if (typeof body.currentRevision !== "number") return null;
    return {
      currentRevision: body.currentRevision,
      content: (typeof body.content === "object" && body.content !== null
        ? body.content
        : {}) as Record<string, unknown>,
      updatedAt: typeof body.updatedAt === "string" ? body.updatedAt : "",
      updatedBySessionId:
        typeof body.updatedBySessionId === "string" ? body.updatedBySessionId : null,
    };
  } catch {
    return null;
  }
}
