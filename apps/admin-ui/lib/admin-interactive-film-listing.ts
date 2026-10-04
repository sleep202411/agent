import "server-only";
import { cookies } from "next/headers";
import {
  ADMIN_SESSION_COOKIE,
  adminApiUrl,
  adminAuthHeaders,
  parseAdminEnvelope,
} from "./admin-api";
import { parseInteractiveFilmGameId } from "./interactive-film-admin-contract";
import {
  parseAdminInteractiveFilmListingSnapshot,
  parseInteractiveFilmListingVersion,
  type AdminInteractiveFilmListingLoadResult,
} from "./interactive-film-listing-contract";

export async function loadAdminInteractiveFilmListing(
  gameId: string,
  contentVersion: string | null
): Promise<AdminInteractiveFilmListingLoadResult> {
  if (!contentVersion) return { contentVersion, data: null, error: null };
  try {
    parseInteractiveFilmGameId(gameId);
    parseInteractiveFilmListingVersion(contentVersion);
    const jar = await cookies();
    const headers = adminAuthHeaders(jar.get(ADMIN_SESSION_COOKIE)?.value);
    if (!headers) throw new Error("Your admin session has expired. Sign in again.");
    const response = await fetch(
      adminApiUrl(
        `/story-publications/${encodeURIComponent(gameId)}/listing?contentVersion=${encodeURIComponent(contentVersion)}`
      ),
      { headers, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) }
    );
    return {
      contentVersion,
      data: parseAdminInteractiveFilmListingSnapshot(
        await parseAdminEnvelope<unknown>(response),
        gameId,
        contentVersion
      ),
      error: null,
    };
  } catch (error) {
    return {
      contentVersion,
      data: null,
      error: error instanceof Error ? error.message : "Promotional materials could not be loaded.",
    };
  }
}
