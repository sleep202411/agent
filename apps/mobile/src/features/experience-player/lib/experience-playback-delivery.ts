import { Platform } from "react-native";
import { StoryBuildAssetPlaybackResponseSchema } from "@repo/shared/story-playback";
import { appEnv } from "@/config";
import { absolutizeExperienceMediaUri } from "./experience-media";
import { resolvePlaybackUri } from "./experience-media-cache";

const BUILD_CONTENT =
  /\/story-projects\/[^/]+\/builds\/[^/]+\/assets\/[^/]+\/variants\/[^/]+\/content$/;

/** Expo forwards the source to the platform player; negotiate only when it can play HLS. */
export function supportsAdaptivePlayback(): boolean {
  if (Platform.OS !== "web") return true;
  if (typeof document === "undefined") return false;
  return !!document.createElement("video").canPlayType("application/vnd.apple.mpegurl");
}

export function adaptivePlaybackEndpoint(source: string): string | null {
  if (appEnv.appRegion !== "cn" || !supportsAdaptivePlayback()) return null;
  const absolute = absolutizeExperienceMediaUri(source);
  if (!absolute) return null;
  try {
    const url = new URL(absolute);
    if (!/^https?:$/.test(url.protocol) || !BUILD_CONTENT.test(url.pathname)) return null;
    url.pathname = url.pathname.replace(/\/content$/, "/playback");
    return url.href;
  } catch {
    return null;
  }
}

/** Only an explicit null response permits progressive playback. Never bypass an access error. */
export async function resolveExperienceVideoSource(
  source: string,
  signal: AbortSignal
): Promise<{ uri: string; contentType?: "hls" }> {
  signal.throwIfAborted();
  const endpoint = adaptivePlaybackEndpoint(source);
  if (!endpoint) return { uri: await resolvePlaybackUri(source, signal) };
  const abort = new AbortController();
  const cancel = () => abort.abort();
  signal.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(cancel, 15_000);
  try {
    const response = await fetch(endpoint, {
      signal: abort.signal,
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    const body: unknown = await response.json();
    abort.signal.throwIfAborted();
    if (!response.ok) {
      const message = body && typeof body === "object" && "message" in body ? body.message : null;
      throw new Error(
        typeof message === "string" ? message : `Playback unavailable (${response.status})`
      );
    }
    const parsed = StoryBuildAssetPlaybackResponseSchema.safeParse(body);
    if (!parsed.success) throw new Error("Playback negotiation returned an invalid response");
    if (parsed.data.data) return { uri: parsed.data.data.url, contentType: "hls" };
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", cancel);
  }
  signal.throwIfAborted();
  return { uri: await resolvePlaybackUri(source, signal) };
}
