/**
 * Direct-to-storage media upload (SAS signed-URL pipeline) — studio port of
 * apps/web/src/lib/media-upload.ts, adapted to the studio api auth (satoken
 * cookie in prod, `NEXT_PUBLIC_DEV_SATOKEN` Bearer in local dev).
 *
 * Three steps, stateless + confirm:
 *   1. `POST /aurora/media/upload-url` — stateless; server decides the
 *      permanent object key and returns a signed write URL (no row minted).
 *   2. PUT the bytes straight to storage (XHR for upload progress; echo the
 *      signed headers verbatim — Azure needs `x-ms-blob-type`).
 *   3. `POST /aurora/media/confirm` — only after the PUT lands 2xx; the server
 *      HEAD-verifies and mints the active MediaAsset, returning `{id, url}`.
 */

const UPLOAD_URL_ENDPOINT = "/aurora/media/upload-url";
const CONFIRM_ENDPOINT = "/aurora/media/confirm";

const DEV_TOKEN = process.env.NEXT_PUBLIC_DEV_SATOKEN;

function jsonHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "accept-language": "en-US",
    ...(DEV_TOKEN ? { Authorization: `Bearer ${DEV_TOKEN}` } : {}),
  };
}

interface SignedUrlResponse {
  uploadUrl: string;
  method: "PUT";
  headers: Record<string, string>;
  storageKey: string;
  provider: "azure_blob" | "aliyun_oss" | "s3_compatible";
  expiresAt: string;
}

interface ConfirmResponse {
  mediaAssetId: string;
  storageKey: string;
  provider: "azure_blob" | "aliyun_oss" | "s3_compatible";
  url: string;
}

export interface UploadFileOptions {
  /** Closed media upload kind (apps/server media/dto UploadKindSchema). */
  kind: string;
  contentType?: string;
  /** Called with 0–100 as the PUT streams bytes. */
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

export interface UploadFileResult {
  mediaAssetId: string;
  storageKey: string;
  url: string;
}

async function postJson<T extends object>(
  endpoint: string,
  body: unknown,
  label: string,
  signal?: AbortSignal
): Promise<T> {
  const res = await fetch(endpoint, {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders(),
    body: JSON.stringify(body),
    signal,
  });
  let json: Partial<T> & { message?: string; msg?: string; data?: T } = {};
  try {
    json = await res.json();
  } catch {
    /* non-JSON body — fall through to the HTTP-status error */
  }
  if (!res.ok) {
    throw new Error(json.message || json.msg || `${label} failed: HTTP ${res.status}`);
  }
  // The server may wrap in a { code, data } envelope.
  return (json.data ?? json) as T;
}

function putBytesToStorage(
  info: SignedUrlResponse,
  file: File,
  options?: { onProgress?: (percent: number) => void; signal?: AbortSignal }
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(info.method ?? "PUT", info.uploadUrl, true);

    const headers: Record<string, string> = {
      "Content-Type": file.type || "application/octet-stream",
      ...(info.headers ?? {}),
    };
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);

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
    const cleanup = () => signal?.removeEventListener("abort", onAbort);

    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      const body = xhr.responseText || "";
      const code = /<Code>([^<]+)<\/Code>/i.exec(body)?.[1];
      const message = /<Message>([^<]+)<\/Message>/i.exec(body)?.[1];
      const detail = [code, message].filter(Boolean).join(": ");
      reject(new Error(detail ? `Upload failed: ${detail}` : `Upload failed: HTTP ${xhr.status}`));
    };
    xhr.onerror = () => {
      cleanup();
      reject(new Error("Upload blocked — network or CORS error"));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new DOMException("Upload aborted", "AbortError"));
    };

    xhr.send(file);
  });
}

/** Whether an error was a user-initiated cancel (suppress the error toast). */
export function isUploadAbort(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}

/** Upload a file straight to storage and return the confirmed MediaAsset. */
export async function uploadFileViaSignedUrl(
  file: File,
  opts: UploadFileOptions
): Promise<UploadFileResult> {
  const contentType = opts.contentType || file.type || "application/octet-stream";
  const info = await postJson<SignedUrlResponse>(
    UPLOAD_URL_ENDPOINT,
    { kind: opts.kind, contentType, fileName: file.name, sizeBytes: file.size },
    "getUploadUrl",
    opts.signal
  );
  if (!info.uploadUrl || !info.storageKey) {
    throw new Error("getUploadUrl succeeded but returned no upload URL");
  }
  await putBytesToStorage(info, file, { onProgress: opts.onProgress, signal: opts.signal });
  const confirmed = await postJson<ConfirmResponse>(
    CONFIRM_ENDPOINT,
    { storageKey: info.storageKey, kind: opts.kind, contentType },
    "confirmUpload",
    opts.signal
  );
  if (!confirmed.mediaAssetId || !confirmed.url) {
    throw new Error("confirmUpload succeeded but returned no mediaAssetId/url");
  }
  return {
    mediaAssetId: confirmed.mediaAssetId,
    storageKey: info.storageKey,
    url: confirmed.url,
  };
}
