import "server-only";

import {
  ExperienceGameDetailResponseSchema,
  ExperienceGameListResponseSchema,
  ExperienceJsonObjectSchema,
  ExperienceRuntimeManifestSchema,
  canonicalizeExperienceJson,
  canonicalizeExperienceRuntimeManifest,
  materializeExperienceRuntimeManifest,
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
      | "MANIFEST_NOT_MATERIALIZED"
      | "MANIFEST_IDENTITY_MISMATCH",
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
  manifest: ExperienceRuntimeManifest;
}

/** Public game catalogue. Java owns current-version selection and metadata. */
export async function listPublishedInteractiveFilms(
  options: { fetcher?: Fetcher; javaStudioUrl?: string } = {}
): Promise<ExperienceGameListResponse> {
  const data = await getJavaData(
    `${javaBaseUrl(options.javaStudioUrl)}${INTERACTIVE_FILM_API_PATH}/games`,
    options.fetcher ?? fetch
  );
  const parsed = ExperienceGameListResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new InteractiveFilmLoadError(
      "JAVA_RESPONSE_INVALID",
      "Java returned an invalid interactive-film catalogue.",
      undefined,
      parsed.error.issues
    );
  }
  return parsed.data;
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
  const parsed = ExperienceGameDetailResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new InteractiveFilmLoadError(
      "JAVA_RESPONSE_INVALID",
      "Java returned invalid interactive-film metadata.",
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
 * Resolves the Java current-version pointer, downloads the immutable CDN
 * manifest, and verifies the complete Runtime Manifest v2 boundary before any
 * client code or media is allowed to start.
 */
export async function loadPublishedInteractiveFilm(
  gameId: string,
  options: { fetcher?: Fetcher; javaStudioUrl?: string } = {}
): Promise<PublishedInteractiveFilm> {
  const fetcher = options.fetcher ?? fetch;
  const game = await getPublishedInteractiveFilm(gameId, {
    fetcher,
    javaStudioUrl: options.javaStudioUrl,
  });

  let response: Response;
  try {
    response = await fetcher(game.manifestUrl, { cache: "force-cache" });
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

  const input = await readJson(response, "MANIFEST_INVALID", "The published manifest is not JSON.");
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
    canonicalizeExperienceJson(rawManifest.data) !== canonicalizeExperienceRuntimeManifest(manifest)
  ) {
    throw new InteractiveFilmLoadError(
      "MANIFEST_NOT_MATERIALIZED",
      "The published Runtime Manifest is incomplete and was not materialized before release."
    );
  }
  if (manifest.gameId !== game.gameId || manifest.contentVersion !== game.currentVersion) {
    throw new InteractiveFilmLoadError(
      "MANIFEST_IDENTITY_MISMATCH",
      "The published Runtime Manifest identity does not match Java's current game version."
    );
  }
  return { game, manifest };
}

async function getJavaData(url: string, fetcher: Fetcher): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url, { cache: "no-store" });
  } catch (error) {
    throw new InteractiveFilmLoadError(
      "JAVA_REQUEST_FAILED",
      error instanceof Error ? error.message : "Java interactive-film service is unavailable."
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
        : `Java interactive-film request failed (HTTP ${response.status}).`,
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
