/**
 * Published interactive-film (影游) catalogue + manifest loader.
 * Port of `apps/web/app/play/_lib/interactive-film-api.ts` for the mobile
 * api-client (studio base). Types/schemas come from `@repo/shared`.
 */
import {
  ExperienceGameDetailResponseSchema,
  ExperienceGameManifestSchema,
  ExperienceGameSummarySchema,
  ExperienceJsonObjectSchema,
  ExperienceRuntimeManifestSchema,
  canonicalizeExperienceJson,
  canonicalizeExperienceRuntimeManifest,
  isExperienceGameManifest,
  materializeExperienceRuntimeManifest,
  type ExperienceGameChapter,
  type ExperienceGameDetailResponse,
  type ExperienceGameListResponse,
  type ExperienceGameSummary,
  type ExperienceRuntimeManifest,
} from "@repo/shared/experience-runtime";

import { api, ApiRequestError } from "@/lib/api-client";

export const INTERACTIVE_FILM_API_PATH = "/api/player/interactive-film" as const;

export class InteractiveFilmLoadError extends Error {
  constructor(
    readonly code:
      | "JAVA_REQUEST_FAILED"
      | "JAVA_RESPONSE_INVALID"
      | "GAME_ID_MISMATCH"
      | "MANIFEST_REQUEST_FAILED"
      | "MANIFEST_INVALID"
      | "MANIFEST_PROFILE_INVALID"
      | "MANIFEST_NOT_MATERIALIZED"
      | "MANIFEST_IDENTITY_MISMATCH"
      | "CHAPTER_NOT_FOUND",
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "InteractiveFilmLoadError";
  }
}

export interface PublishedInteractiveFilm {
  game: ExperienceGameDetailResponse;
  /** Runtime Manifest for the active chapter (or the sole release). */
  manifest: ExperienceRuntimeManifest;
  /** Serial chapters; empty when the release is a single manifest. */
  chapters: readonly ExperienceGameChapter[];
  activeChapterId: string | null;
}

export type { ExperienceGameSummary, ExperienceGameListResponse, ExperienceGameDetailResponse };

/** Public game catalogue. Java owns current-version selection and metadata. */
export async function listPublishedInteractiveFilms(options?: {
  page?: number;
  pageSize?: number;
  signal?: AbortSignal;
}): Promise<ExperienceGameListResponse> {
  try {
    const data = await api.get<unknown>(`${INTERACTIVE_FILM_API_PATH}/games`, {
      service: "studio",
      signal: options?.signal,
      params: {
        ...(options?.page != null ? { page: options.page } : {}),
        ...(options?.pageSize != null ? { pageSize: options.pageSize } : {}),
      },
    });
    return parseGameList(data);
  } catch (error) {
    throw toInteractiveFilmError(error, "Java playable-story service is unavailable.");
  }
}

/** Metadata for one published game (manifest URL + version pointer). */
export async function getPublishedInteractiveFilm(
  gameId: string
): Promise<ExperienceGameDetailResponse> {
  try {
    const data = await api.get<unknown>(
      `${INTERACTIVE_FILM_API_PATH}/games/${encodeURIComponent(gameId)}`,
      { service: "studio" }
    );
    const cleaned =
      data && typeof data === "object" && !Array.isArray(data)
        ? sanitizeGameDetail(data as Record<string, unknown>)
        : data;
    const parsed = ExperienceGameDetailResponseSchema.safeParse(cleaned);
    if (!parsed.success) {
      throw new InteractiveFilmLoadError(
        "JAVA_RESPONSE_INVALID",
        "Java returned invalid playable-story metadata."
      );
    }
    if (parsed.data.gameId !== gameId) {
      throw new InteractiveFilmLoadError(
        "GAME_ID_MISMATCH",
        `Java returned game ${parsed.data.gameId} while ${gameId} was requested.`
      );
    }
    return parsed.data;
  } catch (error) {
    throw toInteractiveFilmError(error, "Java playable-story service is unavailable.");
  }
}

/**
 * Resolve Java current-version → download release document → verify Runtime
 * Manifest (or pick a chapter from a Game Manifest).
 */
export async function loadPublishedInteractiveFilm(
  gameId: string,
  options: { chapterId?: string } = {}
): Promise<PublishedInteractiveFilm> {
  const game = await getPublishedInteractiveFilm(gameId);
  const document = await downloadReleaseDocument(game.manifestUrl);

  if (!isExperienceGameManifest(document)) {
    return {
      game,
      manifest: verifyRuntimeManifest(document, {
        gameId: game.gameId,
        contentVersion: game.currentVersion,
      }),
      chapters: [],
      activeChapterId: null,
    };
  }

  const parsedGame = ExperienceGameManifestSchema.safeParse(document);
  if (!parsedGame.success) {
    throw new InteractiveFilmLoadError(
      "MANIFEST_INVALID",
      "The published Game Manifest is invalid."
    );
  }
  const table = parsedGame.data;
  if (table.gameId !== game.gameId || table.contentVersion !== game.currentVersion) {
    throw new InteractiveFilmLoadError(
      "MANIFEST_IDENTITY_MISMATCH",
      "The published Game Manifest identity does not match Java's current game version."
    );
  }
  const chapter = options.chapterId
    ? table.chapters.find((entry) => entry.chapterId === options.chapterId)
    : table.chapters[0];
  if (!chapter) {
    throw new InteractiveFilmLoadError(
      "CHAPTER_NOT_FOUND",
      `This release has no chapter ${options.chapterId ?? ""}`.trim()
    );
  }
  const chapterDocument = await downloadReleaseDocument(chapter.manifestUrl);
  return {
    game,
    manifest: verifyRuntimeManifest(chapterDocument, {
      gameId: game.gameId,
      contentVersion: chapter.contentVersion,
    }),
    chapters: table.chapters,
    activeChapterId: chapter.chapterId,
  };
}

async function downloadReleaseDocument(url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new InteractiveFilmLoadError(
      "MANIFEST_REQUEST_FAILED",
      error instanceof Error ? error.message : "The published manifest could not be loaded."
    );
  }
  if (!response.ok) {
    throw new InteractiveFilmLoadError(
      "MANIFEST_REQUEST_FAILED",
      `The published manifest could not be loaded (HTTP ${response.status}).`,
      response.status
    );
  }
  try {
    return await response.json();
  } catch {
    throw new InteractiveFilmLoadError(
      "MANIFEST_INVALID",
      "The published manifest is not JSON.",
      response.status
    );
  }
}

function verifyRuntimeManifest(
  input: unknown,
  identity: { gameId: string; contentVersion: string }
): ExperienceRuntimeManifest {
  const rawManifest = ExperienceJsonObjectSchema.safeParse(input);
  if (!rawManifest.success) {
    throw new InteractiveFilmLoadError(
      "MANIFEST_INVALID",
      "The published manifest is not a JSON object."
    );
  }
  const parsed = ExperienceRuntimeManifestSchema.safeParse(rawManifest.data);
  if (!parsed.success) {
    throw new InteractiveFilmLoadError(
      "MANIFEST_INVALID",
      "The published Runtime Manifest is invalid."
    );
  }
  const manifest = materializeExperienceRuntimeManifest(parsed.data);
  if (
    manifest.metadata.experienceProfile !== "cinematic" ||
    !manifest.compatibility.requiredCapabilities.includes("core.video")
  ) {
    throw new InteractiveFilmLoadError(
      "MANIFEST_PROFILE_INVALID",
      "The published release is not an interactive-film manifest."
    );
  }
  if (
    canonicalizeExperienceJson(rawManifest.data) !== canonicalizeExperienceRuntimeManifest(manifest)
  ) {
    throw new InteractiveFilmLoadError(
      "MANIFEST_NOT_MATERIALIZED",
      "The published Runtime Manifest is incomplete and was not materialized before release."
    );
  }
  if (manifest.gameId !== identity.gameId || manifest.contentVersion !== identity.contentVersion) {
    throw new InteractiveFilmLoadError(
      "MANIFEST_IDENTITY_MISMATCH",
      "The published Runtime Manifest identity does not match the release it was published in."
    );
  }
  return manifest;
}

function parseGameList(data: unknown): ExperienceGameListResponse {
  if (!Array.isArray(data)) {
    throw new InteractiveFilmLoadError(
      "JAVA_RESPONSE_INVALID",
      "Java returned an invalid playable-story catalogue."
    );
  }
  const games: ExperienceGameListResponse = [];
  for (const entry of data) {
    const cleaned =
      entry && typeof entry === "object" && !Array.isArray(entry)
        ? sanitizeGameSummary(entry as Record<string, unknown>)
        : entry;
    const parsed = ExperienceGameSummarySchema.safeParse(cleaned);
    if (parsed.success) games.push(parsed.data);
  }
  return games;
}

function sanitizeGameSummary(entry: Record<string, unknown>): Record<string, unknown> {
  // Schema is `.strict()` — only forward keys the player catalogue contract
  // accepts. Java DTOs carry extras (status, offlineAt, creatorId, …).
  const next: Record<string, unknown> = {
    gameId: entry.gameId,
    title: entry.title,
    currentVersion: entry.currentVersion,
    updatedAt: entry.updatedAt,
  };
  const cover = entry.coverUrl;
  if (typeof cover === "string" && /^https?:\/\/\S+$/i.test(cover.trim())) {
    next.coverUrl = cover;
  }
  if (typeof entry.subtitle === "string" && entry.subtitle.trim() !== "") {
    next.subtitle = entry.subtitle;
  }
  return next;
}

/** Detail schema is `.strict()` — keep only known keys so Java extras don't 400 the parse. */
function sanitizeGameDetail(entry: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {
    gameId: entry.gameId,
    title: entry.title,
    currentVersion: entry.currentVersion,
    manifestUrl: entry.manifestUrl,
  };
  const cover = entry.coverUrl;
  if (typeof cover === "string" && /^https?:\/\/\S+$/i.test(cover.trim())) {
    next.coverUrl = cover;
  }
  return next;
}

function toInteractiveFilmError(error: unknown, fallback: string): InteractiveFilmLoadError {
  if (error instanceof InteractiveFilmLoadError) return error;
  if (error instanceof ApiRequestError) {
    return new InteractiveFilmLoadError(
      "JAVA_REQUEST_FAILED",
      error.message || fallback,
      error.status
    );
  }
  return new InteractiveFilmLoadError(
    "JAVA_REQUEST_FAILED",
    error instanceof Error ? error.message : fallback
  );
}
