import { ExperienceStableIdSchema } from "@repo/shared/experience-runtime/common";
import type { AdminInteractiveFilmDetail } from "./interactive-film-admin-contract";

export type AdminInteractiveFilmListing = {
  gameId: string;
  title: string;
  defaultLocale: string;
  description: string;
  tags: string[];
  developer: string;
  coverUrl: string | null;
  trailerUrl: string | null;
  screenshots: { url: string }[];
};

export type AdminInteractiveFilmListingSnapshot = {
  contentVersion: string;
  listing: AdminInteractiveFilmListing | null;
};

export type AdminInteractiveFilmListingLoadResult = {
  contentVersion: string | null;
  data: AdminInteractiveFilmListingSnapshot | null;
  error: string | null;
};

export function areInteractiveFilmMaterialsReady(
  snapshot: AdminInteractiveFilmListingSnapshot | null
): boolean {
  return Boolean(snapshot && (snapshot.listing === null || snapshot.listing.coverUrl));
}

/** Mirrors the Java version that the moderation action will publish or has published. */
export function interactiveFilmListingVersion(game: AdminInteractiveFilmDetail): string | null {
  return game.status === "draft" || game.status === "reviewing"
    ? game.draftVersion
    : (game.currentVersion ?? (game.status === "offline" ? game.draftVersion : null));
}

export function parseInteractiveFilmListingVersion(input: unknown): string {
  const parsed = ExperienceStableIdSchema.safeParse(input);
  if (!parsed.success || parsed.data.length > 160) {
    throw new Error("Invalid release version.");
  }
  return parsed.data;
}

export function parseAdminInteractiveFilmListingSnapshot(
  input: unknown,
  gameId: string,
  contentVersion: string
): AdminInteractiveFilmListingSnapshot {
  const snapshot = object(input);
  if (snapshot.contentVersion !== contentVersion) {
    throw new Error(
      "Promotional materials belong to a different release version. Refresh the review."
    );
  }
  if (snapshot.listing === null) return { contentVersion, listing: null };
  const listing = object(snapshot.listing);
  if (listing.gameId !== gameId) {
    throw new Error("Promotional materials belong to a different interactive film.");
  }
  const tags = strings(listing.tags, 12);
  if (!Array.isArray(listing.screenshots) || listing.screenshots.length > 8) invalidResponse();
  const screenshots = listing.screenshots.map((item) => ({ url: url(object(item).url)! }));
  if (screenshots.some((item) => !item.url)) invalidResponse();
  return {
    contentVersion,
    listing: {
      gameId,
      title: string(listing.title, 240),
      defaultLocale: string(listing.defaultLocale, 80),
      description: string(listing.description, 13_000),
      tags,
      developer: string(listing.developer, 240, true),
      coverUrl: url(listing.coverUrl),
      trailerUrl: url(listing.trailerUrl),
      screenshots,
    },
  };
}

function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return invalidResponse();
  return input as Record<string, unknown>;
}

function string(input: unknown, maxLength: number, allowEmpty = false): string {
  if (
    typeof input !== "string" ||
    (!allowEmpty && !input.trim()) ||
    [...input].length > maxLength
  ) {
    return invalidResponse();
  }
  return input;
}

function strings(input: unknown, maxLength: number): string[] {
  if (!Array.isArray(input) || input.length > maxLength) return invalidResponse();
  return input.map((item) => string(item, 80));
}

function url(input: unknown): string | null {
  if (input === null) return null;
  const value = string(input, 8_192);
  try {
    const parsed = new URL(value);
    if (["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password) {
      return value;
    }
  } catch {
    // Invalid URLs must not become links or media sources in the review UI.
  }
  return invalidResponse();
}

function invalidResponse(): never {
  throw new Error("The promotional materials response is invalid.");
}
