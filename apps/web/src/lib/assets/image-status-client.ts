/**
 * Client-side access to the per-project asset image-generation status map.
 *
 * Pairs with:
 *   - apps/agent/src/mastra/lib/asset-image-status.ts (Redis hash)
 *   - apps/server/src/assistant/assets-proxy.controller.ts (Nest proxy)
 *
 * Keep polling cheap: only poll when we know something is actually
 * in-flight (status pending / generating). When every tracked asset is
 * ready or failed, the hook that consumes this should stop polling —
 * failed state is terminal until the user hits retry.
 */

export type AssetImageStatus =
  | "pending"
  | "generating"
  | "ready"
  | "failed_config"
  | "failed_policy"
  | "failed_server"
  | "failed_upload";

export interface AssetImageStatusRecord {
  status: AssetImageStatus;
  /** OSS path (not full URL) — frontend still uses buildOssUrl to resolve. */
  imageUrl?: string;
  error?: string;
  updatedAt: number;
}

export type AssetImageStatusMap = Record<string, AssetImageStatusRecord>;

export async function fetchAssetImageStatuses(
  projectId: string,
  signal?: AbortSignal
): Promise<AssetImageStatusMap> {
  const url = `/aurora/assets/image-status?projectId=${encodeURIComponent(projectId)}`;
  const resp = await fetch(url, { credentials: "include", signal });
  if (!resp.ok) {
    throw new Error(`image-status fetch failed: HTTP ${resp.status}`);
  }
  const json = (await resp.json()) as { statuses?: AssetImageStatusMap };
  return json.statuses ?? {};
}

export async function regenerateAssetImage(
  projectId: string,
  assetType: "role" | "scene" | "prop",
  assetId: string,
  worldId?: string
): Promise<void> {
  const url = `/aurora/assets/${assetType}/${encodeURIComponent(assetId)}/regenerate-image`;
  const resp = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, worldId }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`regenerate failed: HTTP ${resp.status} ${body.slice(0, 200)}`);
  }
}

export function statusFieldKey(assetType: string, assetId: string): string {
  return `${assetType}:${assetId}`;
}

/** True for any non-terminal status. Terminal = ready | failed_*. */
export function isInFlight(status: AssetImageStatus): boolean {
  return status === "pending" || status === "generating";
}

export function isFailed(status: AssetImageStatus): boolean {
  return status.startsWith("failed_");
}

/**
 * Friendly i18n key for the short label shown to the user. Pair with the
 * raw `error` field for developer-readable detail on hover/copy.
 *
 * Keys live under the "character" namespace (see
 * apps/web/messages/*.json). Caller is expected to `t(friendlyKey)`.
 */
export function friendlyStatusKey(status: AssetImageStatus): string {
  switch (status) {
    case "failed_config":
      return "imageFailedConfig"; // 服务配置错误，联系管理员
    case "failed_policy":
      return "imageFailedPolicy"; // 内容不符合生成规范，调整描述
    case "failed_upload":
      return "imageFailedUpload"; // 上传失败，稍后重试
    case "failed_server":
      return "imageFailedServer"; // 系统繁忙，稍后重试
    default:
      return "imageFailed"; // generic
  }
}
