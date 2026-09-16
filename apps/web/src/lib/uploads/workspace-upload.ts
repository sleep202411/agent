import { backendApi } from "@/src/lib/api";
import { env } from "@/src/env";

const OSS_BASE = env.OSS_BASE_URL;

const IMAGE_MAX_SIZE = 10 * 1024 * 1024;
const VIDEO_MAX_SIZE = 100 * 1024 * 1024;
const AUDIO_MAX_SIZE = 20 * 1024 * 1024;
const DEFAULT_MAX_SIZE = 25 * 1024 * 1024;

export interface UploadUrlResponse {
  url?: string;
  headers?: Record<string, string>;
  method?: string;
  [key: string]: unknown;
}

export interface RequestWorkspaceUploadUrlOptions {
  signal?: AbortSignal;
  requestData?: Record<string, unknown>;
}

export interface UploadWorkspaceFileOptions {
  signal?: AbortSignal;
  uploadType: string;
  sourceType?: string;
  requestData?: Record<string, unknown>;
  fileName?: string;
  maxSize?: number;
  accept?: string | string[];
}

export interface UploadedWorkspaceFile {
  path: string;
  url: string;
  name: string;
  size: number;
  mimeType: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeAccept(accept?: string | string[]) {
  if (!accept) return [];
  if (Array.isArray(accept)) {
    return accept
      .flatMap((item) => item.split(","))
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
  }
  return accept
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function matchesAcceptRule(file: File, rule: string) {
  if (!rule) return true;

  if (rule.startsWith(".")) {
    return file.name.toLowerCase().endsWith(rule);
  }

  if (rule.endsWith("/*")) {
    const prefix = rule.slice(0, -1);
    return file.type.toLowerCase().startsWith(prefix);
  }

  return file.type.toLowerCase() === rule;
}

export function buildOssUrl(path?: string | null) {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("blob:")) {
    return path;
  }
  return `${OSS_BASE}/${path}`;
}

export interface OssImageOptions {
  /** Target width in pixels */
  width?: number;
  /** Target height in pixels */
  height?: number;
  /** Resize mode: fill (crop to fit), lfit (scale down to fit, default), mfit (scale to cover) */
  mode?: "fill" | "lfit" | "mfit";
  /** Image quality 1-100 (default: 80) */
  quality?: number;
  /** Output format */
  format?: "jpg" | "png" | "webp";
}

/**
 * Build an OSS image URL with optional image processing parameters.
 * Returns the original image URL when no options are provided.
 *
 * @example
 * // Thumbnail for list/card
 * buildOssImageUrl("uploads/img.jpg", { width: 300, height: 300, mode: "fill" })
 *
 * // Medium size for preview
 * buildOssImageUrl("uploads/img.jpg", { width: 1000 })
 *
 * // Original image (download/fullscreen)
 * buildOssImageUrl("uploads/img.jpg")
 */
export function buildOssImageUrl(path?: string | null, options?: OssImageOptions) {
  const baseUrl = buildOssUrl(path);
  if (!baseUrl || !options) return baseUrl;
  if (baseUrl.startsWith("blob:")) return baseUrl;

  const { width, height, mode, quality, format } = options;
  if (!width && !height) return baseUrl;

  const parts: string[] = ["image/resize"];
  if (width) parts.push(`w_${width}`);
  if (height) parts.push(`h_${height}`);
  if (mode) parts.push(`m_${mode}`);

  let process = parts.join(",");

  if (quality) {
    process += `/quality,q_${quality}`;
  }
  if (format) {
    process += `/format,${format}`;
  }

  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separator}x-oss-process=${process}`;
}

/**
 * Build an OSS video thumbnail URL using video snapshot.
 * Extracts a frame from the video at the given time offset.
 *
 * @example
 * buildOssVideoThumbnail("uploads/vid.mp4")               // first frame, 300px wide
 * buildOssVideoThumbnail("uploads/vid.mp4", { t: 1000 })  // frame at 1s
 */
export function buildOssVideoThumbnail(
  path?: string | null,
  options?: { t?: number; w?: number; h?: number; f?: "jpg" | "png" }
) {
  const baseUrl = buildOssUrl(path);
  if (!baseUrl) return "";
  if (baseUrl.startsWith("blob:")) return baseUrl;

  const t = options?.t ?? 0;
  const f = options?.f ?? "jpg";
  const parts = [`video/snapshot,t_${t},f_${f}`];
  if (options?.w) parts.push(`w_${options.w}`);
  if (options?.h) parts.push(`h_${options.h}`);

  const process = parts.join(",");
  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separator}x-oss-process=${process}`;
}

export function getDefaultUploadMaxSize(uploadType: string, file?: File) {
  const normalizedType = uploadType.toUpperCase();
  if (normalizedType.includes("VIDEO") || file?.type.startsWith("video/")) {
    return VIDEO_MAX_SIZE;
  }
  if (
    normalizedType.includes("AUDIO") ||
    normalizedType.includes("VOICE") ||
    file?.type.startsWith("audio/")
  ) {
    return AUDIO_MAX_SIZE;
  }
  if (
    normalizedType.includes("IMAGE") ||
    normalizedType === "PROJECT" ||
    normalizedType === "WORLD" ||
    file?.type.startsWith("image/")
  ) {
    return IMAGE_MAX_SIZE;
  }
  return DEFAULT_MAX_SIZE;
}

export function validateWorkspaceUploadFile(file: File, options: UploadWorkspaceFileOptions) {
  const rules = normalizeAccept(options.accept);
  if (rules.length > 0 && !rules.some((rule) => matchesAcceptRule(file, rule))) {
    return "unsupportedFileType";
  }

  const maxSize = options.maxSize ?? getDefaultUploadMaxSize(options.uploadType, file);
  if (file.size > maxSize) {
    return "fileSizeExceedMb";
  }

  return null;
}

export function extractStoragePathFromSignedUrl(signedUrl: string) {
  const url = new URL(signedUrl);
  return url.pathname.replace(/^\//, "");
}

export async function requestWorkspaceUploadUrl(
  fileName: string,
  uploadType: string,
  options?: RequestWorkspaceUploadUrlOptions
) {
  return backendApi.post<UploadUrlResponse>("/api/user/file/getUploadUrl", {
    signal: options?.signal,
    data: {
      fileName,
      uploadType,
      ...(options?.requestData ?? {}),
    },
  });
}

export async function uploadFileToSignedUrl(
  signedUrl: string,
  file: File,
  options?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal }
) {
  options?.signal?.throwIfAborted();
  const response = await fetch(signedUrl, {
    signal: options?.signal,
    method: options?.method ?? "PUT",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      ...(options?.headers ?? {}),
    },
    body: file,
  });

  options?.signal?.throwIfAborted();
  if (!response.ok) {
    throw new Error("Upload failed");
  }

  return extractStoragePathFromSignedUrl(signedUrl);
}

export class DuplicateFileError extends Error {
  constructor(fileName: string) {
    super(`duplicateFile:${fileName}`);
    this.name = "DuplicateFileError";
  }
}

export async function computeFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Direct chat-attachment upload — bypasses OSS entirely.
 *
 * Posts the raw file body to Nest's `/aurora/assistant/upload-attachment`
 * via multipart/form-data. Nest extracts the text in-process and caches
 * it in Redis under `attachment:{ref}` so subsequent submit-message-to-
 * agent calls can read the full text directly without ever touching
 * OSS. Returns the same shape as the legacy `uploadWorkspaceFile` so
 * call sites can swap with no further changes.
 *
 * Why split this off: chat attachments care about *text*, not durable
 * storage; routing them through OSS introduced a class of "PUT signed
 * to bucket A, GET attempted on bucket B" failures that broke chat
 * end-to-end every time the env / signer / bucket config drifted.
 */
export interface ChatAttachmentUploadOptions {
  signal?: AbortSignal;
  maxSize?: number;
  accept?: string | string[];
}

export interface UploadedChatAttachment {
  /** Server text-cache handle (`att_xxx`) — the only thing the chat
   *  message needs to embed for the agent to consume the file. */
  ref: string;
  name: string;
  size: number;
  mimeType: string;
  /** Total characters extracted server-side. */
  chars: number;
  /** Short preview of the extracted text for the file card UI. */
  excerpt?: string;
}

/** Must not exceed the Nest FileInterceptor cap on
 *  `/aurora/assistant/upload-attachment` (25 MB) — a larger client
 *  limit just converts the validation error into an opaque 413. */
export const CHAT_ATTACHMENT_MAX_SIZE = 25 * 1024 * 1024;

export async function uploadChatAttachment(
  file: File,
  options: ChatAttachmentUploadOptions = {}
): Promise<UploadedChatAttachment> {
  options.signal?.throwIfAborted();
  const rules = normalizeAccept(options.accept);
  if (rules.length > 0 && !rules.some((rule) => matchesAcceptRule(file, rule))) {
    throw new Error("unsupportedFileType");
  }
  const maxSize = Math.min(options.maxSize ?? CHAT_ATTACHMENT_MAX_SIZE, CHAT_ATTACHMENT_MAX_SIZE);
  if (file.size > maxSize) {
    throw new Error("fileSizeExceedMb");
  }

  const form = new FormData();
  form.append("file", file, file.name);

  const res = await fetch("/aurora/assistant/upload-attachment", {
    signal: options.signal,
    method: "POST",
    credentials: "include",
    body: form,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) msg = body.message;
    } catch {
      /* ignore */
    }
    options.signal?.throwIfAborted();
    throw new Error(msg);
  }
  const body = (await res.json()) as {
    ref: string;
    filename: string;
    mimeType: string;
    size: number;
    chars: number;
    excerpt?: string;
  };
  options.signal?.throwIfAborted();
  return {
    ref: body.ref,
    name: body.filename,
    size: body.size,
    mimeType: body.mimeType,
    chars: body.chars,
    excerpt: body.excerpt,
  };
}

export async function uploadWorkspaceFile(file: File, options: UploadWorkspaceFileOptions) {
  options.signal?.throwIfAborted();
  const validationError = validateWorkspaceUploadFile(file, options);
  if (validationError) {
    throw new Error(validationError);
  }

  const requestData = { ...(options.requestData ?? {}) };
  if (options.sourceType) {
    const currentExtraParam = isRecord(requestData.extraParam) ? requestData.extraParam : {};
    requestData.extraParam = {
      ...currentExtraParam,
      sourceType: options.sourceType,
    };
  }

  const uploadInfo = await requestWorkspaceUploadUrl(
    options.fileName || file.name || `file_${Date.now()}`,
    options.uploadType,
    { requestData, signal: options.signal }
  );

  options.signal?.throwIfAborted();
  if (!uploadInfo.url) {
    throw new Error("Failed to get upload URL");
  }

  const path = await uploadFileToSignedUrl(uploadInfo.url, file, {
    method: String(uploadInfo.method ?? "PUT"),
    headers: uploadInfo.headers,
    signal: options.signal,
  });

  const result: UploadedWorkspaceFile = {
    path,
    url: buildOssUrl(path),
    name: file.name,
    size: file.size,
    mimeType: file.type,
  };

  options.signal?.throwIfAborted();
  return result;
}

export async function uploadProjectImage(file: File, signal?: AbortSignal) {
  const uploaded = await uploadWorkspaceFile(file, {
    uploadType: "PROJECT",
    sourceType: "LOCAL",
    signal,
  });
  return uploaded.path;
}
