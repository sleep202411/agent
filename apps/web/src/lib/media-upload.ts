/**
 * Direct-to-storage media upload — app-level transport infrastructure.
 *
 * This is the SAS (signed-URL) upload pipeline. Large files (episode
 * video up to 2GB, covers, banners …) MUST NOT stream through our own
 * server — nginx caps the proxied body and a multipart POST of a 2GB
 * file 413s before it ever reaches the app. Instead the bytes go
 * straight to the storage provider (Azure Blob intl / Alibaba OSS cn)
 * with a short-lived signed write URL the server mints on demand.
 *
 * Three steps, stateless + confirm:
 *   1. `POST /aurora/media/upload-url` — STATELESS. The server decides
 *      the permanent object key and returns a signed write URL. No
 *      MediaAsset row is created, so an abandoned / cancelled / re-picked
 *      upload leaves ZERO server-side residue.
 *   2. PUT the bytes straight to `uploadUrl` (echoing the server's
 *      `method` + `headers` verbatim — Azure needs `x-ms-blob-type`).
 *      Uses XMLHttpRequest because `fetch` has no upload-progress events.
 *   3. `POST /aurora/media/confirm` — only AFTER the PUT lands 2xx. The
 *      server HEAD-verifies the bytes, reads the real size / content-type
 *      from storage, and mints the active MediaAsset, returning its id.
 *
 * The caller then references the returned `mediaAssetId` — never a raw
 * storage key. This lives in `src/lib/` (not a feature folder) because
 * it is universal transport plumbing, exactly like the api client: it is
 * provider-agnostic, feature-agnostic, and carries no IP / episode shape.
 *
 * Auth / locale headers mirror the rest of the app: SaToken bearer (the
 * backend NPEs without an `Authorization` header even when empty) plus
 * `accept-language` for the i18n layer, with `credentials: "include"` so
 * the SaToken cookie rides along.
 */

import { defaultLocale, locales, type Locale } from "@/src/i18n/config";

// ─── Header helpers (mirror src/lib/api/api-client + ips/_hooks/shared) ──

function acceptLanguage(): Locale {
  if (typeof document !== "undefined") {
    const htmlLang = document.documentElement.lang;
    if (htmlLang && locales.includes(htmlLang as Locale)) {
      return htmlLang as Locale;
    }
  }
  return defaultLocale;
}

function bearerHeader(): string {
  if (typeof document === "undefined") return "Bearer ";
  const match = document.cookie.match(/(?:^|;\s*)satoken=([^;]+)/);
  return `Bearer ${match?.[1] ?? ""}`;
}

function jsonHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "accept-language": acceptLanguage(),
    Authorization: bearerHeader(),
  };
}

// ─── Wire types ─────────────────────────────────────

const UPLOAD_URL_ENDPOINT = "/aurora/media/upload-url";
const CONFIRM_ENDPOINT = "/aurora/media/confirm";

interface SignedUrlResponse {
  /** Fully-signed write URL to PUT bytes to. */
  uploadUrl: string;
  method: "PUT";
  /** Headers the browser MUST echo on the PUT (Azure: x-ms-blob-type). */
  headers: Record<string, string>;
  /**
   * Server-decided PERMANENT object key. Echoed verbatim to `/confirm`
   * after the PUT — it is NOT a DB id (issuing a URL creates no row).
   */
  storageKey: string;
  provider: "azure_blob" | "aliyun_oss" | "s3_compatible";
  /** ISO timestamp the URL stops working. */
  expiresAt: string;
}

interface ConfirmResponse {
  /** Active MediaAsset row the server minted — what the save call references. */
  mediaAssetId: string;
  storageKey: string;
  provider: "azure_blob" | "aliyun_oss" | "s3_compatible";
  url: string;
}

export interface UploadFileOptions {
  /** Closed media upload kind (apps/server media/dto UploadKindSchema). */
  kind: string;
  /** Override the declared mime (e.g. browser quirks like `audio/x-wav`
   *  normalized to the server allowlist's canonical type). Defaults to
   *  `file.type`. */
  contentType?: string;
  /** Called with 0–100 as the PUT streams bytes (only when total is known). */
  onProgress?: (percent: number) => void;
  /** Called whenever the durable upload pipeline moves to a new phase. */
  onStage?: (stage: UploadFileStage) => void;
  /**
   * Called after storage accepted every byte but before `/confirm` has
   * necessarily succeeded. Keeping this checkpoint lets a caller retry a
   * transient confirm failure without uploading the file again.
   */
  onCheckpoint?: (checkpoint: UploadFileCheckpoint) => void;
  /**
   * Resume from a checkpoint emitted by this helper. The storage key is
   * server-issued and scoped, so callers must keep the checkpoint attached to
   * the exact same upload job rather than accepting arbitrary user input.
   */
  resumeFrom?: UploadFileCheckpoint;
  /** Abort the in-flight PUT (and the surrounding requests). */
  signal?: AbortSignal;
  /** Feature-owned authorization scope echoed at issue + confirm. */
  scope?: { crewId?: string };
}

export type UploadFileStage = "signing" | "uploading" | "confirming";

export interface UploadFileCheckpoint {
  storageKey: string;
  kind: string;
  contentType: string;
  scope?: { crewId?: string };
}

export interface UploadFileResult {
  /** Active MediaAsset id — what the save call sends to the backend. */
  mediaAssetId: string;
  /** Authoritative storage key (audit / debugging only — save uses the id). */
  storageKey: string;
  /** Browser/provider-fetchable URL resolved by the server. */
  url: string;
}

// ─── Step 1: request a signed write URL (stateless) ──

async function requestSignedUrl(
  body: {
    kind: string;
    contentType: string;
    fileName: string;
    sizeBytes: number;
    scope?: { crewId?: string };
  },
  signal?: AbortSignal
): Promise<SignedUrlResponse> {
  const res = await fetch(UPLOAD_URL_ENDPOINT, {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders(),
    body: JSON.stringify(body),
    signal,
  });

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

// ─── Step 2: PUT bytes straight to storage (progress + abort) ──

function putBytesToStorage(
  info: SignedUrlResponse,
  file: File,
  options?: { onProgress?: (percent: number) => void; signal?: AbortSignal }
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(info.method ?? "PUT", info.uploadUrl, true);

    // Echo the signed headers exactly. Content-Type is part of the
    // signature on both providers, so it MUST match what the server
    // signed — default from the file only if (defensively) absent.
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
        // Surface the provider's XML error (SignatureDoesNotMatch /
        // RequestTimeTooSkewed / AccessDenied) instead of bare "HTTP 403".
        const bodyText = xhr.responseText || "";
        console.error(
          `[media-upload] storage PUT ${xhr.status} ${xhr.statusText}\nURL: ${info.uploadUrl}\nBody:\n${bodyText}`
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
      // No HTTP status here usually means a blocked CORS preflight / PUT.
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
 * Azure Blob and OSS return `<Code>` / `<Message>`). Falls back to the
 * raw body when the XML doesn't parse.
 */
function extractStorageErrorMessage(xml: string, status: number): string {
  const code = /<Code>([^<]+)<\/Code>/i.exec(xml)?.[1];
  const message = /<Message>([^<]+)<\/Message>/i.exec(xml)?.[1];
  if (code && message) return `${code}: ${message}`;
  if (code) return code;
  if (message) return message;
  return `HTTP ${status}`;
}

// ─── Step 3: confirm the landed upload (mints the MediaAsset) ──

async function confirmUpload(
  storageKey: string,
  kind: string,
  contentType: string,
  scope?: { crewId?: string },
  signal?: AbortSignal
): Promise<ConfirmResponse> {
  const res = await fetch(CONFIRM_ENDPOINT, {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders(),
    body: JSON.stringify({ storageKey, kind, contentType, scope }),
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
  if (!json.mediaAssetId || !json.url) {
    throw new Error("confirmUpload succeeded but returned no mediaAssetId/url");
  }
  return json as ConfirmResponse;
}

// ─── Public API ─────────────────────────────────────

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

/**
 * Upload a file straight to storage via the signed-URL pipeline and
 * return the confirmed MediaAsset id. The bytes never stream through our
 * server — that is the whole point (it sidesteps the nginx body cap that
 * 413s a 2GB multipart POST).
 *
 * `confirm` runs ONLY after the PUT resolves 2xx; an abort or a non-2xx
 * PUT rejects before confirm (so a half-landed blob never mints a row).
 */
export async function uploadFileViaSignedUrl(
  file: File,
  opts: UploadFileOptions
): Promise<UploadFileResult> {
  const contentType = opts.contentType || file.type || "application/octet-stream";
  const resume = opts.resumeFrom;
  const canResume =
    resume?.kind === opts.kind &&
    resume.contentType === contentType &&
    (resume.scope?.crewId ?? null) === (opts.scope?.crewId ?? null);

  let storageKey: string;
  if (canResume && resume) {
    storageKey = resume.storageKey;
    opts.onProgress?.(100);
  } else {
    opts.onStage?.("signing");
    const info = await requestSignedUrl(
      {
        kind: opts.kind,
        contentType,
        fileName: file.name,
        sizeBytes: file.size,
        scope: opts.scope,
      },
      opts.signal
    );
    opts.onStage?.("uploading");
    await putBytesToStorage(info, file, { onProgress: opts.onProgress, signal: opts.signal });
    storageKey = info.storageKey;
    opts.onCheckpoint?.({
      storageKey,
      kind: opts.kind,
      contentType,
      scope: opts.scope,
    });
  }

  opts.onStage?.("confirming");
  const confirmed = await confirmUpload(
    storageKey,
    opts.kind,
    contentType,
    opts.scope,
    opts.signal
  );
  return { mediaAssetId: confirmed.mediaAssetId, storageKey, url: confirmed.url };
}
