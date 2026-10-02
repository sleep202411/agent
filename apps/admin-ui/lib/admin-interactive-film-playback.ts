import "server-only";

import { cookies } from "next/headers";
import type { StoryPlaybackOverview } from "@repo/shared/story-playback";
import {
  ADMIN_SESSION_COOKIE,
  adminApiUrl,
  adminAuthHeaders,
  parseAdminEnvelope,
} from "@/lib/admin-api";
import type { InteractiveFilmPlaybackLoadResult } from "@/lib/interactive-film-playback-view";

const PLAYBACK_READ_TIMEOUT_MS = 15_000;

/**
 * Reads the .cn HLS distribution overview from Nest with the operator's admin
 * session. Nest owns the state; failures (including its 404 off the cn cell
 * and the verbatim Java catalogue error) come back as the error text.
 */
export async function loadInteractiveFilmPlayback(
  gameIds: string[],
  { includeClips }: { includeClips: boolean }
): Promise<InteractiveFilmPlaybackLoadResult> {
  const cookieStore = await cookies();
  const headers = adminAuthHeaders(cookieStore.get(ADMIN_SESSION_COOKIE)?.value);
  if (!headers) return { data: null, error: "后台登录已失效，请重新登录。" };

  try {
    const response = await fetch(
      adminApiUrl(
        `/interactive-film-playback?gameIds=${gameIds.map(encodeURIComponent).join(",")}${
          includeClips ? "&include=clips" : ""
        }`
      ),
      { headers, cache: "no-store", signal: AbortSignal.timeout(PLAYBACK_READ_TIMEOUT_MS) }
    );
    return { data: await parseAdminEnvelope<StoryPlaybackOverview>(response), error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error && error.message ? error.message : "播放分发数据加载失败。",
    };
  }
}
