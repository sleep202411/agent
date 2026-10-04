export type StoryPublicationErrorKind = "auth" | "permission" | "service";

/** Gateway failures describe the upstream service, never the reader's project role. */
export function storyPublicationErrorKind(error: unknown): StoryPublicationErrorKind {
  if (!error || typeof error !== "object") return "service";
  const { code, status } = error as { code?: unknown; status?: unknown };
  if (code === "STORY_PUBLICATION_SESSION_EXPIRED" || code === "STORY_PUBLICATION_SESSION_REQUIRED")
    return "auth";
  if (typeof code === "string" && code.startsWith("STORY_PUBLICATION_")) return "service";
  if (status === 401 || code === 401 || code === "HTTP_401" || code === "UNAUTHORIZED")
    return "auth";
  if (
    status === 403 ||
    code === 403 ||
    code === "HTTP_403" ||
    code === "STORY_PERMISSION_DENIED" ||
    code === "STORY_PROJECT_PERMISSION_DENIED" ||
    code === "STORY_PROJECT_NOT_FOUND"
  )
    return "permission";
  return "service";
}

/** Validation and snapshot conflicts retain their own repair instructions. */
export function storyPublicationActionErrorKind(error: unknown): StoryPublicationErrorKind | null {
  if (!error || typeof error !== "object") return null;
  const { code, status } = error as { code?: unknown; status?: unknown };
  if (
    status === 0 ||
    status === 401 ||
    status === 403 ||
    (typeof status === "number" && status >= 500) ||
    code === "STORY_PROJECT_NOT_FOUND"
  )
    return storyPublicationErrorKind(error);
  return null;
}
