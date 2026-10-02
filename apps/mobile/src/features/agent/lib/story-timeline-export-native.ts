import { requireOptionalNativeModule, uuid } from "expo-modules-core";
import { z } from "zod";
import type {
  TimelineExportArtifact,
  TimelineExportResult,
  TimelineExportShot,
} from "./story-timeline-export-session";
type NativeEncoder = {
  render(id: string, shots: TimelineExportShot[]): Promise<unknown>;
  cancel(id: string): Promise<void>;
  release(uri: string): Promise<void>;
  addListener(
    event: "progress",
    listener: (value: { id: string; ratio: number }) => void
  ): { remove(): void };
};
const resultSchema = z.object({
  artifact: z.object({
    uri: z
      .string()
      .url()
      .refine((s) => s.startsWith("file:///")),
    contentType: z.literal("video/mp4"),
    size: z.number().int().positive().safe(),
  }),
  completedClipIds: z.array(z.string().min(1)).min(1),
});
/** Native-only import: no WebCodecs or browser encoder dependency. */
export function createNativeTimelineEncoder() {
  const native = requireOptionalNativeModule<NativeEncoder>("FizzTimelineExport");
  let disposed = false;
  const jobs = new Set<string>();
  const outputs = new Set<string>();
  const release = (uri: string) => {
    if (outputs.delete(uri)) void native?.release(uri).catch(() => {});
  };
  const renderOnce = async (
    shots: TimelineExportShot[],
    signal: AbortSignal,
    progress: (ratio: number) => void
  ): Promise<TimelineExportResult> => {
    signal.throwIfAborted();
    if (!native) throw Error("Native timeline encoding is not included in this app build.");
    if (disposed) throw Error("Timeline encoder is closed.");
    const captured = shots.map((shot) => ({ ...shot }));
    if (!captured.length || new Set(captured.map((s) => s.id)).size !== captured.length)
      throw Error("Export requires distinct video clips.");
    const id = uuid.v4();
    jobs.add(id);
    const subscription = native.addListener("progress", (value) => {
      if (
        !disposed &&
        !signal.aborted &&
        jobs.has(id) &&
        value.id === id &&
        Number.isFinite(value.ratio)
      )
        progress(Math.max(0, Math.min(1, value.ratio)));
    });
    const cancel = () => {
      void native.cancel(id).catch(() => {});
    };
    try {
      const pending = native.render(
        id,
        captured.map((shot) => ({ ...shot }))
      );
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) cancel();
      const raw = await pending;
      const checked = resultSchema.safeParse(raw);
      if (!checked.success) {
        // Native release accepts only paths in its own completed-output registry.
        const candidate = raw as { artifact?: { uri?: unknown } } | null;
        if (typeof candidate?.artifact?.uri === "string")
          void native.release(candidate.artifact.uri).catch(() => {});
        throw Error("Native encoder returned an invalid export.");
      }
      const parsed = checked.data;
      outputs.add(parsed.artifact.uri);
      if (disposed || signal.aborted) {
        release(parsed.artifact.uri);
        signal.throwIfAborted();
        throw Error("Timeline encoder is closed.");
      }
      if (
        new Set(parsed.completedClipIds).size !== parsed.completedClipIds.length ||
        parsed.completedClipIds.some((clipId) => !captured.some((s) => s.id === clipId)) ||
        captured
          .filter((s) => parsed.completedClipIds.includes(s.id))
          .some((s, index) => s.id !== parsed.completedClipIds[index])
      ) {
        release(parsed.artifact.uri);
        throw Error("Native export receipt does not match this timeline.");
      }
      return parsed;
    } finally {
      signal.removeEventListener("abort", cancel);
      subscription.remove();
      jobs.delete(id);
    }
  };
  return {
    supported: native !== null,
    async render(
      shots: TimelineExportShot[],
      signal: AbortSignal,
      progress: (ratio: number) => void
    ) {
      const captured = shots.map((shot) => ({ ...shot }));
      const sourceFailure = (error: unknown) =>
        (error as { code?: unknown } | null)?.code === "EXPORT_SOURCE_FAILED";
      const check = () => {
        signal.throwIfAborted();
        if (disposed) throw Error("Timeline encoder is closed.");
      };
      try {
        return await renderOnce(captured, signal, progress);
      } catch (error) {
        check();
        if (!sourceFailure(error) || captured.length < 2) throw error;
      }
      // Only a classified source error permits isolation. Never skip clips for
      // encoder, storage, permission, unknown or cancellation failures.
      const valid: TimelineExportShot[] = [];
      let inspected = 0;
      progress(0);
      for (const shot of captured) {
        check();
        try {
          const probe = await renderOnce([shot], signal, () => {});
          release(probe.artifact.uri);
          valid.push(shot);
        } catch (error) {
          check();
          if (!sourceFailure(error)) throw error;
        }
        progress(++inspected / (captured.length + 1));
      }
      check();
      if (!valid.length) throw Error("No timeline clips could be exported.");
      // Compose original sources in original order. Probe artifacts are never
      // returned/uploaded and have already been released.
      return renderOnce(valid, signal, (ratio) =>
        progress((inspected + ratio) / (captured.length + 1))
      );
    },
    release(artifact: TimelineExportArtifact) {
      release(artifact.uri);
    },
    dispose() {
      disposed = true;
      for (const id of jobs) void native?.cancel(id).catch(() => {});
      for (const uri of [...outputs]) release(uri);
    },
  };
}
