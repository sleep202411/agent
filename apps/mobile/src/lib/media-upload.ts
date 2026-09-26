import { Platform } from "react-native";
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
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
}

export async function uploadMobileMediaFile(
  file: MobileUploadFile,
  options: MobileUploadOptions
): Promise<{ mediaAssetId: string; url: string }> {
  // 1. Request signed URL
  const signed = await api.post<SignedUrlResponse>("/media/upload-url", {
    ...AURORA,
    data: {
      kind: options.kind,
      contentType: file.type || "image/jpeg",
      fileName: file.name,
      sizeBytes: file.size || 0,
    },
    signal: options.signal,
  });

  // 2. PUT bytes straight to storage provider
  const response = await fetch(file.uri);
  const blob = await response.blob();

  const headers: Record<string, string> = {
    "Content-Type": file.type || "image/jpeg",
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

  // 3. Confirm upload
  const confirmed = await api.post<ConfirmResponse>("/media/confirm", {
    ...AURORA,
    data: {
      storageKey: signed.storageKey,
      kind: options.kind,
      contentType: file.type || "image/jpeg",
    },
    signal: options.signal,
  });

  return {
    mediaAssetId: confirmed.mediaAssetId,
    url: confirmed.url,
  };
}
