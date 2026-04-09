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
  requestData?: Record<string, unknown>;
}

export interface UploadWorkspaceFileOptions {
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
  options?: { method?: string; headers?: Record<string, string> }
) {
  const response = await fetch(signedUrl, {
    method: options?.method ?? "PUT",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      ...(options?.headers ?? {}),
    },
    body: file,
  });

  if (!response.ok) {
    throw new Error("Upload failed");
  }

  return extractStoragePathFromSignedUrl(signedUrl);
}

// ─── MD5 dedup cache ──────────────────────────────────────

const uploadedMd5Cache = new Map<string, UploadedWorkspaceFile>();

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

export async function uploadWorkspaceFile(file: File, options: UploadWorkspaceFileOptions) {
  const validationError = validateWorkspaceUploadFile(file, options);
  if (validationError) {
    throw new Error(validationError);
  }

  // MD5 dedup: skip re-uploading identical files
  const hash = await computeFileHash(file);
  if (uploadedMd5Cache.has(hash)) {
    throw new DuplicateFileError(file.name);
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
    { requestData }
  );

  if (!uploadInfo.url) {
    throw new Error("Failed to get upload URL");
  }

  const path = await uploadFileToSignedUrl(uploadInfo.url, file, {
    method: String(uploadInfo.method ?? "PUT"),
    headers: uploadInfo.headers,
  });

  const result: UploadedWorkspaceFile = {
    path,
    url: buildOssUrl(path),
    name: file.name,
    size: file.size,
    mimeType: file.type,
  };

  uploadedMd5Cache.set(hash, result);
  return result;
}

export async function uploadProjectImage(file: File) {
  const uploaded = await uploadWorkspaceFile(file, {
    uploadType: "PROJECT",
    sourceType: "LOCAL",
  });
  return uploaded.path;
}
