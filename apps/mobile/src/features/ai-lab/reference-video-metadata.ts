import { videoMetadata } from "./reference-video-metadata-schema";
export async function probeReferenceVideo(
  picked: { uri: string; file?: File },
  signal: AbortSignal
) {
  signal.throwIfAborted();
  if (!picked.file && !picked.uri.startsWith("blob:")) throw new Error("Select a local video.");
  const url = picked.file ? URL.createObjectURL(picked.file) : picked.uri;
  const video = document.createElement("video");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await new Promise<import("zod").infer<typeof videoMetadata>>((resolve, reject) => {
      abort = () => reject(signal.reason ?? new Error("Video selection cancelled."));
      signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => reject(new Error("Reading video metadata timed out.")), 30_000);
      video.preload = "metadata";
      video.muted = true;
      video.onloadedmetadata = () => {
        const value = videoMetadata.safeParse({
          durationSeconds: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
        });
        if (!value.success) reject(new Error("Unable to read video duration and dimensions."));
        else resolve(value.data);
      };
      video.onerror = () => reject(new Error(video.error?.message || "Unable to read video."));
      video.src = url;
      video.load();
    });
  } finally {
    clearTimeout(timer);
    if (abort) signal.removeEventListener("abort", abort);
    video.onloadedmetadata = null;
    video.onerror = null;
    video.removeAttribute("src");
    video.load();
    if (picked.file) URL.revokeObjectURL(url);
  }
}
