import { adminUiApiPath, parseAdminEnvelope } from "./admin-api";
import { parseAdminInteractiveFilmListingSnapshot } from "./interactive-film-listing-contract";

export async function requestAdminInteractiveFilmListing(
  gameId: string,
  contentVersion: string,
  signal?: AbortSignal
) {
  const response = await fetch(
    adminUiApiPath(
      `/api/admin/interactive-films/${encodeURIComponent(gameId)}/listing?contentVersion=${encodeURIComponent(contentVersion)}`
    ),
    {
      cache: "no-store",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
        : AbortSignal.timeout(15_000),
    }
  );
  return parseAdminInteractiveFilmListingSnapshot(
    await parseAdminEnvelope<unknown>(response),
    gameId,
    contentVersion
  );
}
