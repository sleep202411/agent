import { spawn } from "node:child_process";
import { open, readFile, rename, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { RunnerError } from "./errors";

export type SupportedImageFormat = "png" | "jpg" | "webp";

const MIME_BY_FORMAT: Record<SupportedImageFormat, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};

export interface StoredImage {
  path: string;
  sha256: string;
  bytes: number;
  mimeType: string;
  format: SupportedImageFormat;
}

export interface VerifiedImageMetadata {
  width: number;
  height: number;
  codec: string;
  pixelFormat: string | null;
}

export function detectImageFormat(bytes: Uint8Array): SupportedImageFormat | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpg";
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
    return "webp";
  }
  return null;
}

export function assertImageMimeAndMagic(
  firstBytes: Uint8Array,
  expectedFormat: SupportedImageFormat,
  responseContentType?: string | null
): string {
  const inspected = inspectImageMimeAndMagic(firstBytes, responseContentType);
  if (inspected.format !== expectedFormat) {
    throw new RunnerError(
      "OUTPUT_INVALID",
      `Generated file magic is ${inspected.format}; expected ${expectedFormat}.`
    );
  }
  return inspected.mimeType;
}

export function inspectImageMimeAndMagic(
  firstBytes: Uint8Array,
  responseContentType?: string | null
): { format: SupportedImageFormat; mimeType: string } {
  const detected = detectImageFormat(firstBytes);
  if (!detected) {
    throw new RunnerError("OUTPUT_INVALID", "Generated file has unknown image magic.");
  }

  const expectedMime = MIME_BY_FORMAT[detected];
  const normalizedMime = responseContentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (
    normalizedMime &&
    normalizedMime !== "application/octet-stream" &&
    normalizedMime !== expectedMime
  ) {
    throw new RunnerError(
      "OUTPUT_INVALID",
      `Generated response MIME is ${normalizedMime}; expected ${expectedMime}.`
    );
  }
  return { format: detected, mimeType: expectedMime };
}

export async function inspectLocalReferenceImage(
  absolutePath: string,
  maxBytes: number
): Promise<{ sha256: string; bytes: number; format: SupportedImageFormat; mimeType: string }> {
  const file = await stat(absolutePath);
  if (!file.isFile()) {
    throw new RunnerError("ASSET_INVALID", "Reference input is not a regular file.");
  }
  if (file.size <= 0 || file.size > maxBytes) {
    throw new RunnerError(
      "ASSET_INVALID",
      `Reference input size must be between 1 and ${maxBytes} bytes.`
    );
  }
  const contents = await readFile(absolutePath);
  const format = detectImageFormat(contents.subarray(0, 16));
  if (!format) {
    throw new RunnerError("ASSET_INVALID", "Reference input is not PNG, JPEG, or WebP.");
  }
  return {
    sha256: createHash("sha256").update(contents).digest("hex"),
    bytes: contents.byteLength,
    format,
    mimeType: MIME_BY_FORMAT[format],
  };
}

export async function referenceAsDataUrl(
  absolutePath: string,
  expected: { format: SupportedImageFormat; bytes: number; sha256: string },
  maxBytes: number
): Promise<string> {
  if (expected.bytes > maxBytes) {
    throw new RunnerError("ASSET_INVALID", "Reference input exceeds the request size limit.");
  }
  const contents = await readFile(absolutePath);
  if (contents.byteLength !== expected.bytes) {
    throw new RunnerError(
      "ASSET_INVALID",
      "Reference input changed after planning; run validate and plan again."
    );
  }
  const sha256 = createHash("sha256").update(contents).digest("hex");
  if (sha256 !== expected.sha256) {
    throw new RunnerError(
      "ASSET_INVALID",
      "Reference input content changed after planning; run validate and plan again."
    );
  }
  assertImageMimeAndMagic(
    contents.subarray(0, 16),
    expected.format,
    MIME_BY_FORMAT[expected.format]
  );
  return `data:${MIME_BY_FORMAT[expected.format]};base64,${contents.toString("base64")}`;
}

export async function writeBase64ImageAtomically(input: {
  base64: string;
  destinationPath: string;
  expectedFormat?: SupportedImageFormat;
  maxBytes: number;
}): Promise<StoredImage> {
  if (!isStrictBase64(input.base64)) {
    throw new RunnerError("OUTPUT_INVALID", "Seedream returned malformed base64 image data.");
  }
  const approximateBytes = Math.floor((input.base64.length * 3) / 4);
  if (approximateBytes > input.maxBytes) {
    throw new RunnerError("OUTPUT_INVALID", "Seedream base64 image exceeds the output size limit.");
  }
  const contents = Buffer.from(input.base64, "base64");
  if (contents.byteLength <= 0 || contents.byteLength > input.maxBytes) {
    throw new RunnerError("OUTPUT_INVALID", "Seedream base64 image has an invalid size.");
  }
  const inspected = inspectImageMimeAndMagic(contents.subarray(0, 16), null);
  if (input.expectedFormat && inspected.format !== input.expectedFormat) {
    throw new RunnerError(
      "OUTPUT_INVALID",
      `Generated file magic is ${inspected.format}; expected ${input.expectedFormat}.`
    );
  }
  await writeBufferAtomically(input.destinationPath, contents);
  return {
    path: input.destinationPath,
    sha256: createHash("sha256").update(contents).digest("hex"),
    bytes: contents.byteLength,
    mimeType: inspected.mimeType,
    format: inspected.format,
  };
}

export async function writeStreamToPartFile(input: {
  stream: ReadableStream<Uint8Array>;
  destinationPath: string;
  expectedFormat?: SupportedImageFormat;
  responseContentType: string | null;
  maxBytes: number;
}): Promise<StoredImage> {
  const partPath = `${input.destinationPath}.part`;
  await rm(partPath, { force: true });
  const handle = await open(partPath, "wx", 0o600);
  const hash = createHash("sha256");
  let bytes = 0;
  let firstBytes = Buffer.alloc(0);
  let closed = false;
  const reader = input.stream.getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = next.value;
      const buffer = Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > input.maxBytes) {
        throw new RunnerError("DOWNLOAD_FAILED", "Provider output exceeds the size limit.");
      }
      if (firstBytes.byteLength < 16) {
        firstBytes = Buffer.concat([firstBytes, buffer.subarray(0, 16 - firstBytes.byteLength)]);
      }
      hash.update(buffer);
      await handle.write(buffer);
    }
    if (bytes <= 0) throw new RunnerError("DOWNLOAD_FAILED", "Provider output was empty.");
    const inspected = inspectImageMimeAndMagic(firstBytes, input.responseContentType);
    if (input.expectedFormat && inspected.format !== input.expectedFormat) {
      throw new RunnerError(
        "OUTPUT_INVALID",
        `Generated file magic is ${inspected.format}; expected ${input.expectedFormat}.`
      );
    }
    await handle.sync();
    await handle.close();
    closed = true;
    await failIfDestinationExists(input.destinationPath);
    await rename(partPath, input.destinationPath);
    return {
      path: input.destinationPath,
      sha256: hash.digest("hex"),
      bytes,
      mimeType: inspected.mimeType,
      format: inspected.format,
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

export async function verifyImageDimensions(
  filePath: string,
  expected: { width: number; height: number },
  ffprobePath = process.env.FFPROBE_PATH?.trim() || "ffprobe"
): Promise<VerifiedImageMetadata> {
  const output = await runFfprobe(ffprobePath, filePath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new RunnerError("OUTPUT_INVALID", "ffprobe returned invalid JSON for generated image.");
  }
  const stream = firstVideoStream(parsed);
  if (!stream)
    throw new RunnerError("OUTPUT_INVALID", "Generated image has no decodable video stream.");
  if (stream.width !== expected.width || stream.height !== expected.height) {
    throw new RunnerError(
      "OUTPUT_INVALID",
      `Generated dimensions are ${stream.width}x${stream.height}; expected ${expected.width}x${expected.height}.`
    );
  }
  return {
    width: stream.width,
    height: stream.height,
    codec: stream.codec_name,
    pixelFormat: stream.pix_fmt,
  };
}

async function writeBufferAtomically(destinationPath: string, contents: Buffer): Promise<void> {
  const partPath = `${destinationPath}.part`;
  await rm(partPath, { force: true });
  const handle = await open(partPath, "wx", 0o600);
  try {
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close();
    await failIfDestinationExists(destinationPath);
    await rename(partPath, destinationPath);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(partPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function failIfDestinationExists(destinationPath: string): Promise<void> {
  try {
    await stat(destinationPath);
    throw new RunnerError(
      "JOURNAL_CONFLICT",
      "A staged artifact already exists for this fingerprint; refusing to overwrite it."
    );
  } catch (error) {
    if (isMissingFile(error)) return;
    throw error;
  }
}

async function runFfprobe(executable: string, filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      executable,
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,codec_name,pix_fmt",
        "-of",
        "json",
        filePath,
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 1_000_000) child.kill("SIGKILL");
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (stderr.length > 32_000) child.kill("SIGKILL");
    });
    child.once("error", () => {
      clearTimeout(timer);
      reject(new RunnerError("OUTPUT_INVALID", "ffprobe is unavailable."));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new RunnerError("OUTPUT_INVALID", "ffprobe could not decode the generated image.", {
            exitCode: code ?? -1,
          })
        );
        return;
      }
      resolve(stdout);
    });
  });
}

function firstVideoStream(value: unknown): {
  width: number;
  height: number;
  codec_name: string;
  pix_fmt: string | null;
} | null {
  if (!value || typeof value !== "object") return null;
  const streams = (value as { streams?: unknown }).streams;
  if (!Array.isArray(streams) || !streams[0] || typeof streams[0] !== "object") return null;
  const stream = streams[0] as Record<string, unknown>;
  if (
    typeof stream.width !== "number" ||
    typeof stream.height !== "number" ||
    typeof stream.codec_name !== "string"
  ) {
    return null;
  }
  return {
    width: stream.width,
    height: stream.height,
    codec_name: stream.codec_name,
    pix_fmt: typeof stream.pix_fmt === "string" ? stream.pix_fmt : null,
  };
}

function isStrictBase64(value: string): boolean {
  return (
    value.length > 0 &&
    value.length % 4 === 0 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  );
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
