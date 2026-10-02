import {
  IpStudioRequestSchema,
  IpStudioResultSchema,
  type IpStudioResult,
} from "@repo/shared/creator-location";
import { getAuthGeneration } from "@/auth/auth-store";
import { api } from "@/lib/api-client";
import type { StudioScope } from "./studio-search-api";
export type IpStudiosPage = IpStudioResult;
export async function fetchIpStudios(
  scope: StudioScope,
  ipId: string,
  locale: string,
  cursor: IpStudioResult["nextCursor"],
  requestId: string,
  signal: AbortSignal
) {
  const current = () => {
    if (signal.aborted || scope.generation !== getAuthGeneration())
      throw Error("Studio relationship session expired.");
  };
  current();
  const data = IpStudioRequestSchema.parse({ ipId, locale, cursor, requestId, limit: 20 });
  if (!scope.viewerId && cursor) throw Error("Sign in to load more studios.");
  const page = IpStudioResultSchema.parse(
    await api.post("/ip-commerce/content-gps/studios", {
      service: "aurora",
      data,
      signal,
      retry: false,
      credentials: scope.viewerId ? "include" : "omit",
    })
  );
  current();
  if (
    page.ipId !== ipId ||
    page.locale !== locale ||
    page.requestId !== requestId ||
    (cursor && cursor.queryId !== page.queryId) ||
    new Set(page.items.map((item) => item.studio.id)).size !== page.items.length ||
    page.items.length > (scope.viewerId ? 20 : 50) ||
    (scope.viewerId && page.requiresLogin) ||
    (!scope.viewerId && page.nextCursor) ||
    (page.nextCursor &&
      (page.nextCursor.queryId !== page.queryId ||
        page.nextCursor.afterId !== page.items.at(-1)?.studio.id ||
        page.nextCursor.afterId === cursor?.afterId))
  )
    throw Error("Studio relationships changed. Please refresh.");
  return page;
}
