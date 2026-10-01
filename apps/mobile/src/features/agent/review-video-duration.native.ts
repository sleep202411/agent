import { createVideoPlayer } from "expo-video";
import { CONTENT_REVIEW_MAX_DURATION_SECONDS } from "@repo/shared";

/** Read local metadata without playback; never keep a player alive after navigation. */
export async function reviewVideoDuration(uri: string, signal: AbortSignal): Promise<number> {
  signal.throwIfAborted();
  if (!/^(file:|blob:|data:)/.test(uri)) throw new Error("Select a local video");
  const player = createVideoPlayer(null);
  const subscriptions: { remove(): void }[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await new Promise<number>((resolve, reject) => {
      const loaded = (duration: number) => {
        if (!Number.isFinite(duration) || duration <= 0)
          return reject(new Error("Unable to read video duration"));
        if (duration > CONTENT_REVIEW_MAX_DURATION_SECONDS)
          return reject(new Error("Video exceeds the three-hour review limit"));
        resolve(Math.ceil(duration));
      };
      abort = () => reject(signal.reason ?? new Error("Video selection cancelled"));
      signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => reject(new Error("Reading video duration timed out")), 30_000);
      subscriptions.push(player.addListener("sourceLoad", ({ duration }) => loaded(duration)));
      subscriptions.push(
        player.addListener("statusChange", ({ status, error }) => {
          if (status === "error") reject(new Error(error?.message || "Unable to read video"));
        })
      );
      // Do not await replacement: a stalled decoder must still honour timeout/abort.
      void player.replaceAsync({ uri, useCaching: false }).catch(reject);
    });
  } finally {
    clearTimeout(timer);
    if (abort) signal.removeEventListener("abort", abort);
    subscriptions.forEach((subscription) => subscription.remove());
    player.release();
  }
}
