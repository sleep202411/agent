import "server-only";

import {
  ExperienceGameDetailResponseSchema,
  ExperienceGameListResponseSchema,
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
  type ExperienceRuntimeManifest,
} from "@repo/shared/experience-runtime";

export const INTERACTIVE_FILM_API_PATH = "/api/player/interactive-film" as const;

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface JavaEnvelope {
  code?: unknown;
  msg?: unknown;
  data?: unknown;
}

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
    readonly status?: number,
    readonly issues?: readonly { path: PropertyKey[]; message: string }[]
  ) {
    super(message);
    this.name = "InteractiveFilmLoadError";
  }
}

export interface PublishedInteractiveFilm {
  game: ExperienceGameDetailResponse;
  /** The Runtime Manifest actually loaded — of one chapter for a serial work. */
  manifest: ExperienceRuntimeManifest;
  /** Every chapter of a serial work; empty when the release is one manifest. */
  chapters: readonly ExperienceGameChapter[];
  activeChapterId: string | null;
}

/** Public game catalogue. Java owns current-version selection and metadata. */
export async function listPublishedInteractiveFilms(
  options: { fetcher?: Fetcher; javaStudioUrl?: string } = {}
): Promise<ExperienceGameListResponse> {
  const data = await getJavaData(
    `${javaBaseUrl(options.javaStudioUrl)}${INTERACTIVE_FILM_API_PATH}/games`,
    options.fetcher ?? fetch
  );
  // Tolerant catalogue: one malformed Java row (e.g. a test entry with a
  // broken coverUrl) must not blank the whole page. Parse each summary
  // independently and drop the ones that fail validation; only a
  // non-array payload is a hard error.
  if (!Array.isArray(data)) {
    throw new InteractiveFilmLoadError(
      "JAVA_RESPONSE_INVALID",
      "Java returned an invalid playable-story catalogue.",
      undefined,
      ExperienceGameListResponseSchema.safeParse(data).error?.issues
    );
  }
  const games: ExperienceGameListResponse = [];
  for (const entry of data) {
    // Decorative fields (coverUrl, subtitle) must never drop a game: Java
    // sends explicit `null` for a game with no cover, which `.optional()`
    // (undefined-only) rejects. Strip null/blank/invalid decorative values so
    // the game still lists — just without a cover — instead of vanishing.
    // Also pick only schema keys: ExperienceGameSummarySchema is `.strict()`,
    // and Java returns extras (status / offlineAt / …) that would otherwise
    // fail every row.
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
  // coverUrl: keep only a non-blank http(s) string; otherwise omit.
  const cover = entry.coverUrl;
  if (typeof cover === "string" && /^https?:\/\/\S+$/i.test(cover.trim())) {
    next.coverUrl = cover;
  }
  // subtitle: keep only a non-blank string; otherwise omit.
  if (typeof entry.subtitle === "string" && entry.subtitle.trim() !== "") {
    next.subtitle = entry.subtitle;
  }
  return next;
}

/** Detail schema is `.strict()` — keep only known keys so Java extras don't fail parse. */
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

/** Metadata lookup used independently by page metadata and full playback loading. */
export async function getPublishedInteractiveFilm(
  gameId: string,
  options: { fetcher?: Fetcher; javaStudioUrl?: string } = {}
): Promise<ExperienceGameDetailResponse> {
  const data = await getJavaData(
    `${javaBaseUrl(options.javaStudioUrl)}${INTERACTIVE_FILM_API_PATH}/games/${encodeURIComponent(gameId)}`,
    options.fetcher ?? fetch
  );
  // Detail schema is `.strict()` — pick only known keys so Java extras
  // (creatorId, …) do not fail the playable-story integrity gate.
  const cleaned =
    data && typeof data === "object" && !Array.isArray(data)
      ? sanitizeGameDetail(data as Record<string, unknown>)
      : data;
  const parsed = ExperienceGameDetailResponseSchema.safeParse(cleaned);
  if (!parsed.success) {
    throw new InteractiveFilmLoadError(
      "JAVA_RESPONSE_INVALID",
      "Java returned invalid playable-story metadata.",
      undefined,
      parsed.error.issues
    );
  }
  if (parsed.data.gameId !== gameId) {
    throw new InteractiveFilmLoadError(
      "GAME_ID_MISMATCH",
      `Java returned game ${parsed.data.gameId} while ${gameId} was requested.`
    );
  }
  return parsed.data;
}

/**
 * Resolves the Java current-version pointer, downloads the immutable release
 * document, and verifies the complete Runtime Manifest v2 boundary before any
 * client code or media is allowed to start.
 *
 * A release document is either one Runtime Manifest (a work that plays start to
 * finish) or a Game Manifest listing chapters (a serial work, where each chapter
 * is its own Runtime Manifest at its own permanent URL). The chapter case adds
 * one more download and takes its identity from the chapter listing, because
 * Java's currentVersion identifies the chapter SET, not any single chapter.
 */
export async function loadPublishedInteractiveFilm(
  gameId: string,
  options: { fetcher?: Fetcher; javaStudioUrl?: string; chapterId?: string } = {}
): Promise<PublishedInteractiveFilm> {
  const fetcher = options.fetcher ?? fetch;
  const game = await getPublishedInteractiveFilm(gameId, {
    fetcher,
    javaStudioUrl: options.javaStudioUrl,
  });
  const document = await downloadReleaseDocument(fetcher, game.manifestUrl);

  if (!isExperienceGameManifest(document)) {
    // A standalone release has no named chapter slots. Old shared chapter
    // links must not silently open different content after a release changes.
    if (options.chapterId) {
      throw new InteractiveFilmLoadError(
        "CHAPTER_NOT_FOUND",
        `This release has no chapter ${options.chapterId}.`
      );
    }
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
      "The published Game Manifest is invalid.",
      undefined,
      parsedGame.error.issues
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
      `This release has no chapter ${options.chapterId ?? ""}.`.trim()
    );
  }
  const chapterDocument = await downloadReleaseDocument(fetcher, chapter.manifestUrl);
  return {
    game,
    // The chapter listing is the authority for what this URL must contain: it
    // arrived inside the identity-checked Game Manifest, so a chapter object
    // that starts serving something else cannot pass.
    manifest: verifyRuntimeManifest(chapterDocument, {
      gameId: game.gameId,
      contentVersion: chapter.contentVersion,
    }),
    chapters: table.chapters,
    activeChapterId: chapter.chapterId,
  };
}

async function downloadReleaseDocument(fetcher: Fetcher, url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url, { cache: "force-cache" });
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
  return readJson(response, "MANIFEST_INVALID", "The published manifest is not JSON.");
}

function verifyRuntimeManifest(
  input: unknown,
  identity: { gameId: string; contentVersion: string }
): ExperienceRuntimeManifest {
  const rawManifest = ExperienceJsonObjectSchema.safeParse(input);
  if (!rawManifest.success) {
    throw new InteractiveFilmLoadError(
      "MANIFEST_INVALID",
      "The published manifest is not a JSON object.",
      undefined,
      rawManifest.error.issues
    );
  }
  const parsed = ExperienceRuntimeManifestSchema.safeParse(rawManifest.data);
  if (!parsed.success) {
    throw new InteractiveFilmLoadError(
      "MANIFEST_INVALID",
      "The published Runtime Manifest is invalid.",
      undefined,
      parsed.error.issues
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

async function getJavaData(url: string, fetcher: Fetcher): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url, { cache: "no-store" });
  } catch (error) {
    throw new InteractiveFilmLoadError(
      "JAVA_REQUEST_FAILED",
      error instanceof Error ? error.message : "Java playable-story service is unavailable."
    );
  }
  const envelopeInput = await readJson(
    response,
    "JAVA_RESPONSE_INVALID",
    `Java returned a non-JSON response (HTTP ${response.status}).`
  );
  const envelope =
    envelopeInput && typeof envelopeInput === "object"
      ? (envelopeInput as JavaEnvelope)
      : ({} as JavaEnvelope);
  if (!response.ok || envelope.code !== 200) {
    throw new InteractiveFilmLoadError(
      "JAVA_REQUEST_FAILED",
      typeof envelope.msg === "string" && envelope.msg.trim()
        ? envelope.msg
        : `Java playable-story request failed (HTTP ${response.status}).`,
      response.status
    );
  }
  return envelope.data;
}

async function readJson(
  response: Response,
  code: "JAVA_RESPONSE_INVALID" | "MANIFEST_INVALID",
  message: string
): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new InteractiveFilmLoadError(code, message, response.status);
  }
}

function javaBaseUrl(override?: string): string {
  const value = override ?? process.env.JAVA_STUDIO_URL;
  if (!value?.trim()) throw new Error("Missing required environment variable: JAVA_STUDIO_URL");
  return value.replace(/\/+$/, "");
}
