import { ApiRequestError } from "@/lib/api";

export type StoryProjectAccessFailure = "authentication" | "forbidden" | "unavailable";

/**
 * Project reads deliberately collapse a missing project and a caller without
 * membership into the same 404. Both are expected navigation outcomes, not
 * render failures, so they must stay out of the Next.js error boundary.
 */
export function storyProjectAccessFailure(error: unknown): StoryProjectAccessFailure | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { status?: unknown; code?: unknown };
  const status = typeof candidate.status === "number" ? candidate.status : null;
  const code =
    typeof candidate.code === "string" || typeof candidate.code === "number"
      ? candidate.code
      : null;

  if (status === 401) return "authentication";
  if (status === 403) return "forbidden";
  if (status === 404 || code === "STORY_PROJECT_NOT_FOUND") return "unavailable";
  return null;
}

/** Retry transport/server failures only. Immediate retries cannot repair auth or access. */
export function shouldRetryStoryProjectAccess(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  if (!(error instanceof ApiRequestError)) return true;
  return error.status === 0 || error.status >= 500;
}
