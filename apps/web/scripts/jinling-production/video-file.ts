import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, mkdir, open, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { RunnerError } from "./errors";
import { assertAllowedProviderOutputUrl } from "./secure-download";

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export type StoredVideo = {
  path: string;
  sha256: string;
  bytes: number;
  mimeType: "video/mp4";
  format: "mp4";
};

export type VerifiedVideo = {
  width: number;
  height: number;
  codec: string;
  pixelFormat: string | null;
  framesPerSecond: number;
  frameCount: number;
  durationSeconds: number;
  audioStreamCount: number;
};

export async function inspectLocalMp4(filePath: string, maxBytes: number): Promise<StoredVideo> {
  const metadata = await stat(filePath);
  if (!metadata.isFile() || metadata.size <= 0 || metadata.size > maxBytes) {
    throw new RunnerError(
      "OUTPUT_INVALID",
      "Local MP4 is empty, oversized, or not a regular file."
    );
  }
  const contents = await readFile(filePath);
  if (contents.byteLength < 12 || contents.toString("ascii", 4, 8) !== "ftyp") {
    throw new RunnerError("OUTPUT_INVALID", "Local file is not an MP4 container.");
  }
  return {
    path: filePath,
    sha256: createHash("sha256").update(contents).digest("hex"),
    bytes: contents.byteLength,
    mimeType: "video/mp4",
    format: "mp4",
  };
}

export async function deriveExactFrameMaster(input: {
  sourcePath: string;
  destinationPath: string;
  frameCount: number;
  audio?: boolean;
  ffmpegPath?: string;
}): Promise<void> {
  await mkdir(path.dirname(input.destinationPath), { recursive: true });
  await assertMissing(input.destinationPath);
  const audioArguments = input.audio ? ["-map", "0:a:0?", "-c:a", "copy"] : ["-an"];
  await runProcess(input.ffmpegPath ?? process.env.FFMPEG_PATH?.trim() ?? "ffmpeg", [
    "-v",
    "error",
    "-i",
    input.sourcePath,
    "-map",
    "0:v:0",
    "-c",
    "copy",
    ...audioArguments,
    "-frames:v",
    String(input.frameCount),
    "-movflags",
    "+faststart",
    input.destinationPath,
  ]);
}

export async function downloadProviderVideo(
  sourceUrl: string,
  options: { destinationPath: string; maxBytes: number; timeoutMs?: number; maxRedirects?: number }
): Promise<StoredVideo> {
  const deadline = Date.now() + (options.timeoutMs ?? 300_000);
  const maxRedirects = options.maxRedirects ?? 3;
  let current = assertAllowedProviderOutputUrl(sourceUrl);

  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new RunnerError("DOWNLOAD_FAILED", "Video download timed out.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    try {
      const response = await fetch(current, {
        redirect: "manual",
        headers: { Accept: "video/mp4,application/octet-stream" },
        signal: controller.signal,
      });
      if (REDIRECTS.has(response.status)) {
        if (redirects === maxRedirects) {
          throw new RunnerError("DOWNLOAD_FAILED", "Video download exceeded redirect limit.");
        }
        const location = response.headers.get("location");
        if (!location) throw new RunnerError("DOWNLOAD_FAILED", "Video redirect omitted Location.");
        await response.body?.cancel().catch(() => undefined);
        current = assertAllowedProviderOutputUrl(new URL(location, current).toString());
        continue;
      }
      if (!response.ok || !response.body) {
        throw new RunnerError("DOWNLOAD_FAILED", "Provider video URL returned no media.", {
          httpStatus: response.status,
        });
      }
      const declaredLength = Number(response.headers.get("content-length") ?? "0");
      if (Number.isFinite(declaredLength) && declaredLength > options.maxBytes) {
        throw new RunnerError("DOWNLOAD_FAILED", "Provider video exceeds the declared size limit.");
      }
      return await writeMp4Stream({
        stream: response.body,
        destinationPath: options.destinationPath,
        maxBytes: options.maxBytes,
        responseContentType: response.headers.get("content-type"),
      });
    } catch (error) {
      if (error instanceof RunnerError) throw error;
      throw new RunnerError("DOWNLOAD_FAILED", "Provider video download failed.");
    } finally {
      clearTimeout(timer);
    }
  }
  throw new RunnerError("DOWNLOAD_FAILED", "Provider video download did not resolve.");
}

export async function verifyVideoMaster(
  filePath: string,
  expected: {
    width: number;
    height: number;
    codec: "h264" | "h265";
    framesPerSecond: { numerator: number; denominator: number };
    frameCount: number;
    durationSeconds: number;
    audio: boolean;
  },
  tools: { ffprobe?: string; ffmpeg?: string } = {}
): Promise<VerifiedVideo> {
  const ffprobe = tools.ffprobe ?? process.env.FFPROBE_PATH?.trim() ?? "ffprobe";
  const ffmpeg = tools.ffmpeg ?? process.env.FFMPEG_PATH?.trim() ?? "ffmpeg";
  const raw = await runProcess(ffprobe, [
    "-v",
    "error",
    "-count_frames",
    "-show_entries",
    "stream=index,codec_type,codec_name,profile,pix_fmt,width,height,r_frame_rate,avg_frame_rate,start_time,nb_read_frames:format=duration",
    "-of",
    "json",
    filePath,
  ]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RunnerError("OUTPUT_INVALID", "ffprobe returned invalid video metadata.");
  }
  const record = parsed as { streams?: unknown; format?: { duration?: unknown } };
  const streams = Array.isArray(record.streams) ? record.streams : [];
  const video = streams.find((entry): entry is Record<string, unknown> =>
    Boolean(
      entry &&
      typeof entry === "object" &&
      (entry as { codec_type?: unknown }).codec_type === "video"
    )
  );
  const audioStreamCount = streams.filter(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      (entry as { codec_type?: unknown }).codec_type === "audio"
  ).length;
  if (!video) throw new RunnerError("OUTPUT_INVALID", "Generated MP4 has no video stream.");
  const width = numeric(video.width);
  const height = numeric(video.height);
  const frameCount = numeric(video.nb_read_frames);
  const durationSeconds = numeric(record.format?.duration);
  const framesPerSecond = parseRate(video.r_frame_rate);
  const averageFramesPerSecond = parseRate(video.avg_frame_rate);
  const startTimeSeconds = numeric(video.start_time);
  const codec = String(video.codec_name ?? "");
  const pixelFormat = typeof video.pix_fmt === "string" ? video.pix_fmt : null;
  const expectedCodec = expected.codec === "h265" ? "hevc" : "h264";
  const expectedFps = expected.framesPerSecond.numerator / expected.framesPerSecond.denominator;

  if (width !== expected.width || height !== expected.height) {
    throw new RunnerError(
      "OUTPUT_INVALID",
      `Generated video is ${width}x${height}; expected ${expected.width}x${expected.height}.`
    );
  }
  if (codec !== expectedCodec) {
    throw new RunnerError(
      "OUTPUT_INVALID",
      `Generated video codec is ${codec}; expected ${expectedCodec}.`
    );
  }
  if (Math.abs(framesPerSecond - expectedFps) > 0.01) {
    throw new RunnerError(
      "OUTPUT_INVALID",
      `Generated video is ${framesPerSecond}fps; expected ${expectedFps}fps.`
    );
  }
  if (Math.abs(averageFramesPerSecond - expectedFps) > 0.01) {
    throw new RunnerError(
      "OUTPUT_INVALID",
      `Generated average frame rate is ${averageFramesPerSecond}fps; expected ${expectedFps}fps.`
    );
  }
  if (Math.abs(startTimeSeconds) > 1 / expectedFps) {
    throw new RunnerError(
      "OUTPUT_INVALID",
      `Generated video starts at ${startTimeSeconds}s instead of frame zero.`
    );
  }
  if (pixelFormat !== "yuv420p") {
    throw new RunnerError(
      "OUTPUT_INVALID",
      `Generated video pixel format is ${pixelFormat ?? "unknown"}; expected web-safe yuv420p.`
    );
  }
  if (frameCount !== expected.frameCount) {
    throw new RunnerError(
      "OUTPUT_INVALID",
      `Generated video contains ${frameCount} decoded frames; expected ${expected.frameCount}.`
    );
  }
  if (Math.abs(durationSeconds - expected.durationSeconds) > 1 / expectedFps) {
    throw new RunnerError(
      "OUTPUT_INVALID",
      `Generated duration is ${durationSeconds}s; expected ${expected.durationSeconds}s.`
    );
  }
  if (Boolean(audioStreamCount) !== expected.audio) {
    throw new RunnerError(
      "OUTPUT_INVALID",
      expected.audio
        ? "Generated video is missing audio."
        : "Generated video contains forbidden audio."
    );
  }

  await runProcess(ffmpeg, ["-v", "error", "-i", filePath, "-map", "0:v:0", "-f", "null", "-"]);
  return {
    width,
    height,
    codec,
    pixelFormat,
    framesPerSecond,
    frameCount,
    durationSeconds,
    audioStreamCount,
  };
}

export async function writeMp4Stream(input: {
  stream: ReadableStream<Uint8Array>;
  destinationPath: string;
  maxBytes: number;
  responseContentType: string | null;
}): Promise<StoredVideo> {
  const normalizedMime = input.responseContentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (normalizedMime && !["video/mp4", "application/octet-stream"].includes(normalizedMime)) {
    throw new RunnerError(
      "OUTPUT_INVALID",
      `Generated video MIME is ${normalizedMime}; expected video/mp4.`
    );
  }
  await mkdir(path.dirname(input.destinationPath), { recursive: true });
  const partPath = `${input.destinationPath}.part`;
  await rm(partPath, { force: true });
  const handle = await open(partPath, "wx", 0o600);
  const reader = input.stream.getReader();
  const hash = createHash("sha256");
  let bytes = 0;
  let firstBytes = Buffer.alloc(0);
  let closed = false;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = Buffer.from(next.value);
      bytes += chunk.byteLength;
      if (bytes > input.maxBytes) {
        throw new RunnerError("DOWNLOAD_FAILED", "Provider video exceeds the size limit.");
      }
      if (firstBytes.byteLength < 32) {
        firstBytes = Buffer.concat([firstBytes, chunk.subarray(0, 32 - firstBytes.byteLength)]);
      }
      hash.update(chunk);
      await handle.write(chunk);
    }
    if (bytes <= 0 || firstBytes.byteLength < 12 || firstBytes.toString("ascii", 4, 8) !== "ftyp") {
      throw new RunnerError("OUTPUT_INVALID", "Generated file is not an MP4 container.");
    }
    await handle.sync();
    await handle.close();
    closed = true;
    await assertMissing(input.destinationPath);
    await rename(partPath, input.destinationPath);
    return {
      path: input.destinationPath,
      sha256: hash.digest("hex"),
      bytes,
      mimeType: "video/mp4",
      format: "mp4",
    };
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (!closed) await handle.close().catch(() => undefined);
    await rm(partPath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

async function assertMissing(filePath: string): Promise<void> {
  try {
    await stat(filePath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  throw new RunnerError("JOURNAL_CONFLICT", "Refusing to overwrite an existing staged video.");
}

function numeric(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed))
    throw new RunnerError("OUTPUT_INVALID", "Video metadata is incomplete.");
  return parsed;
}

function parseRate(value: unknown): number {
  const [numerator, denominator] = String(value ?? "")
    .split("/")
    .map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    throw new RunnerError("OUTPUT_INVALID", "Video frame rate is invalid.");
  }
  return numerator / denominator;
}

function runProcess(executable: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 300_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 2_000_000) child.kill("SIGKILL");
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (stderr.length > 64_000) child.kill("SIGKILL");
    });
    child.once("error", () => {
      clearTimeout(timer);
      reject(new RunnerError("OUTPUT_INVALID", `${path.basename(executable)} is unavailable.`));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new RunnerError("OUTPUT_INVALID", `${path.basename(executable)} rejected the video.`, {
            exitCode: code ?? -1,
            diagnosticLength: stderr.length,
          })
        );
        return;
      }
      resolve(stdout);
    });
  });
}
