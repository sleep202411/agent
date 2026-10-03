import type {
  TimelineExportArtifact,
  TimelineExportResult,
  TimelineExportShot,
} from "./story-timeline-export-session";
/** Browser-only adapter. Native must provide its own encoder; it must not load WebCodecs. */
export function createBrowserTimelineEncoder() {
  const artifacts = new Map<string, Blob>();
  let disposed = false;
  return {
    async render(
      shots: TimelineExportShot[],
      signal: AbortSignal,
      progress: (ratio: number) => void
    ): Promise<TimelineExportResult> {
      signal.throwIfAborted();
      if (disposed) throw Error("Timeline encoder is closed.");
      const encoder = await import("@repo/timeline-export");
      signal.throwIfAborted();
      if (disposed) throw Error("Timeline encoder is closed.");
      if (!encoder.isExportSupported())
        throw new encoder.TimelineExportUnsupportedError(
          "This browser does not support timeline video export."
        );
      // Preserve exact source order and timeline-set duration. The official renderer
      // holds still images and the final video frame through the requested duration.
      const captured = shots.map((shot) => ({ ...shot }));
      let completedClipIds: string[] | undefined;
      const blob = await encoder.exportTimelineToMp4(
        captured.map((shot) => ({
          id: shot.id,
          ...(shot.kind === "image" ? { imageUrl: shot.url } : { videoUrl: shot.url }),
          duration: shot.durationMs / 1000,
        })),
        {
          signal,
          onProgress: progress,
          onReport: (report) => {
            const failed = new Set(report.issues.map((issue) => issue.index));
            if (
              report.requestedShots !== captured.length ||
              report.issues.some(
                (issue) => !captured[issue.index] || captured[issue.index].id !== issue.shotId
              )
            )
              throw Error("Export report does not match the timeline.");
            const ids = captured.filter((_, index) => !failed.has(index)).map((shot) => shot.id);
            if (ids.length !== report.completedShots)
              throw Error("Export report has inconsistent completion counts.");
            completedClipIds = ids;
          },
        }
      );
      signal.throwIfAborted();
      if (disposed) throw Error("Timeline encoder is closed.");
      // The shared encoder isolates observer exceptions. An invalid/missing report
      // therefore leaves this undefined and is rejected here, before saving.
      if (!completedClipIds?.length || !blob.size || blob.type !== "video/mp4")
        throw Error("Timeline export did not produce a verified MP4.");
      const uri = URL.createObjectURL(blob);
      artifacts.set(uri, blob);
      return { artifact: { uri, contentType: "video/mp4", size: blob.size }, completedClipIds };
    },
    file(artifact: TimelineExportArtifact, filename: string) {
      const blob = artifacts.get(artifact.uri);
      if (disposed || !blob || blob.size !== artifact.size || artifact.contentType !== "video/mp4")
        throw Error("Timeline export is no longer available.");
      return new File([blob], filename, { type: "video/mp4" });
    },
    release(artifact: TimelineExportArtifact) {
      if (artifacts.delete(artifact.uri)) URL.revokeObjectURL(artifact.uri);
    },
    dispose() {
      disposed = true;
      for (const uri of artifacts.keys()) URL.revokeObjectURL(uri);
      artifacts.clear();
    },
  };
}
