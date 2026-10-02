import { UploadKindSchema, type UploadKind } from "@repo/shared/media-upload";
import { getAuthGeneration } from "@/auth/auth-store";
import { api } from "./api-client";

const AURORA = { service: "aurora" } as const;

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

export interface MobileUploadFile {
  uri: string;
  name: string;
  type: string;
  size?: number;
}

export interface MediaConfirmation {
  storageKey: string;
  kind: UploadKind;
  contentType: string;
  scope?: { crewId?: string; storyProjectId?: string };
}

export async function confirmMobileMediaUpload(data: MediaConfirmation, signal?: AbortSignal) {
  const generation = getAuthGeneration();
  UploadKindSchema.parse(data.kind);
  signal?.throwIfAborted();
  const confirmed = await api.post<ConfirmResponse>("/media/confirm", { ...AURORA, data, signal });
  signal?.throwIfAborted();
  if (generation !== getAuthGeneration()) throw new Error("Upload account changed");
  return { mediaAssetId: confirmed.mediaAssetId, url: confirmed.url };
}

export interface MobileUploadOptions {
  kind: UploadKind;
  maxBytes?: number;
  signal?: AbortSignal;
  scope?: { crewId?: string; storyProjectId?: string };
  beforeConfirm?: (confirmation: MediaConfirmation) => void;
  onProgress?: (percent: number) => void;
}

export async function uploadMobileMediaFile(
  file: MobileUploadFile,
  options: MobileUploadOptions
): Promise<{ mediaAssetId: string; url: string }> {
  const generation = getAuthGeneration();
  UploadKindSchema.parse(options.kind);
  const assertCurrent = () => {
    options.signal?.throwIfAborted();
    if (generation !== getAuthGeneration()) throw new Error("Upload account changed");
  };
  // Read the selected bytes before reserving storage. Picker size is optional
  // and may be stale; the server requires a positive, accurate byte count.
  assertCurrent();
  const crewId = options.scope?.crewId?.trim();
  const storyProjectId = options.scope?.storyProjectId?.trim();
  if (options.scope && ((!crewId && !storyProjectId) || (crewId && storyProjectId)))
    throw new Error("Provide exactly one upload scope");
  if (crewId && crewId.length > 64) throw new Error("Provide a valid Crew upload scope");
  if (
    storyProjectId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(storyProjectId)
  )
    throw new Error("Provide a valid Story project upload scope");
  if (options.kind === "crew_asset_file" && !crewId)
    throw new Error("Crew uploads require a Crew scope");
  if (storyProjectId && ["episode_source_video", "content_review_video"].includes(options.kind))
    throw new Error("This upload kind cannot use a Story project scope");
  const scope = crewId ? { crewId } : storyProjectId ? { storyProjectId } : undefined;
  const response = await fetch(file.uri, { signal: options.signal });
  if (!response.ok) throw new Error(`Cannot read selected file: HTTP ${response.status}`);
  const blob = await response.blob();
  assertCurrent();
  if (!Number.isSafeInteger(blob.size) || blob.size <= 0)
    throw new Error("Selected file is empty or has an invalid size");
  if (
    options.maxBytes !== undefined &&
    (!Number.isSafeInteger(options.maxBytes) ||
      options.maxBytes <= 0 ||
      blob.size > options.maxBytes)
  )
    throw new Error("Selected file exceeds the allowed upload size");
  const contentType = file.type || blob.type || "application/octet-stream";

  // 1. Request signed URL
  const signed = await api.post<SignedUrlResponse>("/media/upload-url", {
    ...AURORA,
    data: {
      kind: options.kind,
      contentType,
      fileName: file.name,
      sizeBytes: blob.size,
      ...(scope ? { scope } : {}),
    },
    signal: options.signal,
  });

  let recoverySaved = false;
  try {
    // 2. PUT bytes straight to storage provider
    assertCurrent();
    if (signed.method !== "PUT") throw new Error("Unsupported upload method");

    const headers: Record<string, string> = {
      "Content-Type": contentType,
      ...(signed.headers ?? {}),
    };

    const uploadRes = await fetch(signed.uploadUrl, {
      method: "PUT",
      headers,
      body: blob,
      signal: options.signal,
    });

    if (!uploadRes.ok) {
      throw new Error(`Upload failed with HTTP ${uploadRes.status}`);
    }

    assertCurrent();

    // Save recovery state after the bytes are accepted, before the confirmation write.
    const confirmation: MediaConfirmation = {
      storageKey: signed.storageKey,
      ...(scope ? { scope } : {}),
      kind: options.kind,
      contentType,
    };
    options.beforeConfirm?.(confirmation);
    recoverySaved = !!options.beforeConfirm;
    assertCurrent();
    return await confirmMobileMediaUpload(confirmation, options.signal);
  } catch (error) {
    if (
      options.kind === "crew_asset_file" &&
      signed.storageKey &&
      !recoverySaved &&
      generation === getAuthGeneration()
    ) {
      try {
        // The original upload may already be aborted. Use a separate bounded
        // request; expiry handles cleanup failure without hiding the upload error.
        await api.post("/media/cancel-upload", {
          ...AURORA,
          timeout: 10000,
          data: { storageKey: signed.storageKey, kind: options.kind, contentType, scope },
        });
      } catch {
        // Preserve the actionable original failure.
      }
    }
    throw error;
  }
}
