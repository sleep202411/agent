import { createVideoPlayer } from "expo-video";
import { videoMetadata } from "./reference-video-metadata-schema";
/** Exact local metadata only; the server measures stored bytes again before billing. */
export async function probeReferenceVideo(picked: { uri: string }, signal: AbortSignal) {
  signal.throwIfAborted();
  if (!/^(file:|blob:|data:)/.test(picked.uri)) throw new Error("Select a local video.");
  const player = createVideoPlayer(null);
  const subscriptions: { remove(): void }[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await new Promise<import("zod").infer<typeof videoMetadata>>((resolve, reject) => {
      abort = () => reject(signal.reason ?? new Error("Video selection cancelled."));
      signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => reject(new Error("Reading video metadata timed out.")), 30_000);
      subscriptions.push(
        player.addListener("sourceLoad", ({ duration, availableVideoTracks }) => {
          const track = availableVideoTracks[0];
          const value = videoMetadata.safeParse({
            durationSeconds: duration,
            width: track?.size.width,
            height: track?.size.height,
          });
          if (!value.success) reject(new Error("Unable to read video duration and dimensions."));
          else resolve(value.data);
        })
      );
      subscriptions.push(
        player.addListener("statusChange", ({ status, error }) => {
          if (status === "error") reject(new Error(error?.message || "Unable to read video."));
        })
      );
      void player.replaceAsync({ uri: picked.uri, useCaching: false }).catch(reject);
    });
  } finally {
    clearTimeout(timer);
    if (abort) signal.removeEventListener("abort", abort);
    subscriptions.forEach((s) => s.remove());
    player.release();
  }
}
