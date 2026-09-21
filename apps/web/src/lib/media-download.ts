/**
 * Reliable browser download for cross-origin media URLs.
 *
 * A bare `<a href={remoteUrl} download>` does NOT force a download when the
 * URL is cross-origin (the `download` attribute is ignored unless the response
 * carries `Content-Disposition: attachment`), so OSS/CDN media navigates the
 * tab instead of saving. Fetching the bytes and handing the browser a
 * same-origin blob URL restores the attribute's meaning. Callers surface
 * failures themselves — this helper only reports success/failure.
 */

const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/flac": "flac",
  "audio/ogg": "ogg",
};

const MAX_FILENAME_LENGTH = 120;

export interface DownloadMediaOptions {
  /** Explicit download filename; extension is filled from mimeType when absent. */
  filename?: string;
  signal?: AbortSignal;
}

/**
 * Derives a filesystem-safe filename. Precedence: explicit name → URL path
 * basename → "download". Missing extensions are filled from the mimeType when
 * known. Returns a bare name, never a path.
 */
export function inferDownloadFilename(
  url: string,
  mimeType?: string | null,
  explicitName?: string
): string {
  const extension = extensionFor(mimeType);
  const candidates = [
    typeof explicitName === "string" ? explicitName : "",
    urlBasename(url),
    "download",
  ];
  const base = candidates.find((candidate) => candidate.trim().length > 0) ?? "download";
  return sanitizeFilename(base, extension);
}

/**
 * Downloads `url` as a file. Returns true when the browser accepted the
 * blob download, false when the fetch failed (network error, non-2xx, CORS).
 */
export async function downloadMediaFile(
  url: string,
  { filename, signal }: DownloadMediaOptions = {}
): Promise<boolean> {
  try {
    signal?.throwIfAborted();
    const response = await fetch(url, { signal });
    if (!response.ok) {
      try {
        await response.body?.cancel();
      } catch {
        // Cleanup failure must not change the caller's download-failure result.
      }
      return false;
    }
    const blob = await response.blob();
    signal?.throwIfAborted();
    const contentType = blob.type || response.headers.get("content-type");
    const name = inferDownloadFilename(url, contentType, filename);
    triggerBlobDownload(blob, name);
    return true;
  } catch (error) {
    if (signal?.aborted) throw error;
    return false;
  }
}

/** Saves an already-in-memory blob (same pattern as the timeline exporter). */
export function triggerBlobDownload(blob: Blob, filename: string): void {
  const downloadUrl = URL.createObjectURL(blob);
  let anchor: HTMLAnchorElement | undefined;
  try {
    anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor?.remove();
    // Delayed revoke: Safari can cancel the save if the URL dies too early.
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
  }
}

function urlBasename(url: string): string {
  try {
    const pathname = new URL(url, "https://example.invalid").pathname;
    const segment = pathname.split("/").filter(Boolean).pop();
    if (!segment) return "";
    // Only trust the segment when it already carries an extension.
    return /\.[a-z0-9]{1,10}$/i.test(segment) ? segment : "";
  } catch {
    return "";
  }
}

function extensionFor(mimeType?: string | null): string | undefined {
  if (!mimeType) return undefined;
  return MIME_EXTENSIONS[mimeType.split(";", 1)[0]?.trim().toLowerCase()];
}

function sanitizeFilename(raw: string, extension?: string): string {
  const cleaned = raw
    // Strip path separators and control characters.
    .replace(/[/\\]/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    // Windows forbids trailing dots/spaces; leading dots hide files on unix.
    .replace(/^[\s.]+/, "")
    .replace(/[\s.]+$/, "")
    .trim();
  if (!cleaned) {
    return extension ? `download.${extension}` : "download";
  }
  const explicitExt = /\.([a-z0-9]{1,10})$/i.exec(cleaned)?.[0] ?? "";
  const finalExt = explicitExt || (extension ? `.${extension}` : "");
  const stem = explicitExt ? cleaned.slice(0, cleaned.length - explicitExt.length) : cleaned;
  const maxStemLength = MAX_FILENAME_LENGTH - finalExt.length;
  const trimmedStem = stem.length > maxStemLength ? stem.slice(0, maxStemLength).trimEnd() : stem;
  return `${trimmedStem || "download"}${finalExt}`;
}
