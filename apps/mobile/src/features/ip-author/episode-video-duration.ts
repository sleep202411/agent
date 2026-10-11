export async function readDuration(uri: string, signal: AbortSignal): Promise<number> {
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
        if (duration > 86400) return reject(new Error("Video duration exceeds the episode limit"));
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

export async function probeEpisodeVideoDuration(
  picked: { uri: string; file?: File },
  signal: AbortSignal
): Promise<number | null> {
  signal.throwIfAborted();
  if (!picked.file) return null;
  const url = URL.createObjectURL(picked.file);
  try {
    return await readDuration(url, signal);
  } catch {
    signal.throwIfAborted();
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
