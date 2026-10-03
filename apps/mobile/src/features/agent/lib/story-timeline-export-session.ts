/** Own one immutable timeline snapshot. Platform encoders supply the media artifact;
 * upload and candidate attachment retain separate retry checkpoints. */
export type TimelineExportArtifact = { uri: string; contentType: "video/mp4"; size: number };
export type TimelineExportResult = { artifact: TimelineExportArtifact; completedClipIds: string[] };
export type TimelineExportShot = {
  id: string;
  kind: "video" | "image";
  url: string;
  durationMs: number;
};
export type TimelineExportSnapshot = {
  projectId: string;
  chapterId: string;
  sequenceId: string;
  version: number;
  shots: TimelineExportShot[];
  omittedClipIds: string[];
};
export type TimelineExportState = {
  stage: "idle" | "rendering" | "uploading" | "attaching" | "saved" | "failed";
  progress: number;
  error?: string;
  omittedClipIds: string[];
  mediaAssetId?: string;
};
export function createTimelineExportSession(options: {
  snapshot: TimelineExportSnapshot;
  current(): boolean;
  render(
    shots: TimelineExportShot[],
    signal: AbortSignal,
    progress: (ratio: number) => void
  ): Promise<TimelineExportResult>;
  /** The uploader owns idempotent/receipt-based recovery for interrupted uploads. */
  upload(
    artifact: TimelineExportArtifact,
    signal: AbortSignal,
    progress: (ratio: number) => void
  ): Promise<string>;
  /** Official candidate attachment is an upsert; retries use the same media ID. */
  attach(projectId: string, mediaAssetId: string, signal: AbortSignal): Promise<void>;
  release(artifact: TimelineExportArtifact): void;
  onState(state: TimelineExportState): void;
}) {
  const snapshot = {
    ...options.snapshot,
    shots: options.snapshot.shots.map((shot) => ({ ...shot })),
    omittedClipIds: [...options.snapshot.omittedClipIds],
  };
  if (
    !snapshot.shots.length ||
    new Set(snapshot.shots.map((s) => s.id)).size !== snapshot.shots.length
  )
    throw Error("Export requires distinct video clips.");
  for (const shot of snapshot.shots) {
    const url = new URL(shot.url);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !Number.isSafeInteger(shot.durationMs) ||
      shot.durationMs <= 0
    )
      throw Error("Invalid timeline export source.");
  }
  let operation: AbortController | undefined;
  let disposed = false;
  let result: TimelineExportResult | undefined;
  let mediaAssetId: string | undefined;
  let saved = false;
  const current = () => !disposed && options.current();
  const omitted = () => [
    ...new Set([
      ...snapshot.omittedClipIds,
      ...snapshot.shots
        .filter((s) => result && !result.completedClipIds.includes(s.id))
        .map((s) => s.id),
    ]),
  ];
  const state = (stage: TimelineExportState["stage"], progress = 0, error?: string) => {
    if (current())
      options.onState({ stage, progress, error, omittedClipIds: omitted(), mediaAssetId });
  };
  const release = () => {
    const artifact = result?.artifact;
    result = undefined;
    if (artifact) options.release(artifact);
  };
  return {
    async save() {
      if (!current() || operation || saved) return;
      const owned = new AbortController();
      operation = owned;
      const valid = () => current() && operation === owned && !owned.signal.aborted;
      const progress = (stage: "rendering" | "uploading") => (ratio: number) => {
        if (valid() && Number.isFinite(ratio)) state(stage, Math.max(0, Math.min(1, ratio)));
      };
      try {
        if (!result) {
          state("rendering");
          const rendered = await options.render(
            snapshot.shots.map((shot) => ({ ...shot })),
            owned.signal,
            progress("rendering")
          );
          if (!valid()) {
            options.release(rendered.artifact);
            return;
          }
          const ids = rendered.completedClipIds;
          if (
            !ids.length ||
            new Set(ids).size !== ids.length ||
            ids.some((id) => !snapshot.shots.some((s) => s.id === id)) ||
            rendered.artifact.contentType !== "video/mp4" ||
            !rendered.artifact.uri ||
            !Number.isSafeInteger(rendered.artifact.size) ||
            rendered.artifact.size <= 0
          ) {
            options.release(rendered.artifact);
            throw Error("The encoder did not return a valid timeline export.");
          }
          result = {
            artifact: { ...rendered.artifact },
            completedClipIds: [...rendered.completedClipIds],
          };
        }
        if (!mediaAssetId) {
          state("uploading");
          const id = await options.upload(result.artifact, owned.signal, progress("uploading"));
          if (!valid()) return;
          if (!id) throw Error("Export upload did not return a media asset.");
          mediaAssetId = id;
        }
        state("attaching");
        await options.attach(snapshot.projectId, mediaAssetId, owned.signal);
        if (!valid()) return;
        saved = true;
        state("saved", 1);
      } catch (e) {
        if (valid()) state("failed", 0, e instanceof Error ? e.message : String(e));
      } finally {
        if (operation === owned) operation = undefined;
      }
    },
    cancel() {
      operation?.abort();
      operation = undefined;
      // Keep any finished artifact/upload for a deliberate retry of this snapshot.
      if (!saved) state("idle");
    },
    dispose() {
      disposed = true;
      operation?.abort();
      operation = undefined;
      release();
    },
  };
}
