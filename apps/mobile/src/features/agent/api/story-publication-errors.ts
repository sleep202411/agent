import { StoryProductionStableKeySchema } from "@repo/shared";

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

export type StoryPublicationDiagnostic = { message: string; nodeId: string | null };
export type StoryPublicationDiagnostics = {
  chapterId: string | null;
  issues: StoryPublicationDiagnostic[];
};

/** Read the official release error body without inventing a target chapter. */
export function storyPublicationDiagnostics(error: unknown): StoryPublicationDiagnostics {
  const empty: StoryPublicationDiagnostics = { chapterId: null, issues: [] };
  if (!error || typeof error !== "object") return empty;
  const raw = (error as { responseBody?: unknown }).responseBody;
  if (typeof raw !== "string") return empty;
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return empty;
  const record = body as Record<string, unknown>;
  const chapterId =
    typeof record.chapterId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(record.chapterId)
      ? record.chapterId
      : null;
  const entries = [
    ...(Array.isArray(record.diagnostics) ? record.diagnostics : []),
    ...(Array.isArray(record.issues) ? record.issues : []),
  ];
  const issues = entries.flatMap((item): StoryPublicationDiagnostic[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const entry = item as Record<string, unknown>;
    const message = typeof entry.message === "string" ? entry.message.trim() : "";
    if (!message) return [];
    const nodeId =
      typeof entry.nodeId === "string" &&
      entry.nodeId === entry.nodeId.trim() &&
      StoryProductionStableKeySchema.safeParse(entry.nodeId).success
        ? entry.nodeId
        : null;
    return [{ message, nodeId }];
  });
  return { chapterId, issues };
}

/** Preserve the general error and every distinct actionable diagnostic. */
export function storyPublicationActionDetail(error: unknown, fallback: string): string {
  const detail = error instanceof Error && error.message.trim() ? error.message.trim() : fallback;
  return [
    ...new Set([detail, ...storyPublicationDiagnostics(error).issues.map((i) => i.message)]),
  ].join("\n\n");
}
