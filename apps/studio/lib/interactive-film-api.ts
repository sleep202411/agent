import { z } from "zod";
import {
  ExperienceReleaseRequestSchema,
  type ExperienceReleaseRequest,
} from "@repo/shared/experience-runtime";
import { api, ApiRequestError } from "@/lib/api";

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

export function interactiveFilmPublicationQueryKey(projectId: string) {
  return ["story-studio", "interactive-film-publication", projectId] as const;
}

export async function getInteractiveFilmPublication(
  projectId: string
): Promise<InteractiveFilmPublication | null> {
  try {
    const value = await api.get<unknown>(
      `/api/user/interactive-film/${encodeURIComponent(projectId)}`,
      { requestScope: "user" }
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
  }
): Promise<ExperienceReleaseRequest> {
  const parsed = ExperienceReleaseRequestSchema.safeParse(
    await api.post<unknown>(
      `/aurora/story-projects/${encodeURIComponent(projectId)}/release-candidate`,
      { data: input, requestScope: "project", timeout: 8 * 60_000 }
    )
  );
  if (!parsed.success || parsed.data.gameId !== projectId || parsed.data.status !== "draft") {
    throw new Error("Story Studio returned an invalid interactive-film release candidate.");
  }
  return parsed.data as ExperienceReleaseRequest;
}

export async function submitInteractiveFilmRelease(
  projectId: string,
  release: ExperienceReleaseRequest
): Promise<InteractiveFilmPublication> {
  await api.post("/api/user/interactive-film/releases", {
    data: release,
    requestScope: "user",
    timeout: 2 * 60_000,
  });
  await api.post(`/api/user/interactive-film/${encodeURIComponent(projectId)}/status`, {
    data: { action: "submit" },
    requestScope: "user",
  });
  const publication = await getInteractiveFilmPublication(projectId);
  if (!publication) throw new Error("Java did not return the submitted interactive film.");
  return publication;
}

export async function offlineInteractiveFilm(
  projectId: string
): Promise<InteractiveFilmPublication> {
  await api.post(`/api/user/interactive-film/${encodeURIComponent(projectId)}/status`, {
    data: { action: "offline" },
    requestScope: "user",
  });
  const publication = await getInteractiveFilmPublication(projectId);
  if (!publication) throw new Error("Java did not return the offline interactive film.");
  return publication;
}

function parsePublication(value: unknown, projectId: string): InteractiveFilmPublication {
  const parsed = publicationDetailSchema.safeParse(value);
  if (!parsed.success || parsed.data.gameId !== projectId) {
    throw new Error("Java returned an invalid interactive-film publication.");
  }
  return {
    gameId: parsed.data.gameId,
    status: parsed.data.status,
    rejectReason: parsed.data.rejectReason ?? null,
  };
}
