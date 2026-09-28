import {
  EPISODE_SOURCE_MAX_BYTES,
  type EpisodeUploadResult,
  type EpisodeUploadSession,
} from "@repo/shared";
import { defaultLocale } from "@/src/i18n/config";

const ENDPOINT = "/aurora/media/episode-uploads";
const CONCURRENCY = 3;
const RETRIES = 3;

export type EpisodeUploadStage = "uploading" | "confirming";
interface Checkpoint {
  id: string;
  expiresAt: number;
  hashes: Record<string, string>;
}
interface UploadOptions {
  scopeKey: string;
  signal: AbortSignal;
  onProgress?: (percent: number) => void;
  onStage?: (stage: EpisodeUploadStage) => void;
}

class UploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly translationKey?: string
  ) {
    super(message);
  }
}

export function episodeUploadErrorKey(error: unknown): string | undefined {
  return error instanceof UploadError ? error.translationKey : undefined;
}

function retryable(error: unknown) {
  return (
    error instanceof UploadError &&
    ([0, 408, 409, 429].includes(error.status) || error.status >= 500)
  );
}

async function retry<T>(action: () => Promise<T>, signal: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try {
      return await action();
    } catch (error) {
      signal.throwIfAborted();
      if (attempt >= RETRIES || !retryable(error)) throw error;
      await new Promise<void>((resolve, reject) => {
        const aborted = () => {
          clearTimeout(timer);
          reject(signal.reason);
        };
        const timer = setTimeout(
          () => {
            signal.removeEventListener("abort", aborted);
            resolve();
          },
          1000 * 2 ** attempt
        );
        signal.addEventListener("abort", aborted, { once: true });
      });
    }
  }
}

async function request<T>(
  path: string,
  method: string,
  signal: AbortSignal,
  data?: unknown
): Promise<T> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 180_000);
  try {
    const response = await fetch(`${ENDPOINT}${path}`, {
      method,
      credentials: "include",
      signal: AbortSignal.any([signal, timeout.signal]),
      headers: {
        "Content-Type": "application/json",
        "accept-language": document.documentElement.lang || defaultLocale,
        Authorization: `Bearer ${document.cookie.match(/(?:^|;\s*)satoken=([^;]+)/)?.[1] ?? ""}`,
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    if (response.status === 204) return undefined as T;
    const body: unknown = await response.json().catch((error: unknown) => {
      // Proxies may return HTML or an empty body for an HTTP rejection.
      // Keep its status; malformed successful responses and read failures
      // still follow the existing connection-error handling below.
      if (response.ok || !(error instanceof SyntaxError)) throw error;
      return null;
    });
    if (!response.ok) {
      const details = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
      throw new UploadError(
        String(details.message || details.msg || `HTTP ${response.status}`),
        response.status
      );
    }
    return body as T;
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof UploadError) throw error;
    throw new UploadError(
      timeout.signal.aborted ? "Upload request timed out" : "Upload connection failed",
      0,
      timeout.signal.aborted ? "epUploadTimeout" : "epUploadNetworkError"
    );
  } finally {
    clearTimeout(timer);
  }
}

/** XHR provides byte progress without buffering the file in browser memory. */
function putPart(
  part: Blob,
  signed: { url: string; headers: Record<string, string> },
  signal: AbortSignal,
  progress: (bytes: number) => void
) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const done = (error?: unknown) => {
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    };
    xhr.open("PUT", signed.url, true);
    xhr.timeout = 15 * 60_000;
    for (const [name, value] of Object.entries(signed.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => progress(Math.min(part.size, event.loaded));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        progress(part.size);
        done();
        return;
      }
      // Keep actionable provider errors; never log signed URLs or credentials.
      const xml = new DOMParser().parseFromString(xhr.responseText, "application/xml");
      const message =
        xml.querySelector("Message")?.textContent ||
        `Video part upload failed (HTTP ${xhr.status})`;
      // A stale signature gets a fresh signed URL on retry.
      done(new UploadError(message, xhr.status === 403 ? 408 : xhr.status));
    };
    xhr.onerror = () =>
      done(
        new UploadError(
          "Video upload connection failed. Check the network and retry.",
          0,
          "epUploadNetworkError"
        )
      );
    xhr.ontimeout = () =>
      done(new UploadError("Video part upload timed out", 408, "epUploadTimeout"));
    xhr.onabort = () => done(signal.reason ?? new DOMException("Upload paused", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    xhr.send(part);
  });
}

async function hash(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const memoryCheckpoints = new Map<string, Checkpoint>();
async function checkpointKey(file: File, scopeKey: string) {
  const identity = JSON.stringify([scopeKey, file.name, file.size, file.type, file.lastModified]);
  return `fizz:episode-upload:${await hash(new Blob([identity]))}`;
}

function readCheckpoint(key: string): Checkpoint | undefined {
  const memory = memoryCheckpoints.get(key);
  if (memory && memory.expiresAt > Date.now()) return memory;
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "null") as Checkpoint | null;
    if (
      saved &&
      typeof saved.id === "string" &&
      saved.expiresAt > Date.now() &&
      saved.hashes &&
      typeof saved.hashes === "object"
    )
      return saved;
  } catch {
    /* Storage may be disabled; in-page retry still works. */
  }
  return undefined;
}

function saveCheckpoint(key: string, checkpoint: Checkpoint) {
  memoryCheckpoints.set(key, checkpoint);
  try {
    localStorage.setItem(key, JSON.stringify(checkpoint));
  } catch {
    /* In-memory progress remains usable. */
  }
}

function forgetCheckpoint(key: string) {
  memoryCheckpoints.delete(key);
  try {
    localStorage.removeItem(key);
  } catch {
    /* Optional persistence. */
  }
}

export async function cancelEpisodeUpload(file: File, scopeKey: string) {
  const key = await checkpointKey(file, scopeKey);
  const checkpoint = readCheckpoint(key);
  if (!checkpoint) return;
  const signal = new AbortController().signal;
  await retry(() => request(`/${checkpoint.id}`, "DELETE", signal), signal);
  forgetCheckpoint(key);
}

export async function uploadEpisodeVideo(
  file: File,
  options: UploadOptions
): Promise<EpisodeUploadResult> {
  if (file.size <= 0 || file.size > EPISODE_SOURCE_MAX_BYTES)
    throw new UploadError(
      "Episode video must be between 1 byte and 35 GB",
      400,
      "epUploadInvalidSize"
    );
  if (!["video/mp4", "video/webm", "video/quicktime"].includes(file.type))
    throw new UploadError("Select an MP4, WebM or MOV video", 400, "epUploadInvalidType");
  const { onProgress, onStage } = options;
  const controller = new AbortController();
  const signal = AbortSignal.any([options.signal, controller.signal]);
  const key = await checkpointKey(file, options.scopeKey);
  signal.throwIfAborted();
  let checkpoint = readCheckpoint(key) ?? {
    id: crypto.randomUUID(),
    expiresAt: Date.now() + 7 * 86400_000,
    hashes: {},
  };
  saveCheckpoint(key, checkpoint);
  const start = () =>
    retry(
      () =>
        request<EpisodeUploadSession>("", "POST", signal, {
          id: checkpoint.id,
          fileName: file.name,
          contentType: file.type,
          sizeBytes: file.size,
        }),
      signal
    );
  let session: EpisodeUploadSession;
  try {
    session = await start();
  } catch (error) {
    if (!(error instanceof UploadError && [404, 410].includes(error.status))) throw error;
    // An expired session (or a different signed-in owner) cannot be reused.
    checkpoint = { id: crypto.randomUUID(), expiresAt: Date.now() + 7 * 86400_000, hashes: {} };
    saveCheckpoint(key, checkpoint);
    session = await start();
  }
  if (
    session.id !== checkpoint.id ||
    !Array.isArray(session.parts) ||
    typeof session.uploaded !== "boolean" ||
    !Number.isFinite(Date.parse(session.expiresAt))
  ) {
    throw new UploadError("Invalid video upload session", 400, "epUploadInvalidSession");
  }
  checkpoint.expiresAt = Date.parse(session.expiresAt);
  saveCheckpoint(key, checkpoint);
  if (
    !Number.isSafeInteger(session.partSize) ||
    session.partSize <= 0 ||
    session.partSize > 64 * 1024 ** 2 ||
    session.sizeBytes !== file.size
  ) {
    throw new UploadError("Invalid video upload session", 400, "epUploadInvalidSession");
  }
  const count = Math.ceil(file.size / session.partSize);
  const stored = new Map(session.parts.map((part) => [part.number, part.sizeBytes]));
  const loaded = new Map<number, number>();
  const report = () =>
    onProgress?.(
      Math.floor((Array.from(loaded.values()).reduce((a, b) => a + b, 0) / file.size) * 100)
    );
  onStage?.("uploading");
  let next = 1;
  const worker = async () => {
    while (next <= count) {
      const number = next++;
      signal.throwIfAborted();
      const part = file.slice(
        (number - 1) * session.partSize,
        Math.min(number * session.partSize, file.size)
      );
      const digest = await hash(part);
      signal.throwIfAborted();
      if (checkpoint.hashes[number] && checkpoint.hashes[number] !== digest) {
        throw new UploadError(
          "This file differs from the original upload. Select the original file to resume.",
          400,
          "epUploadFileChanged"
        );
      }
      const verified = checkpoint.hashes[number] === digest;
      if (session.uploaded && !verified)
        throw new UploadError(
          "Cannot verify the original video. Remove it and select the file again.",
          400,
          "epUploadUnverifiedFile"
        );
      checkpoint.hashes[number] = digest;
      saveCheckpoint(key, checkpoint);
      if (!session.uploaded && !(verified && stored.get(number) === part.size)) {
        await retry(async () => {
          loaded.set(number, 0);
          report();
          const signed = await request<{ url: string; headers: Record<string, string> }>(
            `/${session.id}/parts/${number}`,
            "POST",
            signal
          );
          await putPart(part, signed, signal, (bytes) => {
            loaded.set(number, bytes);
            report();
          });
        }, signal);
      }
      loaded.set(number, part.size);
      report();
    }
  };
  // Wait for siblings to settle after failure; no hidden uploads keep running
  // behind the retry button or continue writing after the user removes a file.
  let failure: unknown;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, count) }, async () => {
      try {
        await worker();
      } catch (error) {
        failure ??= error;
        controller.abort(error);
      }
    })
  );
  if (failure) throw failure;
  signal.throwIfAborted();
  onStage?.("confirming");
  return retry(
    () => request<EpisodeUploadResult>(`/${session.id}/complete`, "POST", signal),
    signal
  );
}
