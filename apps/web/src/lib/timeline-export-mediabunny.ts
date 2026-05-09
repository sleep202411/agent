/**
 * Client-side timeline export — concatenates a sequence of video URLs
 * into a single MP4, in the browser, via Mediabunny + WebCodecs.
 *
 * Why this exists
 * ───────────────
 * Today's "export" path goes through the server (ffmpeg). Round-trip
 * cost dominates user perception when they just want a quick draft.
 * Mediabunny lets us decode each shot's video, re-encode the frames
 * into a single H.264/AAC MP4 entirely on the user's machine — using
 * hardware-accelerated VideoEncoder/VideoDecoder when available.
 *
 * Scope (v1, intentionally minimal)
 * ─────────────────────────────────
 * - Concatenates only shots that have a `videoUrl`. Shots without a
 *   video are skipped (a future iteration will render the still
 *   image as a held frame for the shot's duration).
 * - Re-encodes all frames to a unified H.264 stream so codec mixing
 *   between shots can't break the output (some shots may be H.264,
 *   others HEVC; passing original packets through would fail mux
 *   compatibility).
 * - Audio is NOT yet muxed in. Without per-shot audio mixing this is
 *   a deliberate v1 limitation; v2 will pull each shot's audio track
 *   and concatenate alongside the video.
 *
 * Anything that would surprise a future reader of this code lives
 * inline in comments next to the line that earns it.
 */

import {
  ALL_FORMATS,
  BufferTarget,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_MEDIUM,
  UrlSource,
  VideoSample,
  VideoSampleSink,
  VideoSampleSource,
} from "mediabunny";

export interface ExportableShot {
  id: string;
  videoUrl?: string;
}

export interface TimelineExportOptions {
  /** Output bitrate target. Defaults to a subjective "medium" quality
   * preset, which Mediabunny resolves to a per-codec sensible default
   * (e.g. ~3 Mbps for 720p H.264). Pass a number (bits/s) to pin it. */
  bitrate?: number | typeof QUALITY_MEDIUM;
  /** GOP length (key-frame interval) in seconds. 2s is Mediabunny's
   * own default — we surface it so callers can pick smaller values
   * for short-form videos that want fast scrub-seeking. */
  keyFrameInterval?: number;
  /** 0..1 progress callback. Fires after each shot is processed. */
  onProgress?: (ratio: number) => void;
  /** AbortSignal — propagated into Mediabunny's Input.dispose() so
   * an in-flight network read can be cancelled mid-export. */
  signal?: AbortSignal;
}

export class TimelineExportError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "TimelineExportError";
  }
}

/**
 * Concatenate the listed shots (in order) into a single MP4 Blob.
 *
 * Throws `TimelineExportError` for setup-phase failures (no eligible
 * shots, codec unsupported in this browser, etc.). Once encoding has
 * started, errors from a single shot are logged and that shot is
 * skipped — partial output is preferred over throwing away the user's
 * already-completed encode work.
 */
export async function exportTimelineToMp4(
  shots: ExportableShot[],
  options: TimelineExportOptions = {}
): Promise<Blob> {
  const eligible = shots.filter((shot) => Boolean(shot.videoUrl));
  if (eligible.length === 0) {
    throw new TimelineExportError("Timeline has no shots with a video URL to export.");
  }

  // Mediabunny output: MP4 container, in-memory ArrayBuffer target.
  // BufferTarget materialises `output.target.buffer` only after
  // `finalize()` resolves — accessing it earlier returns null.
  const output = new Output({
    format: new Mp4OutputFormat(),
    target: new BufferTarget(),
  });

  const videoSource = new VideoSampleSource({
    codec: "avc",
    bitrate: options.bitrate ?? QUALITY_MEDIUM,
    keyFrameInterval: options.keyFrameInterval ?? 2,
    // Allow shots with different intrinsic resolutions to flow through
    // the same encoder by letterboxing into the first shot's frame
    // box. `'deny'` (Mediabunny default) would error out on any size
    // mismatch, which is too strict for a creator-platform timeline
    // where shots come from heterogeneous AI providers.
    sizeChangeBehavior: "contain",
  });
  output.addVideoTrack(videoSource);

  await output.start();

  // Cumulative timestamp (in seconds) where the next shot's first
  // frame should land. Each shot's frames are remapped from the
  // shot-local timeline (0..shotDuration) to the global timeline
  // (offset..offset+shotDuration). Without this rebasing every shot
  // would write frames at the same starting timestamp and the muxer
  // would drop all but the first.
  let timelineOffsetSeconds = 0;
  let processedShots = 0;
  let totalFramesEncoded = 0;
  // Surface the first per-shot error so we can include it in the
  // "no frames encoded" diagnostic. Without this the user sees a
  // generic message and has to dig in the console.
  let firstShotError: unknown = null;

  for (const shot of eligible) {
    if (options.signal?.aborted) {
      // Caller cancelled — finalise what we already encoded so the
      // user at least gets a valid (truncated) MP4 instead of a
      // dangling file handle.
      break;
    }

    const input = new Input({
      source: new UrlSource(shot.videoUrl!),
      formats: ALL_FORMATS,
    });

    let shotFramesEncoded = 0;
    try {
      const videoTrack = await input.getPrimaryVideoTrack();
      if (!videoTrack) {
        console.warn(`[timeline-export] shot ${shot.id}: no primary video track, skipping`);
        continue;
      }

      const shotDuration = await input.computeDuration([videoTrack]);
      const sink = new VideoSampleSink(videoTrack);

      // Iterate decoded frames in presentation order. Mediabunny
      // pre-decodes a few frames ahead so this loop doesn't stall
      // waiting on the decoder for every individual frame.
      for await (const sample of sink.samples()) {
        if (options.signal?.aborted) {
          sample.close();
          break;
        }
        // Rebase frame timestamp into the global timeline.
        sample.setTimestamp(sample.timestamp + timelineOffsetSeconds);
        await videoSource.add(sample);
        sample.close();
        shotFramesEncoded += 1;
      }

      timelineOffsetSeconds += shotDuration;
      totalFramesEncoded += shotFramesEncoded;
      console.info(
        `[timeline-export] shot ${shot.id}: ${shotFramesEncoded} frames, ${shotDuration.toFixed(2)}s`
      );
    } catch (error) {
      // Per-shot failure: log + continue. Surfacing this as a thrown
      // error would discard the user's already-encoded earlier shots,
      // which is the worse UX trade-off — UNLESS no shot has yet
      // produced anything, in which case we'd be silently shipping an
      // empty MP4. We handle that after the loop.
      console.error(`[timeline-export] shot ${shot.id} failed:`, error);
      if (firstShotError == null) firstShotError = error;
    } finally {
      input.dispose();
    }

    processedShots += 1;
    options.onProgress?.(processedShots / eligible.length);
  }

  if (totalFramesEncoded === 0) {
    // Empty output is worse than a thrown error: the user gets a
    // tiny "successful" MP4 that won't play anywhere. Most common
    // cause is CORS — UrlSource fetches bytes, so cross-origin URLs
    // need Access-Control-Allow-Origin set on the asset host.
    const detail =
      firstShotError instanceof Error
        ? firstShotError.message
        : firstShotError != null
          ? String(firstShotError)
          : "no per-shot error captured";
    throw new TimelineExportError(
      `Export produced no frames (likely CORS or unsupported codec). First failure: ${detail}`,
      firstShotError ?? undefined
    );
  }

  await output.finalize();

  const buffer = (output.target as BufferTarget).buffer;
  if (!buffer) {
    throw new TimelineExportError("Output finalised without producing a buffer.");
  }

  return new Blob([buffer], { type: "video/mp4" });
}

/**
 * Sugar: kick off a download in the user's browser. Caller owns the
 * timing — call after `exportTimelineToMp4` resolves.
 */
export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Defer revocation by a tick — some browsers cancel the download
  // if the URL is revoked synchronously after click().
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
