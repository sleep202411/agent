/**
 * Multipart upload for AI content-review masters (up to 500 MB).
 *
 * Reuses `/aurora/media/episode-uploads` with kind `content_review_video`.
 * Parts go straight to storage; the Next/Java proxies never see the bytes.
 */

import { type EpisodeUploadResult, type EpisodeUploadSession } from "@repo/shared";
import { MAX_REVIEW_VIDEO_BYTES, isVideoFileAllowed } from "./content-review-api";

const ENDPOINT = "/aurora/media/episode-uploads";
const CONCURRENCY = 3;
const RETRIES = 3;
const KIND = "content_review_video";

interface Checkpoint {
  id: string;
  expiresAt: number;
  hashes: Record<string, string>;
}

export interface ContentReviewUploadOptions {
  workspaceId: string;
  signal: AbortSignal;
  onProgress?: (percent: number) => void;
}

class UploadError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

function retryable(error: unknown) {
  return (
    error instanceof UploadError &&
    ([0, 408, 409, 429].includes(error.status) || error.status >= 500)
  );
}

function contentTypeForFile(file: File): string {
  const type = file.type.toLowerCase();
  if (type === "video/mp4" || type === "video/quicktime") return type;
  return file.name.toLowerCase().endsWith(".mov") ? "video/quicktime" : "video/mp4";
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

function unwrap<T>(json: unknown): T {
  if (json && typeof json === "object" && "data" in json) {
    const data = (json as { data?: unknown }).data;
    if (data && typeof data === "object") return data as T;
  }
  return json as T;
}

async function request<T>(
  path: string,
  method: string,
  signal: AbortSignal,
  workspaceId: string,
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
        "accept-language": document.documentElement.lang || "en-US",
        "x-fizz-workspace-id": workspaceId,
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    if (response.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("fizz:unauthorized"));
    }
    if (response.status === 204) return undefined as T;
    const json: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const body = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
      const nested =
        body.message && typeof body.message === "object"
          ? (body.message as Record<string, unknown>)
          : null;
      throw new UploadError(
        String(
          nested?.message || nested?.msg || body.message || body.msg || `HTTP ${response.status}`
        ),
        response.status
      );
    }
    return unwrap<T>(json);
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof UploadError) throw error;
    throw new UploadError(
      timeout.signal.aborted ? "Upload request timed out" : "Upload connection failed",
      0
    );
  } finally {
    clearTimeout(timer);
  }
}

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
      const xml = new DOMParser().parseFromString(xhr.responseText, "application/xml");
      const message =
        xml.querySelector("Message")?.textContent ||
        `Video part upload failed (HTTP ${xhr.status})`;
      done(new UploadError(message, xhr.status === 403 ? 408 : xhr.status));
    };
    xhr.onerror = () =>
      done(new UploadError("Video upload connection failed. Check the network and retry.", 0));
    xhr.ontimeout = () => done(new UploadError("Video part upload timed out", 408));
    xhr.onabort = () => done(signal.reason ?? new DOMException("Upload aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    xhr.send(part);
  });
}

async function hash(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const memoryCheckpoints = new Map<string, Checkpoint>();

async function checkpointKey(file: File, workspaceId: string) {
  const identity = JSON.stringify([
    KIND,
    workspaceId,
    file.name,
    file.size,
    file.type,
    file.lastModified,
  ]);
  return `fizz:content-review-upload:${await hash(new Blob([identity]))}`;
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

export async function uploadContentReviewVideo(
  file: File,
  options: ContentReviewUploadOptions
): Promise<EpisodeUploadResult & { url: string }> {
  if (!isVideoFileAllowed(file) || file.size <= 0 || file.size > MAX_REVIEW_VIDEO_BYTES) {
    throw new UploadError("Select an MP4 or MOV video up to 500 MB", 400);
  }
  const contentType = contentTypeForFile(file);
  const { onProgress, workspaceId } = options;
  const controller = new AbortController();
  const signal = AbortSignal.any([options.signal, controller.signal]);
  const key = await checkpointKey(file, workspaceId);
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
        request<EpisodeUploadSession>("", "POST", signal, workspaceId, {
          id: checkpoint.id,
          fileName: file.name,
          contentType,
          sizeBytes: file.size,
          kind: KIND,
        }),
      signal
    );
  let session: EpisodeUploadSession;
  try {
    session = await start();
  } catch (error) {
    if (!(error instanceof UploadError && [404, 410].includes(error.status))) throw error;
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
    throw new UploadError("Invalid video upload session", 400);
  }
  checkpoint.expiresAt = Date.parse(session.expiresAt);
  saveCheckpoint(key, checkpoint);
  if (
    !Number.isSafeInteger(session.partSize) ||
    session.partSize <= 0 ||
    session.partSize > 64 * 1024 ** 2 ||
    session.sizeBytes !== file.size
  ) {
    throw new UploadError("Invalid video upload session", 400);
  }
  const count = Math.ceil(file.size / session.partSize);
  const stored = new Map(session.parts.map((part) => [part.number, part.sizeBytes]));
  const loaded = new Map<number, number>();
  const report = () =>
    onProgress?.(
      Math.floor((Array.from(loaded.values()).reduce((a, b) => a + b, 0) / file.size) * 100)
    );
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
          400
        );
      }
      const verified = checkpoint.hashes[number] === digest;
      if (session.uploaded && !verified) {
        throw new UploadError(
          "Cannot verify the original video. Remove it and select the file again.",
          400
        );
      }
      checkpoint.hashes[number] = digest;
      saveCheckpoint(key, checkpoint);
      if (!session.uploaded && !(verified && stored.get(number) === part.size)) {
        await retry(async () => {
          loaded.set(number, 0);
          report();
          const signed = await request<{ url: string; headers: Record<string, string> }>(
            `/${session.id}/parts/${number}`,
            "POST",
            signal,
            workspaceId
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
  const result = await retry(
    () => request<EpisodeUploadResult>(`/${session.id}/complete`, "POST", signal, workspaceId),
    signal
  );
  if (!result?.url) throw new UploadError("Upload succeeded but returned no video URL", 500);
  forgetCheckpoint(key);
  return { ...result, url: result.url };
}
