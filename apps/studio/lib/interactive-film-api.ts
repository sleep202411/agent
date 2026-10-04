import { z } from "zod";
import {
  ExperienceReleaseRequestSchema,
  type ExperienceReleaseRequest,
} from "@repo/shared/experience-runtime";
import { api } from "@/lib/api";

const publicationStatusSchema = z.enum(["draft", "reviewing", "published", "offline"]);
const optionalString = z.string().min(1).nullish();

const publicationDetailSchema = z
  .object({
    gameId: z.string().min(1),
    status: publicationStatusSchema,
    rejectReason: optionalString,
  })
  .passthrough();

export type InteractiveFilmPublicationStatus = z.infer<typeof publicationStatusSchema>;

export interface InteractiveFilmPublication {
  gameId: string;
  status: InteractiveFilmPublicationStatus;
  rejectReason: string | null;
}

export function interactiveFilmPublicationQueryKey(
  projectId: string,
  userId: string | number | null
) {
  return ["story-studio", "interactive-film-publication", projectId, userId] as const;
}

export async function getInteractiveFilmPublication(
  projectId: string,
  signal?: AbortSignal
): Promise<InteractiveFilmPublication | null> {
  signal?.throwIfAborted();
  const value = await api.get<unknown>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/publication`,
    { requestScope: "project", signal }
  );
  signal?.throwIfAborted();
  // Only an authorized, successful empty result means no release exists.
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
  const parsed = ExperienceReleaseRequestSchema.safeParse(
    await api.post<unknown>(
      `/aurora/story-projects/${encodeURIComponent(projectId)}/release-candidate`,
      { data: input, requestScope: "project", timeout: 8 * 60_000, signal }
    )
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
  signal?.throwIfAborted();
  const value = await api.post<unknown>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/publication/submit`,
    {
      data: release,
      requestScope: "project",
      signal,
      timeout: 2 * 60_000,
    }
  );
  signal?.throwIfAborted();
  return parsePublication(value, projectId);
}

export async function offlineInteractiveFilm(
  projectId: string,
  signal?: AbortSignal
): Promise<InteractiveFilmPublication> {
  signal?.throwIfAborted();
  const value = await api.post<unknown>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/publication/offline`,
    {
      data: {},
      requestScope: "project",
      signal,
    }
  );
  signal?.throwIfAborted();
  return parsePublication(value, projectId);
}

function parsePublication(value: unknown, projectId: string): InteractiveFilmPublication {
  const parsed = publicationDetailSchema.safeParse(value);
  if (!parsed.success || parsed.data.gameId !== projectId) {
    throw new Error("The publication service returned an invalid publication status.");
  }
  return {
    gameId: parsed.data.gameId,
    status: parsed.data.status,
    rejectReason: parsed.data.rejectReason ?? null,
  };
}
