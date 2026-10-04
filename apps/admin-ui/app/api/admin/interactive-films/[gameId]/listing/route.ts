import type { NextRequest } from "next/server";
import {
  adminFetch,
  adminForwardHeaders,
  adminUnavailableResponse,
  adminUrlForRequest,
  relayAdminResponse,
} from "@/lib/admin-route";
import { getAdminSession } from "@/lib/admin-session";
import { parseInteractiveFilmGameId } from "@/lib/interactive-film-admin-contract";
import { parseInteractiveFilmListingVersion } from "@/lib/interactive-film-listing-contract";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ gameId: string }> }) {
  const session = await getAdminSession();
  if (!session) {
    return noStore(
      Response.json({ code: 401, msg: "Your admin session has expired." }, { status: 401 })
    );
  }
  if (!session.user.permissions.includes("ip.moderate")) {
    return noStore(
      Response.json(
        { code: 403, msg: "Interactive film moderation permission is required." },
        { status: 403 }
      )
    );
  }
  let gameId: string;
  let contentVersion: string;
  try {
    gameId = parseInteractiveFilmGameId((await context.params).gameId);
    contentVersion = parseInteractiveFilmListingVersion(
      request.nextUrl.searchParams.get("contentVersion")
    );
    if ([...request.nextUrl.searchParams.keys()].some((key) => key !== "contentVersion")) {
      throw new Error("Unexpected query parameter.");
    }
    if (request.nextUrl.searchParams.getAll("contentVersion").length !== 1) {
      throw new Error("One release version is required.");
    }
  } catch (error) {
    return noStore(
      Response.json(
        { code: 400, msg: error instanceof Error ? error.message : "Invalid request." },
        { status: 400 }
      )
    );
  }
  try {
    return noStore(
      await relayAdminResponse(
        await adminFetch(
          request,
          adminUrlForRequest(
            request,
            `/story-publications/${encodeURIComponent(gameId)}/listing?contentVersion=${encodeURIComponent(contentVersion)}`
          ),
          {
            method: "GET",
            headers: adminForwardHeaders(request),
            cache: "no-store",
            redirect: "error",
          }
        ),
        request.signal
      )
    );
  } catch {
    return noStore(adminUnavailableResponse());
  }
}

function noStore(response: Response): Response {
  response.headers.set("cache-control", "private, no-store");
  return response;
}
