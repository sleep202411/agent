import { audioMetadata } from "./reference-audio-metadata-schema";
export async function probeReferenceAudio(
  picked: { uri: string; file?: File },
  signal: AbortSignal
) {
  signal.throwIfAborted();
  if (!picked.file && !picked.uri.startsWith("blob:"))
    throw new Error("Select a local audio file.");
  const url = picked.file ? URL.createObjectURL(picked.file) : picked.uri;
  const audio = document.createElement("audio");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await new Promise<import("zod").infer<typeof audioMetadata>>((resolve, reject) => {
      abort = () => reject(signal.reason ?? new Error("Audio selection cancelled."));
      signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => reject(new Error("Reading audio metadata timed out.")), 30_000);
      audio.preload = "metadata";
      audio.muted = true;
      audio.onloadedmetadata = () => {
        const value = audioMetadata.safeParse({
          durationSeconds: audio.duration,
        });
        if (!value.success) reject(new Error("Unable to read audio duration."));
        else resolve(value.data);
      };
      audio.onerror = () => reject(new Error(audio.error?.message || "Unable to read audio."));
      audio.src = url;
      audio.load();
    });
  } finally {
    clearTimeout(timer);
    if (abort) signal.removeEventListener("abort", abort);
    audio.onloadedmetadata = null;
    audio.onerror = null;
    audio.removeAttribute("src");
    audio.load();
    if (picked.file) URL.revokeObjectURL(url);
  }
}
