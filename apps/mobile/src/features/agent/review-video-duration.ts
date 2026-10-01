import { CONTENT_REVIEW_MAX_DURATION_SECONDS } from "@repo/shared";

export async function reviewVideoDuration(uri: string, signal: AbortSignal): Promise<number> {
  signal.throwIfAborted();
  if (!uri.startsWith("blob:")) throw new Error("Select a local video");
  const video = document.createElement("video");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await new Promise<number>((resolve, reject) => {
      abort = () => reject(signal.reason ?? new Error("Video selection cancelled"));
      signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => reject(new Error("Reading video duration timed out")), 30_000);
      video.preload = "metadata";
      video.muted = true;
      video.onloadedmetadata = () => {
        const duration = video.duration;
        if (!Number.isFinite(duration) || duration <= 0)
          return reject(new Error("Unable to read video duration"));
        if (duration > CONTENT_REVIEW_MAX_DURATION_SECONDS)
          return reject(new Error("Video exceeds the three-hour review limit"));
        resolve(Math.ceil(duration));
      };
      video.onerror = () => reject(new Error(video.error?.message || "Unable to read video"));
      video.src = uri;
      video.load();
    });
  } finally {
    clearTimeout(timer);
    if (abort) signal.removeEventListener("abort", abort);
    video.onloadedmetadata = null;
    video.onerror = null;
    video.removeAttribute("src");
    video.load();
  }
}
