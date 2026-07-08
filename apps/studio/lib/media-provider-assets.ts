export type MediaProviderAssetMirrorStatus =
  | "pending"
  | "processing"
  | "active"
  | "failed"
  | "disabled"
  | "deleted";

export interface MediaProviderAssetStatus {
  assetId: string;
  status: MediaProviderAssetMirrorStatus;
  statusReason?: string | null;
  updatedAt: string;
}

interface StatusResponse {
  assets: MediaProviderAssetStatus[];
}

export const mediaProviderAssetKeys = {
  all: ["fizzstudio", "media-provider-assets"] as const,
  statuses: (assetIds: string[]) =>
    [...mediaProviderAssetKeys.all, "statuses", [...assetIds].sort().join(",")] as const,
};

export async function getMediaProviderAssetStatuses(
  assetIds: string[]
): Promise<Record<string, MediaProviderAssetStatus>> {
  const unique = [...new Set(assetIds)].filter(Boolean).slice(0, 100);
  if (unique.length === 0) return {};

  const res = await fetch("/aurora/media/provider-assets/status", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ assetIds: unique }),
  });

  let json: Partial<StatusResponse> & {
    code?: number | string;
    data?: StatusResponse;
    message?: string;
    msg?: string;
  } = {};
  try {
    json = await res.json();
  } catch {
    /* non-JSON body: fall through to HTTP error handling */
  }

  if (!res.ok) {
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent("fizz:unauthorized"));
    }
    throw new Error(json.message || json.msg || `Provider asset status failed: HTTP ${res.status}`);
  }

  if (json.code != null && json.code !== 200 && json.code !== "SUCCESS") {
    throw new Error(json.msg || json.message || "Provider asset status failed");
  }

  const response = json.data ?? (json as StatusResponse);
  if (!Array.isArray(response.assets)) {
    throw new Error("Provider asset status response missing assets");
  }
  return Object.fromEntries(response.assets.map((asset) => [asset.assetId, asset]));
}
