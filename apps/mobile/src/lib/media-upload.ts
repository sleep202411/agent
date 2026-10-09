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

export interface MobileUploadOptions {
  kind: string;
  maxBytes?: number;
  signal?: AbortSignal;
  scope?: { crewId?: string };
  onProgress?: (percent: number) => void;
}

export async function uploadMobileMediaFile(
  file: MobileUploadFile,
  options: MobileUploadOptions
): Promise<{ mediaAssetId: string; url: string }> {
  // Read the selected bytes before reserving storage. Picker size is optional
  // and may be stale; the server requires a positive, accurate byte count.
  options.signal?.throwIfAborted();
  const crewId = options.scope?.crewId?.trim();
  if (options.scope && (!crewId || crewId.length > 64))
    throw new Error("Provide a valid Crew upload scope");
  if (options.kind === "crew_asset_file" && !crewId)
    throw new Error("Crew uploads require a Crew scope");
  const scope = crewId ? { crewId } : undefined;
  const response = await fetch(file.uri, { signal: options.signal });
  if (!response.ok) throw new Error(`Cannot read selected file: HTTP ${response.status}`);
  const blob = await response.blob();
  options.signal?.throwIfAborted();
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

  // 2. PUT bytes straight to storage provider
  options.signal?.throwIfAborted();
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

  options.signal?.throwIfAborted();

  // 3. Confirm upload
  const confirmed = await api.post<ConfirmResponse>("/media/confirm", {
    ...AURORA,
    data: {
      storageKey: signed.storageKey,
      ...(scope ? { scope } : {}),
      kind: options.kind,
      contentType,
    },
    signal: options.signal,
  });

  return {
    mediaAssetId: confirmed.mediaAssetId,
    url: confirmed.url,
  };
}
