/**
 * Interactive-film publication (draft / review / live) for Story Studio.
 * Mirrors apps/studio/lib/interactive-film-api.ts for the mobile api-client.
 */

import {
  ExperienceReleaseRequestSchema,
  type ExperienceReleaseRequest,
} from "@repo/shared/experience-runtime";

import { getAuthGeneration } from "@/auth/auth-store";
import { api } from "@/lib/api-client";

const PUBLICATION = { service: "aurora" as const, retry: false };

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
    throw new Error("The publication service returned an invalid publication status.");
  }
  const record = value as Record<string, unknown>;
  const gameId = typeof record.gameId === "string" ? record.gameId.trim() : "";
  const status = typeof record.status === "string" ? record.status.trim() : "";
  if (
    !gameId ||
    gameId !== projectId ||
    !STATUS_SET.has(status as InteractiveFilmPublicationStatus)
  ) {
    throw new Error("The publication service returned an invalid publication status.");
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
  const generation = getAuthGeneration();
  signal?.throwIfAborted();
  const value = await api.get<unknown>(
    `/story-projects/${encodeURIComponent(projectId)}/publication`,
    { ...PUBLICATION, signal, timeout: 30_000 }
  );
  signal?.throwIfAborted();
  if (generation !== getAuthGeneration()) throw new Error("Publication session expired.");
  // Only a successful authorized empty response means no release exists.
  return value === null ? null : parsePublication(value, projectId);
}

export async function prepareInteractiveFilmRelease(
  projectId: string,
  input: {
    expectedProjectVersion: number;
    expectedDraftRevision: number;
    expectedVideoSnapshotHash: string;
  },
  signal?: AbortSignal
): Promise<ExperienceReleaseRequest> {
  const generation = getAuthGeneration();
  signal?.throwIfAborted();
  const parsed = ExperienceReleaseRequestSchema.safeParse(
    await api.post<unknown>(`/story-projects/${encodeURIComponent(projectId)}/release-candidate`, {
      service: "aurora",
      data: input,
      signal,
      timeout: 8 * 60_000,
    })
  );
  signal?.throwIfAborted();
  if (generation !== getAuthGeneration()) throw new Error("Publication session expired.");
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
  const value = await api.post<unknown>(
    `/story-projects/${encodeURIComponent(projectId)}/publication/submit`,
    {
      ...PUBLICATION,
      data: release,
      signal,
      timeout: 2 * 60_000,
    }
  );
  current();
  const publication = parsePublication(value, projectId);
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
  const value = await api.post<unknown>(
    `/story-projects/${encodeURIComponent(projectId)}/publication/offline`,
    {
      ...PUBLICATION,
      data: {},
      signal,
      timeout: 60_000,
    }
  );
  signal?.throwIfAborted();
  if (generation !== getAuthGeneration()) throw new Error("Publication session expired.");
  const publication = parsePublication(value, projectId);
  if (!publication || publication.status !== "offline")
    throw new Error(
      "Taking this film offline could not be verified. Refresh the publication status before trying again."
    );
  return publication;
}
