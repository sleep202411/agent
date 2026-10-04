/**
 * Interactive-film publication (draft / review / live) for Story Studio.
 * Mirrors apps/studio/lib/interactive-film-api.ts for the mobile api-client.
 */

import {
  ExperienceReleaseRequestSchema,
  type ExperienceReleaseRequest,
} from "@repo/shared/experience-runtime";

import { getAuthGeneration } from "@/auth/auth-store";
import { api, ApiRequestError } from "@/lib/api-client";

const STUDIO = { service: "studio" as const };

export type InteractiveFilmPublicationStatus = "draft" | "reviewing" | "published" | "offline";

export type InteractiveFilmPublication = {
  gameId: string;
  status: InteractiveFilmPublicationStatus;
  rejectReason: string | null;
};

const STATUS_SET = new Set<InteractiveFilmPublicationStatus>([
  "draft",
  "reviewing",
  "published",
  "offline",
]);

function parsePublication(value: unknown, projectId: string): InteractiveFilmPublication {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Java returned an invalid interactive-film publication.");
  }
  const record = value as Record<string, unknown>;
  const gameId = typeof record.gameId === "string" ? record.gameId.trim() : "";
  const status = typeof record.status === "string" ? record.status.trim() : "";
  if (
    !gameId ||
    gameId !== projectId ||
    !STATUS_SET.has(status as InteractiveFilmPublicationStatus)
  ) {
    throw new Error("Java returned an invalid interactive-film publication.");
  }
  const rejectRaw = record.rejectReason;
  const rejectReason = typeof rejectRaw === "string" && rejectRaw.trim() ? rejectRaw.trim() : null;
  return {
    gameId,
    status: status as InteractiveFilmPublicationStatus,
    rejectReason,
  };
}

/** Current publication row — null when the project has never been submitted. */
export async function getInteractiveFilmPublication(
  projectId: string,
  signal?: AbortSignal
): Promise<InteractiveFilmPublication | null> {
  try {
    const value = await api.get<unknown>(
      `/api/user/interactive-film/${encodeURIComponent(projectId)}`,
      { ...STUDIO, signal, timeout: 30_000 }
    );
    return parsePublication(value, projectId);
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 404 || error.code === 404)) {
      return null;
    }
    throw error;
  }
}

export async function prepareInteractiveFilmRelease(
  projectId: string,
  input: {
    expectedDraftRevision: number;
    expectedVideoSnapshotHash: string;
  },
  signal?: AbortSignal
): Promise<ExperienceReleaseRequest> {
  const parsed = ExperienceReleaseRequestSchema.safeParse(
    await api.post<unknown>(`/story-projects/${encodeURIComponent(projectId)}/release-candidate`, {
      service: "aurora",
      data: input,
      signal,
      timeout: 8 * 60_000,
    })
  );
  if (!parsed.success || parsed.data.gameId !== projectId || parsed.data.status !== "draft") {
    throw new Error("Story Studio returned an invalid interactive-film release candidate.");
  }
  return parsed.data as ExperienceReleaseRequest;
}

export async function submitInteractiveFilmRelease(
  projectId: string,
  release: ExperienceReleaseRequest,
  signal?: AbortSignal
): Promise<InteractiveFilmPublication> {
  const generation = getAuthGeneration();
  const current = () => {
    signal?.throwIfAborted();
    if (generation !== getAuthGeneration()) throw new Error("Publication session expired.");
  };
  current();
  await api.post("/api/user/interactive-film/releases", {
    ...STUDIO,
    data: release,
    signal,
    timeout: 2 * 60_000,
  });
  current();
  await api.post(`/api/user/interactive-film/${encodeURIComponent(projectId)}/status`, {
    ...STUDIO,
    data: { action: "submit" },
    signal,
    timeout: 60_000,
  });
  current();
  const publication = await getInteractiveFilmPublication(projectId, signal);
  current();
  if (!publication || !["reviewing", "published"].includes(publication.status))
    throw new Error(
      "Submission could not be verified. Refresh the publication status before trying again."
    );
  return publication;
}

export async function offlineInteractiveFilm(
  projectId: string,
  signal?: AbortSignal
): Promise<InteractiveFilmPublication> {
  const generation = getAuthGeneration();
  signal?.throwIfAborted();
  await api.post(`/api/user/interactive-film/${encodeURIComponent(projectId)}/status`, {
    ...STUDIO,
    data: { action: "offline" },
    signal,
    timeout: 60_000,
  });
  signal?.throwIfAborted();
  if (generation !== getAuthGeneration()) throw new Error("Publication session expired.");
  const publication = await getInteractiveFilmPublication(projectId, signal);
  if (generation !== getAuthGeneration()) throw new Error("Publication session expired.");
  if (!publication || publication.status !== "offline")
    throw new Error(
      "Taking this film offline could not be verified. Refresh the publication status before trying again."
    );
  return publication;
}
