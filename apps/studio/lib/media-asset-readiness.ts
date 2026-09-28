import {
  MEDIA_ASSET_READINESS_STATUSES,
  type MediaAssetReadinessCapability,
  type MediaAssetReadinessResult,
} from "@repo/shared";

interface StatusResponse {
  assets: MediaAssetReadinessResult[];
}

interface CheckResponse {
  asset: MediaAssetReadinessResult;
}

export const mediaAssetReadinessKeys = {
  all: ["fizzstudio", "media-asset-readiness"] as const,
  statuses: (
    capability: MediaAssetReadinessCapability,
    assetIds: string[],
    documentId?: string | null
  ) =>
    [
      ...mediaAssetReadinessKeys.all,
      capability,
      documentId ?? null,
      "statuses",
      [...assetIds].sort().join(","),
    ] as const,
};

export async function getMediaAssetReadinessStatuses(
  capability: MediaAssetReadinessCapability,
  assetIds: string[],
  documentId?: string | null,
  signal?: AbortSignal
): Promise<Record<string, MediaAssetReadinessResult>> {
  signal?.throwIfAborted();
  const unique = [...new Set(assetIds)].filter(Boolean);
  const entries: [string, MediaAssetReadinessResult][] = [];
  for (let offset = 0; offset < unique.length; offset += 100) {
    const batch = await readReadinessBatch(
      capability,
      unique.slice(offset, offset + 100),
      documentId,
      signal
    );
    entries.push(...Object.entries(batch));
  }
  return Object.fromEntries(entries);
}

async function readReadinessBatch(
  capability: MediaAssetReadinessCapability,
  unique: string[],
  documentId?: string | null,
  signal?: AbortSignal
): Promise<Record<string, MediaAssetReadinessResult>> {
  signal?.throwIfAborted();

  const res = await fetch("/aurora/media/asset-readiness/status", {
    method: "POST",
    credentials: "include",
    signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ capability, assetIds: unique, documentId: documentId ?? undefined }),
  });

  let json: Partial<StatusResponse> & {
    code?: number | string;
    data?: StatusResponse;
    message?: string | { message?: string };
    msg?: string;
  } = {};
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object" && !Array.isArray(body)) json = body;
  } catch {
    /* non-JSON body: fall through to HTTP error handling */
  }

  signal?.throwIfAborted();
  const upstreamMessage =
    typeof json.message === "string" ? json.message : json.message?.message || json.msg;
  if (!res.ok) {
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent("fizz:unauthorized"));
    }
    throw new Error(upstreamMessage || `Media asset readiness failed: HTTP ${res.status}`);
  }

  if (json.code != null && json.code !== 200 && json.code !== "SUCCESS") {
    throw new Error(upstreamMessage || "Media asset readiness failed");
  }

  const response = json.data ?? (json as StatusResponse);
  if (!Array.isArray(response.assets)) {
    throw new Error("Media asset readiness response missing assets");
  }
  const matching = response.assets.filter(
    (asset) =>
      asset &&
      typeof asset.assetId === "string" &&
      unique.includes(asset.assetId) &&
      asset.capability === capability &&
      MEDIA_ASSET_READINESS_STATUSES.includes(asset.status)
  );
  return Object.fromEntries(matching.map((asset) => [asset.assetId, asset]));
}

export async function requestMediaAssetReadinessCheck(
  assetId: string,
  capability: MediaAssetReadinessCapability,
  documentId?: string | null
): Promise<MediaAssetReadinessResult> {
  const res = await fetch(`/aurora/media/assets/${encodeURIComponent(assetId)}/readiness-checks`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ capability, documentId: documentId ?? undefined }),
  });

  let json: Partial<CheckResponse> & {
    code?: number | string;
    data?: CheckResponse;
    message?: string | { message?: string };
    msg?: string;
  } = {};
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object" && !Array.isArray(body)) json = body;
  } catch {
    /* non-JSON body: fall through to HTTP error handling */
  }

  const upstreamMessage =
    typeof json.message === "string" ? json.message : json.message?.message || json.msg;
  if (!res.ok) {
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent("fizz:unauthorized"));
    }
    throw new Error(upstreamMessage || `Media asset readiness check failed: HTTP ${res.status}`);
  }
  if (json.code != null && json.code !== 200 && json.code !== "SUCCESS") {
    throw new Error(upstreamMessage || "Media asset readiness check failed");
  }

  const response = json.data ?? (json as CheckResponse);
  if (
    !response.asset ||
    response.asset.assetId !== assetId ||
    response.asset.capability !== capability ||
    !MEDIA_ASSET_READINESS_STATUSES.includes(response.asset.status)
  ) {
    throw new Error("Media asset readiness check response missing asset status");
  }
  return response.asset;
}
