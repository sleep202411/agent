/** Bounded first-frame extraction: thumbnails do not keep video decoders alive. */
const MAX_LOADERS = 2;
const MAX_POSTERS = 100;
type Poster = { url: string; width: number; height: number };
type Pending = { promise: Promise<Poster>; controller: AbortController; readers: number };
const posters = new Map<string, Poster>();
const pending = new Map<string, Pending>();
const queue: Array<() => void> = [];
let loaders = 0;

function pump() {
  while (loaders < MAX_LOADERS && queue.length) queue.shift()!();
}

function firstFrame(src: string, signal: AbortSignal): Promise<Poster> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    const finish = (error?: unknown, poster?: Poster) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      video.onloadeddata = null;
      video.onerror = null;
      video.removeAttribute("src");
      video.load();
      if (poster) resolve(poster);
      else reject(error);
    };
    const abort = () => finish(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(() => finish(new Error("Video preview timed out")), 15_000);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) return abort();
    video.onerror = () => finish(new Error(video.error?.message || "Video preview unavailable"));
    video.onloadeddata = () => {
      try {
        const width = video.videoWidth;
        const height = video.videoHeight;
        if (!width || !height) throw new Error("Video has no picture");
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 480 / width, 480 / height);
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Video preview unavailable");
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        finish(undefined, { url: canvas.toDataURL("image/jpeg", 0.75), width, height });
      } catch (error) {
        finish(error);
      }
    };
    video.src = src;
  });
}

export function acquireVideoPoster(src: string): { promise: Promise<Poster>; release: () => void } {
  const cached = posters.get(src);
  if (cached) {
    posters.delete(src);
    posters.set(src, cached);
    return { promise: Promise.resolve(cached), release: () => {} };
  }
  let entry = pending.get(src);
  if (!entry || entry.controller.signal.aborted) {
    const controller = new AbortController();
    const promise = new Promise<Poster>((resolve, reject) => {
      queue.push(() => {
        loaders++;
        firstFrame(src, controller.signal)
          .then((poster) => {
            posters.set(src, poster);
            if (posters.size > MAX_POSTERS) posters.delete(posters.keys().next().value!);
            resolve(poster);
          }, reject)
          .finally(() => {
            if (pending.get(src)?.controller === controller) pending.delete(src);
            loaders--;
            pump();
          });
      });
    });
    entry = { promise, controller, readers: 0 };
    pending.set(src, entry);
    pump();
  }
  entry.readers++;
  const acquired = entry;
  let released = false;
  return {
    promise: entry.promise,
    release: () => {
      if (released) return;
      released = true;
      if (--acquired.readers === 0) acquired.controller.abort();
    },
  };
}
