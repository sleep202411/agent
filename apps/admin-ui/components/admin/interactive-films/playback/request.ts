import type {
  StoryPlaybackOverview,
  StoryPlaybackReconcileResult,
  StoryPlaybackRetryFailedResult,
} from "@repo/shared/story-playback";
import { adminUiApiPath, parseAdminEnvelope } from "@/lib/admin-api";

const PLAYBACK_API = "/api/admin/interactive-film-playback";

/** Reads Nest's HLS distribution overview through the same-origin relay. */
export function readInteractiveFilmPlayback(
  gameIds: readonly string[],
  options: { includeClips: boolean; signal: AbortSignal }
): Promise<StoryPlaybackOverview> {
  const clips = options.includeClips ? "&include=clips" : "";
  return requestPlayback(`?gameIds=${gameIds.map(encodeURIComponent).join(",")}${clips}`, {
    signal: options.signal,
  });
}

export function reconcileInteractiveFilmPlayback(
  signal: AbortSignal
): Promise<StoryPlaybackReconcileResult> {
  return requestPlayback("/reconcile", postEmpty(signal));
}

export function retryFailedInteractiveFilmPlayback(
  gameId: string,
  signal: AbortSignal
): Promise<StoryPlaybackRetryFailedResult> {
  return requestPlayback(`/games/${encodeURIComponent(gameId)}/retry-failed`, postEmpty(signal));
}

function postEmpty(signal: AbortSignal): RequestInit & { signal: AbortSignal } {
  return { method: "POST", signal, headers: { "content-type": "application/json" }, body: "{}" };
}

/** Requires `code === 200`; any other answer throws Nest's `msg`/`message` verbatim. */
async function requestPlayback<T>(
  path: string,
  init: RequestInit & { signal: AbortSignal }
): Promise<T> {
  const response = await fetch(adminUiApiPath(`${PLAYBACK_API}${path}`), {
    cache: "no-store",
    ...init,
  });
  const data = await parseAdminEnvelope<T>(response);
  init.signal.throwIfAborted();
  return data;
}
