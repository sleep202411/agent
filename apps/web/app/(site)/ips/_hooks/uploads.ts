/**
 * IP-feature-private file uploads — semantic helpers.
 *
 * Each public export names *what* the caller is uploading (an episode
 * video, an episode cover, an IP banner …), never *how*. The wire
 * detail (which backend endpoint, what body shape) is encapsulated inside
 * this file.
 *
 * The pipeline is DIRECT-TO-STORAGE, stateless + confirm:
 *   1. request a signed write URL from the Nest server
 *      (`POST /aurora/media/upload-url`) — STATELESS, no DB row yet;
 *   2. PUT the bytes straight to the storage provider (Azure Blob intl /
 *      Alibaba OSS cn) — the bytes never stream through our server;
 *   3. confirm the landed upload (`POST /aurora/media/confirm`), which is
 *      when the server verifies the bytes (ownership + HEAD) and mints the
 *      MediaAsset, returning its id.
 *
 * The provider is abstracted server-side and selected by region — this
 * client is provider-agnostic: it PUTs with whatever `{url, method,
 * headers}` the server returns.
 *
 * The episode save then references `mediaAssetId` (returned by confirm),
 * never a raw key. An abandoned/cancelled upload (steps 1–2 without 3)
 * leaves NO server-side row — there is nothing to clean up.
 */

import { acceptLanguage, bearerHeader } from "./shared";

/** Upload kinds the server's closed enum accepts (apps/server media/dto). */
type UploadKind = "episode_video" | "episode_cover" | "ip_banner";

interface UploadUrlRequest {
  kind: UploadKind;
  contentType: string;
  fileName: string;
  sizeBytes: number;
  scope?: {
    projectId?: string | number;
    episodeId?: string | number;
  };
}

interface SignedUrlResponse {
  /** Fully-signed write URL to PUT bytes to. */
  uploadUrl: string;
  method: "PUT";
  /** Headers the browser MUST echo on the PUT (Azure: x-ms-blob-type). */
  headers: Record<string, string>;
  /**
   * Server-decided PERMANENT object key. We echo this verbatim to
   * `/confirm` after the PUT — it is NOT a DB id (issuing a URL creates no
   * row). We derive nothing from `uploadUrl`.
   */
  storageKey: string;
  provider: "azure_blob" | "aliyun_oss" | "s3_compatible";
  /** ISO timestamp the URL stops working. */
  expiresAt: string;
}

interface ConfirmResponse {
  /** Active MediaAsset row the server minted — returned to the save call. */
  mediaAssetId: string;
  storageKey: string;
  provider: "azure_blob" | "aliyun_oss" | "s3_compatible";
}

export interface UploadedAsset {
  /**
   * MediaAsset id — this is what the save call sends to the backend (NOT a
   * raw storage key). Returned by `/confirm` once the server has verified
   * the bytes physically landed.
   */
  mediaAssetId: string;
  /** Authoritative storage key (audit / debugging only — save uses the id). */
  path: string;
  name: string;
  size: number;
  mimeType: string;
}

/** Optional knobs for live progress + cancellation. */
export interface UploadOptions {
  /** Called with 0–100 as the PUT streams bytes (only when total is known). */
  onProgress?: (percent: number) => void;
  /** Abort the in-flight PUT (and the URL request). */
  signal?: AbortSignal;
}

// ─── Internal helpers ──────────────────────────────────

const UPLOAD_URL_ENDPOINT = "/aurora/media/upload-url";
const CONFIRM_ENDPOINT = "/aurora/media/confirm";

async function requestSignedUrl(
  request: UploadUrlRequest,
  signal?: AbortSignal
): Promise<SignedUrlResponse> {
  const res = await fetch(UPLOAD_URL_ENDPOINT, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "accept-language": acceptLanguage(),
      Authorization: bearerHeader(),
    },
    body: JSON.stringify(request),
    signal,
  });

  // Parse the body once; the server returns the contract on 200 and a
  // `{code, message}` envelope on error (matches the catch/toast path).
  let json: Partial<SignedUrlResponse> & {
    code?: number | string;
    message?: string;
    msg?: string;
  } = {};
  try {
    json = await res.json();
  } catch {
    /* non-JSON body — fall through to the HTTP-status error */
  }

  if (!res.ok) {
    const message = json.message || json.msg;
    throw new Error(message ? message : `getUploadUrl failed: HTTP ${res.status}`);
  }
  if (!json.uploadUrl || !json.storageKey) {
    throw new Error("getUploadUrl succeeded but returned no upload URL");
  }
  return json as SignedUrlResponse;
}

/**
 * Confirm a landed upload. The server verifies the bytes (ownership +
 * HEAD), mints the active MediaAsset, and returns its id. We send back the
 * EXACT storageKey the issue step gave us, plus the kind (re-asserts the
 * ownership scope) and contentType (advisory — server reads the real type
 * from storage).
 */
async function confirmUpload(
  storageKey: string,
  kind: UploadKind,
  contentType: string,
  signal?: AbortSignal
): Promise<ConfirmResponse> {
  const res = await fetch(CONFIRM_ENDPOINT, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "accept-language": acceptLanguage(),
      Authorization: bearerHeader(),
    },
    body: JSON.stringify({ storageKey, kind, contentType }),
    signal,
  });

  let json: Partial<ConfirmResponse> & {
    code?: number | string;
    message?: string;
    msg?: string;
  } = {};
  try {
    json = await res.json();
  } catch {
    /* non-JSON body — fall through to the HTTP-status error */
  }

  if (!res.ok) {
    const message = json.message || json.msg;
    throw new Error(message ? message : `confirmUpload failed: HTTP ${res.status}`);
  }
  if (!json.mediaAssetId) {
    throw new Error("confirmUpload succeeded but returned no mediaAssetId");
  }
  return json as ConfirmResponse;
}

/**
 * PUT the bytes straight to the storage provider, with real upload
 * progress and abort support. Uses XMLHttpRequest because fetch has no
 * upload-progress events.
 */
function putBytesToStorage(
  info: SignedUrlResponse,
  file: File,
  options?: UploadOptions
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(info.method ?? "PUT", info.uploadUrl, true);

    // Echo the signed headers exactly. Content-Type is part of the
    // signature on both providers, so it MUST match what the server signed
    // — the server returns it inside `headers`, so default it from the
    // file only if (defensively) absent.
    const headers: Record<string, string> = {
      "Content-Type": file.type || "application/octet-stream",
      ...(info.headers ?? {}),
    };
    for (const [k, v] of Object.entries(headers)) {
      xhr.setRequestHeader(k, v);
    }

    if (options?.onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) {
          options.onProgress!(Math.round((e.loaded / e.total) * 100));
        }
      };
    }

    // User-initiated abort resolves cleanly into a rejection the caller
    // recognizes (cancel != error toast — see episode-dialog).
    const signal = options?.signal;
    const onAbort = () => xhr.abort();
    if (signal) {
      if (signal.aborted) {
        reject(new DOMException("Upload aborted", "AbortError"));
        return;
      }
      signal.addEventListener("abort", onAbort);
    }
    const cleanup = () => {
      if (signal) signal.removeEventListener("abort", onAbort);
    };

    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        // Read the provider's XML error body so the toast says something
        // more useful than "HTTP 403" (SignatureDoesNotMatch vs
        // RequestTimeTooSkewed vs AccessDenied).
        const bodyText = xhr.responseText || "";
        console.error(
          `[uploads] storage PUT ${xhr.status} ${xhr.statusText}\nURL: ${info.uploadUrl}\nBody:\n${bodyText}`
        );
        reject(
          new Error(
            bodyText
              ? `Upload failed: HTTP ${xhr.status} — ${extractStorageErrorMessage(bodyText, xhr.status)}`
              : `Upload failed: HTTP ${xhr.status}`
          )
        );
      }
    };
    xhr.onerror = () => {
      cleanup();
      // No HTTP status here usually means a blocked CORS preflight/PUT.
      reject(new Error("Upload blocked — network or CORS error"));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new DOMException("Upload aborted", "AbortError"));
    };

    xhr.send(file);
  });
}

/**
 * Pull the human-meaningful pieces out of the provider's error XML (both
 * Azure Blob and OSS return `<Code>` / `<Message>`). Falls back to the raw
 * body when the XML doesn't parse.
 */
function extractStorageErrorMessage(xml: string, status: number): string {
  const code = /<Code>([^<]+)<\/Code>/i.exec(xml)?.[1];
  const message = /<Message>([^<]+)<\/Message>/i.exec(xml)?.[1];
  if (code && message) return `${code}: ${message}`;
  if (code) return code;
  if (message) return message;
  return `HTTP ${status}`;
}

/**
 * Whether an error was a user-initiated cancel (vs a real failure). Call
 * sites use this to suppress the error toast on cancel.
 */
export function isUploadAbort(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}

function composeResult(file: File, storageKey: string, confirmed: ConfirmResponse): UploadedAsset {
  return {
    mediaAssetId: confirmed.mediaAssetId,
    path: storageKey,
    name: file.name,
    size: file.size,
    mimeType: file.type,
  };
}

/**
 * The shared issue → PUT → confirm sequence behind every public uploader.
 * The only per-uploader variance is the `kind` + scope, which the caller
 * bakes into `request`.
 */
async function runUpload(
  file: File,
  request: UploadUrlRequest,
  options?: UploadOptions
): Promise<UploadedAsset> {
  const info = await requestSignedUrl(request, options?.signal);
  await putBytesToStorage(info, file, options);
  const confirmed = await confirmUpload(
    info.storageKey,
    request.kind,
    request.contentType,
    options?.signal
  );
  return composeResult(file, info.storageKey, confirmed);
}

// ─── Public uploaders ──────────────────────────────────
//
// All three go through the one provider-agnostic Nest endpoint. The only
// per-uploader difference is the `kind` (which drives the server's
// content-type allowlist, byte cap, and storage key prefix) and the scope
// linkage carried for audit.

interface UploadEpisodeVideoInput {
  /** Project this episode belongs to. */
  projectId: number | string;
  /** Existing episode/video id when re-uploading; omit on first upload. */
  videoId?: number | string;
}

/** Episode source video. */
export async function uploadEpisodeVideo(
  file: File,
  input: UploadEpisodeVideoInput,
  options?: UploadOptions
): Promise<UploadedAsset> {
  return runUpload(
    file,
    {
      kind: "episode_video",
      contentType: file.type || "application/octet-stream",
      fileName: file.name,
      sizeBytes: file.size,
      scope: { projectId: input.projectId, episodeId: input.videoId },
    },
    options
  );
}

interface UploadEpisodeCoverInput {
  /** Project this episode belongs to. */
  projectId: number | string;
  /** Episode/video id when re-uploading an existing episode's cover. */
  videoId?: number | string;
}

/** Episode cover image. */
export async function uploadEpisodeCover(
  file: File,
  input: UploadEpisodeCoverInput,
  options?: UploadOptions
): Promise<UploadedAsset> {
  return runUpload(
    file,
    {
      kind: "episode_cover",
      contentType: file.type || "application/octet-stream",
      fileName: file.name,
      sizeBytes: file.size,
      scope: { projectId: input.projectId, episodeId: input.videoId },
    },
    options
  );
}

interface UploadIPBannerInput {
  projectId?: number | string;
  videoId?: number | string;
}

/**
 * IP-level banner (cover image used on the plaza card and detail hero).
 * Persisted via the project-update endpoint after this helper returns.
 */
export async function uploadIPBanner(
  file: File,
  input?: UploadIPBannerInput,
  options?: UploadOptions
): Promise<UploadedAsset> {
  return runUpload(
    file,
    {
      kind: "ip_banner",
      contentType: file.type || "application/octet-stream",
      fileName: file.name,
      sizeBytes: file.size,
      scope: { projectId: input?.projectId, episodeId: input?.videoId },
    },
    options
  );
}
