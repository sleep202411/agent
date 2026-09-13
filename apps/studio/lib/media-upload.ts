/**
 * Direct-to-storage media upload (SAS signed-URL pipeline) — studio port of
 * apps/web/src/lib/media-upload.ts, adapted to the studio api auth (the
 * satoken cookie, set by the global login dialog).
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

function jsonHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "accept-language": "en-US",
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
  variantId: string | null;
  storageKey?: string;
  provider?: "azure_blob" | "aliyun_oss" | "s3_compatible";
  status?: string;
  url?: string;
}

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  txt: "text/plain",
  md: "text/markdown",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
};

export interface UploadFileOptions {
  /** Closed media upload kind (apps/server media/dto UploadKindSchema). */
  kind: string;
  contentType?: string;
  /** Called with 0–100 as the PUT streams bytes. */
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
  /** Direct workspace uploads; Story uploads derive ownership from their project. */
  workspaceId?: string;
  scope?: { storyProjectId: string };
}

export interface UploadFileResult {
  mediaAssetId: string;
  variantId: string;
  storageKey: string;
  url: string;
}

async function postJson<T extends object>(
  endpoint: string,
  body: unknown,
  label: string,
  signal?: AbortSignal,
  headers?: Record<string, string>
): Promise<T> {
  const res = await fetch(endpoint, {
    method: "POST",
    credentials: "include",
    headers: { ...jsonHeaders(), ...headers },
    body: JSON.stringify(body),
    signal,
  });
  let json: Partial<T> & {
    error?: string;
    message?: string | { message?: string; code?: string };
    msg?: string;
    data?: T;
  } = {};
  try {
    json = await res.json();
  } catch {
    /* non-JSON body — fall through to the HTTP-status error */
  }
  if (!res.ok) {
    throw new Error(errorMessageFromJson(json) || `${label} failed: HTTP ${res.status}`);
  }
  // The server may wrap in a { code, data } envelope.
  return (json.data ?? json) as T;
}

function errorMessageFromJson(json: {
  error?: string;
  message?: string | { message?: string; code?: string };
  msg?: string;
}): string | undefined {
  if (typeof json.message === "string") return json.message;
  if (json.message?.message) return json.message.message;
  if (typeof json.msg === "string") return json.msg;
  if (typeof json.error === "string") return json.error;
  return undefined;
}

function contentTypeForFile(file: File, explicit?: string): string {
  if (explicit) return explicit;
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension && CONTENT_TYPE_BY_EXTENSION[extension]) {
    return CONTENT_TYPE_BY_EXTENSION[extension];
  }
  return file.type || "application/octet-stream";
}

function putBytesToStorage(
  info: SignedUrlResponse,
  file: File,
  options: {
    contentType: string;
    onProgress?: (percent: number) => void;
    signal?: AbortSignal;
  }
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(info.method ?? "PUT", info.uploadUrl, true);

    // `file.type` is frequently empty for MOV files. Use the same canonical
    // type that was signed and will be echoed to confirm. Normalize names so a
    // provider-issued `content-type` overrides our default regardless of case,
    // and set every header once (XHR appends repeated header values).
    const headers = new Map<string, { name: string; value: string }>([
      ["content-type", { name: "Content-Type", value: options.contentType }],
    ]);
    for (const [name, value] of Object.entries(info.headers ?? {})) {
      headers.set(name.toLowerCase(), { name, value });
    }
    for (const { name, value } of headers.values()) xhr.setRequestHeader(name, value);

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
  if (opts.signal?.aborted) {
    throw new DOMException("Upload aborted", "AbortError");
  }
  const contentType = contentTypeForFile(file, opts.contentType);
  const scopedHeaders =
    !opts.scope?.storyProjectId && opts.workspaceId
      ? { "x-fizz-workspace-id": opts.workspaceId }
      : undefined;
  const info = await postJson<SignedUrlResponse>(
    UPLOAD_URL_ENDPOINT,
    {
      kind: opts.kind,
      contentType,
      fileName: file.name,
      sizeBytes: file.size,
      ...(opts.scope ? { scope: opts.scope } : {}),
    },
    "getUploadUrl",
    opts.signal,
    scopedHeaders
  );
  if (!info.uploadUrl || !info.storageKey) {
    throw new Error("getUploadUrl succeeded but returned no upload URL");
  }
  if (opts.signal?.aborted) {
    throw new DOMException("Upload aborted", "AbortError");
  }
  await putBytesToStorage(info, file, {
    contentType,
    onProgress: opts.onProgress,
    signal: opts.signal,
  });
  const confirmed = await postJson<ConfirmResponse>(
    CONFIRM_ENDPOINT,
    {
      storageKey: info.storageKey,
      ...(opts.scope ? { scope: opts.scope } : {}),
      kind: opts.kind,
      contentType,
    },
    "confirmUpload",
    opts.signal,
    scopedHeaders
  );
  if (!confirmed.mediaAssetId) {
    throw new Error("confirmUpload succeeded but returned no mediaAssetId");
  }
  if (!confirmed.url) {
    throw new Error("confirmUpload succeeded but returned no media URL");
  }
  if (!confirmed.variantId) {
    throw new Error("confirmUpload succeeded but returned no original media variant");
  }
  return {
    mediaAssetId: confirmed.mediaAssetId,
    variantId: confirmed.variantId,
    storageKey: info.storageKey,
    url: confirmed.url,
  };
}
