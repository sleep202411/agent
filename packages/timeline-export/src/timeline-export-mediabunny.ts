/**
 * Client-side timeline export — concatenates a sequence of shots into
 * a single MP4, in the browser, via Mediabunny + WebCodecs.
 *
 * Why this exists
 * ───────────────
 * Today's "export" path goes through the server (ffmpeg). Round-trip
 * cost dominates user perception when they just want a quick draft.
 * Mediabunny lets us decode each shot's video, re-encode the frames
 * into a single H.264/AAC MP4 entirely on the user's machine — using
 * hardware-accelerated VideoEncoder/VideoDecoder when available.
 *
 * Browser support
 * ───────────────
 * Hard requirement: WebCodecs (`VideoEncoder` / `AudioEncoder` globals).
 * In practice that's Chromium ≥ 94 (Chrome / Edge / Brave) — Safari
 * has partial support, Firefox lacks the encoder side. Callers should
 * pre-flight via `isExportSupported()` and steer the user toward a
 * supported browser before showing progress.
 *
 * Scope (v2, what changed since v1)
 * ─────────────────────────────────
 * - v2: each shot is clipped to its `duration` (the timeline-set
 *   length). Reading the entire source video and advancing the global
 *   offset by the source's intrinsic length was the v1 bug behind the
 *   "last shot is too long" symptom.
 * - v2: audio is now muxed in. Per-shot audio track is decoded,
 *   timestamp-rebased to the global timeline, and re-encoded as AAC
 *   alongside the video. Audio is normalised to stereo / 48 kHz so
 *   shots with mismatched sample rates don't trip the encoder.
 * - Still v2: shots without a `videoUrl` are skipped. Static-image
 *   shots aren't rendered as held frames yet — that's a deferred
 *   feature that will need its own canvas-source pipeline.
 * - Still v2: H.264 / AAC fixed; runs on the main thread.
 */

import {
  ALL_FORMATS,
  AudioSampleSink,
  AudioSampleSource,
  BufferTarget,
  Input,
  type InputAudioTrack,
  type InputVideoTrack,
  Mp4OutputFormat,
  Output,
  QUALITY_MEDIUM,
  UrlSource,
  VideoSampleSink,
  VideoSampleSource,
} from "mediabunny";

export interface ExportableShot {
  id: string;
  videoUrl?: string;
  /** Timeline-set playback length, in seconds. When provided and
   *  shorter than the source video, the source is clipped. When
   *  longer, the export falls back to the source's natural length —
   *  we don't yet freeze-frame to extend a clip. */
  duration?: number;
}

export interface TimelineExportIssue {
  /** Original timeline position, so repeated shot IDs remain distinguishable. */
  index: number;
  shotId: string;
  reason:
    | "missing_video"
    | "no_video_track"
    | "probe_failed"
    | "encoding_failed"
    | "no_frames"
    | "cancelled";
}

export interface TimelineExportReport {
  requestedShots: number;
  /** Completed encoding without error; not a guarantee of source quality. */
  completedShots: number;
  partial: boolean;
  issues: TimelineExportIssue[];
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
  /** Audio bitrate in bits/s. Defaults to 128 kbps stereo AAC, which
   * is plenty for dialogue + music draft exports. */
  audioBitrate?: number;
  /** 0..1 progress callback. Fires after each shot is processed.
   * Observer failures are isolated from encoding. */
  onProgress?: (ratio: number) => void;
  /** Emitted only after a usable output is finalized. Observer failures are isolated. */
  onReport?: (report: TimelineExportReport) => void;
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

export class TimelineExportUnsupportedError extends TimelineExportError {
  constructor(message: string) {
    super(message);
    this.name = "TimelineExportUnsupportedError";
  }
}

/**
 * Cheap synchronous check for whether this browser can run the
 * export. Encoders are the long pole: Firefox ships VideoDecoder but
 * not VideoEncoder, and Safari's coverage is uneven by version.
 *
 * Callers should run this BEFORE spinning up the export UI so the
 * user gets steered toward Chrome/Edge instead of watching a
 * progress bar fail.
 */
export function isExportSupported(): boolean {
  if (typeof globalThis === "undefined") return false;
  return "VideoEncoder" in globalThis && "AudioEncoder" in globalThis;
}

interface ProbedShot {
  index: number;
  shot: ExportableShot;
  input: Input;
  videoTrack: InputVideoTrack;
  audioTrack: InputAudioTrack | null;
  /** Effective playback length on the global timeline (seconds).
   *  `min(shot.duration, sourceDuration)` — see ExportableShot.duration. */
  effectiveDuration: number;
}

/**
 * Concatenate the listed shots (in order) into a single MP4 Blob.
 *
 * Throws:
 *  - {@link TimelineExportUnsupportedError} if WebCodecs encoders are
 *    unavailable in this browser.
 *  - {@link TimelineExportError} for setup-phase failures (no
 *    eligible shots, all shots failed to open, etc.).
 *
 * Once encoding has started, errors from a single shot are logged
 * and that shot is skipped — partial output is preferred over
 * throwing away the user's already-completed encode work, UNLESS no
 * shot ever produced a frame, in which case we throw to avoid
 * shipping an empty MP4.
 */
export async function exportTimelineToMp4(
  shots: ExportableShot[],
  options: TimelineExportOptions = {}
): Promise<Blob> {
  if (!isExportSupported()) {
    throw new TimelineExportUnsupportedError(
      "This browser doesn't support WebCodecs video export. Please use the latest Chrome or Edge."
    );
  }

  options.signal?.throwIfAborted();
  const issues: TimelineExportIssue[] = [];
  const eligible = shots.flatMap((shot, index) => {
    if (shot.videoUrl) return [{ shot, index }];
    issues.push({ index, shotId: shot.id, reason: "missing_video" });
    return [];
  });
  let completedShots = 0;
  if (eligible.length === 0) {
    throw new TimelineExportError("Timeline has no shots with a video URL to export.");
  }

  // Phase 1: open every input and probe its tracks + duration. Done
  // upfront because we need to know whether ANY shot has audio
  // before we addAudioTrack() — Output requires all tracks declared
  // before start(). This also lets us compute each shot's effective
  // duration once and reuse it for both video and audio bounds.
  const probed: ProbedShot[] = [];
  let firstProbeError: unknown = null;
  const inputs = new Set<Input>();
  let pendingOutput: Output | null = null;
  const releaseInput = (input: Input) => {
    if (!inputs.delete(input)) return;
    try {
      input.dispose();
    } catch (error) {
      console.warn("[timeline-export] input cleanup failed:", error);
    }
  };
  const onAbort = () => {
    for (const input of inputs) releaseInput(input);
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    await Promise.all(
      eligible.map(async ({ shot, index }) => {
        let input: Input | null = null;
        try {
          options.signal?.throwIfAborted();
          input = new Input({ source: new UrlSource(shot.videoUrl!), formats: ALL_FORMATS });
          inputs.add(input);
          const videoTrack = await input.getPrimaryVideoTrack();
          options.signal?.throwIfAborted();
          if (!videoTrack) {
            issues.push({ index, shotId: shot.id, reason: "no_video_track" });
            console.warn(`[timeline-export] shot ${shot.id}: no primary video track, skipping`);
            releaseInput(input);
            return;
          }
          const audioTrack = await input.getPrimaryAudioTrack();
          options.signal?.throwIfAborted();
          const sourceDuration = await input.computeDuration([videoTrack]);
          options.signal?.throwIfAborted();
          const requested = shot.duration && shot.duration > 0 ? shot.duration : sourceDuration;
          // Clip request down to source length — we can't synthesise
          // extra frames yet. Going the other way (request shorter
          // than source) is the common case and works naturally via
          // the bounded `samples(0, end)` iterator below.
          const effectiveDuration = Math.min(requested, sourceDuration);
          probed.push({ index, shot, input, videoTrack, audioTrack, effectiveDuration });
        } catch (error) {
          issues.push({ index, shotId: shot.id, reason: "probe_failed" });
          console.error(`[timeline-export] shot ${shot.id} probe failed:`, error);
          if (firstProbeError == null) firstProbeError = error;
          if (input) releaseInput(input);
        }
      })
    );

    options.signal?.throwIfAborted();
    // Probe results may be out of order due to concurrent fetches —
    // restore the user's original shot ordering before encoding.
    probed.sort((a, b) => a.index - b.index);

    if (probed.length === 0) {
      const detail =
        firstProbeError instanceof Error
          ? firstProbeError.message
          : firstProbeError != null
            ? String(firstProbeError)
            : "no per-shot error captured";
      throw new TimelineExportError(
        `Couldn't open any of the timeline's video sources (likely CORS or unsupported format). First failure: ${detail}`,
        firstProbeError ?? undefined
      );
    }

    const hasAnyAudio = probed.some((p) => p.audioTrack !== null);

    // Phase 2: build the output and its tracks. Tracks must be
    // declared before output.start().
    const output = new Output({
      format: new Mp4OutputFormat(),
      target: new BufferTarget(),
    });

    pendingOutput = output;
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

    // Only add an audio track if at least one shot has audio; an
    // empty AAC track would either fail to mux or produce a "silent
    // track with no samples" that confuses some players.
    let audioSource: AudioSampleSource | null = null;
    if (hasAnyAudio) {
      audioSource = new AudioSampleSource({
        codec: "aac",
        bitrate: options.audioBitrate ?? 128_000,
        // Normalise every input to stereo / 48 kHz before encode.
        // Without this, a shot recorded at 44.1 kHz mono followed by
        // a 48 kHz stereo shot would trip the AAC encoder on config
        // change. This is the audio analogue of `sizeChangeBehavior:
        // "contain"` on the video side.
        transform: {
          numberOfChannels: 2,
          sampleRate: 48000,
        },
      });
      output.addAudioTrack(audioSource);
    }

    await output.start();

    // Phase 3: encode each shot. Per-shot we run video and audio in
    // parallel — they're independent sample streams, and serialising
    // them would unnecessarily double wall time. Backpressure is
    // already handled inside each `await source.add(sample)`.
    let timelineOffsetSeconds = 0;
    let processedShots = 0;
    let totalFramesEncoded = 0;
    let firstShotError: unknown = null;

    for (const { index, shot, input, videoTrack, audioTrack, effectiveDuration } of probed) {
      if (options.signal?.aborted) {
        // Caller cancelled — finalise what we already encoded so the
        // user at least gets a valid (truncated) MP4.
        break;
      }

      const offset = timelineOffsetSeconds;
      let shotFramesEncoded = 0;
      let shotAudioSamplesEncoded = 0;

      try {
        const encodeVideo = async () => {
          const sink = new VideoSampleSink(videoTrack);
          for await (const sample of sink.samples(0, effectiveDuration)) {
            if (options.signal?.aborted) {
              sample.close();
              break;
            }
            try {
              sample.setTimestamp(sample.timestamp + offset);
              await videoSource.add(sample);
              shotFramesEncoded += 1;
            } finally {
              sample.close();
            }
          }
        };

        const encodeAudio = async () => {
          if (!audioSource || !audioTrack) return;
          const sink = new AudioSampleSink(audioTrack);
          for await (const sample of sink.samples(0, effectiveDuration)) {
            if (options.signal?.aborted) {
              sample.close();
              break;
            }
            try {
              sample.setTimestamp(sample.timestamp + offset);
              await audioSource.add(sample);
              shotAudioSamplesEncoded += 1;
            } finally {
              sample.close();
            }
          }
        };

        const encoded = await Promise.allSettled([encodeVideo(), encodeAudio()]);
        const failure = encoded.find((result) => result.status === "rejected");
        if (failure?.status === "rejected") throw failure.reason;

        if (options.signal?.aborted) {
          issues.push({ index, shotId: shot.id, reason: "cancelled" });
        } else if (shotFramesEncoded === 0) {
          issues.push({ index, shotId: shot.id, reason: "no_frames" });
        } else {
          completedShots += 1;
        }
        console.info(
          `[timeline-export] shot ${shot.id}: ${shotFramesEncoded} frames, ${effectiveDuration.toFixed(2)}s` +
            (audioTrack ? " (+audio)" : "")
        );
      } catch (error) {
        // Per-shot failure: log + continue. Surfacing this as a thrown
        // error would discard the user's already-encoded earlier shots.
        // The "no frames at all" guard after the loop catches the
        // pathological case where every shot failed.
        issues.push({ index, shotId: shot.id, reason: "encoding_failed" });
        console.error(`[timeline-export] shot ${shot.id} failed:`, error);
        if (firstShotError == null) firstShotError = error;
      } finally {
        // Encoders cannot roll back already accepted samples after a later failure.
        // Retain those frames and reserve the slot before encoding the next shot.
        totalFramesEncoded += shotFramesEncoded;
        if (shotFramesEncoded > 0 || shotAudioSamplesEncoded > 0) {
          timelineOffsetSeconds += effectiveDuration;
        }
        releaseInput(input);
      }

      processedShots += 1;
      try {
        options.onProgress?.(processedShots / probed.length);
      } catch (error) {
        console.warn("[timeline-export] progress observer failed:", error);
      }
    }

    if (totalFramesEncoded === 0) {
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
    pendingOutput = null;

    const buffer = (output.target as BufferTarget).buffer;
    if (!buffer) {
      throw new TimelineExportError("Output finalised without producing a buffer.");
    }

    if (options.signal?.aborted) {
      for (const { index, shot } of probed.slice(processedShots)) {
        issues.push({ index, shotId: shot.id, reason: "cancelled" });
      }
    }
    const blob = new Blob([buffer], { type: "video/mp4" });
    try {
      options.onReport?.({
        requestedShots: shots.length,
        completedShots,
        partial: issues.length > 0 || Boolean(options.signal?.aborted),
        issues: issues.sort((a, b) => a.index - b.index),
      });
    } catch (error) {
      console.warn("[timeline-export] report observer failed:", error);
    }
    return blob;
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    for (const input of inputs) releaseInput(input);
    if (pendingOutput) {
      try {
        await pendingOutput.cancel();
      } catch (error) {
        console.warn("[timeline-export] output cleanup failed:", error);
      }
    }
  }
}

/**
 * Sugar: kick off a download in the user's browser. Caller owns the
 * timing — call after `exportTimelineToMp4` resolves.
 */
export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  let link: HTMLAnchorElement | undefined;
  try {
    link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
  } finally {
    link?.remove();
    // Preserve delayed revocation, including failures after URL allocation.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
