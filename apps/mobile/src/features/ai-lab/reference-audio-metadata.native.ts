import { createAudioPlayer, type AudioStatus } from "expo-audio";
import { audioMetadata } from "./reference-audio-metadata-schema";

/** Probe local media without playback, recording permissions or changing the audio session. */
export async function probeReferenceAudio(picked: { uri: string }, signal: AbortSignal) {
  signal.throwIfAborted();
  if (!/^(file:|blob:|data:)/.test(picked.uri)) throw new Error("Select a local audio file.");
  const player = createAudioPlayer(null, { downloadFirst: false });
  let subscription: { remove(): void } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await new Promise<import("zod").infer<typeof audioMetadata>>((resolve, reject) => {
      abort = () => reject(signal.reason ?? new Error("Audio selection cancelled."));
      signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => reject(new Error("Reading audio metadata timed out.")), 30_000);
      const inspect = (status: AudioStatus) => {
        if (status.error) return reject(new Error(status.error));
        if (!status.isLoaded) return;
        const value = audioMetadata.safeParse({ durationSeconds: status.duration });
        if (!value.success || status.isLive) reject(new Error("Unable to read audio duration."));
        else resolve(value.data);
      };
      subscription = player.addListener("playbackStatusUpdate", inspect);
      player.replace({ uri: picked.uri });
      inspect(player.currentStatus);
    });
  } finally {
    clearTimeout(timer);
    if (abort) signal.removeEventListener("abort", abort);
    subscription?.remove();
    player.remove();
  }
}
