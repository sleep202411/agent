/**
 * Per-project asset image generation status — Redis-backed, polled by the
 * frontend. Not durable: this is an ephemeral view of the BullMQ queue's
 * effect, safe to lose on Redis flush (at worst, a user sees "ready" cards
 * without a spinner during a mid-generation flush — re-trigger would just
 * succeed).
 */
import { getRedis } from "./redis-client";
import { K, TTL } from "./redis-keys";

export type AssetImageStatus =
  | "pending" // job enqueued, not yet picked up
  | "generating" // worker running
  | "ready" // image is live in Java's roleImgPath
  | "failed_config" // no REPLICATE_API_TOKEN etc.
  | "failed_policy" // Replicate rejected the prompt
  | "failed_server" // transient (should be rare, retries exhausted)
  | "failed_upload"; // OSS upload failed after retries

export interface AssetImageStatusRecord {
  status: AssetImageStatus;
  imageUrl?: string; // OSS path (not full URL) — frontend resolves via buildOssUrl
  error?: string;
  updatedAt: number;
}

function fieldKey(assetType: string, assetId: string): string {
  return `${assetType}:${assetId}`;
}

export async function setAssetImageStatus(
  projectId: string,
  assetType: string,
  assetId: string,
  record: Omit<AssetImageStatusRecord, "updatedAt">
): Promise<void> {
  const redis = getRedis();
  const key = K.projectAssetImageStatus(projectId);
  const payload: AssetImageStatusRecord = {
    ...record,
    updatedAt: Date.now(),
  };
  await redis.hset(key, fieldKey(assetType, assetId), JSON.stringify(payload));
  await redis.expire(key, TTL.WORKFLOW); // 30 days — long enough to outlive any in-flight job
}

export async function getProjectAssetImageStatus(
  projectId: string
): Promise<Record<string, AssetImageStatusRecord>> {
  const redis = getRedis();
  const raw = (await redis.hgetall(K.projectAssetImageStatus(projectId))) ?? {};
  const parsed: Record<string, AssetImageStatusRecord> = {};
  for (const [k, v] of Object.entries(raw)) {
    try {
      parsed[k] = JSON.parse(v) as AssetImageStatusRecord;
    } catch {
      // skip malformed entries silently — next write will overwrite
    }
  }
  return parsed;
}

export async function clearProjectAssetImageStatus(projectId: string): Promise<void> {
  await getRedis().del(K.projectAssetImageStatus(projectId));
}
