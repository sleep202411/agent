/** Episode source uploads only; trailers and other media retain their own caps. */
export const EPISODE_SOURCE_MAX_BYTES = 35 * 1024 ** 3;
/** Aliyun Green videoDetection quota for this account: 2 GB per file. */
export const CONTENT_REVIEW_VIDEO_MAX_BYTES = 2 * 1024 ** 3;
export const EPISODE_UPLOAD_PART_BYTES = 16 * 1024 ** 2;
/** Workspace compute credits: 10 per billed minute, rounded up. */
export const CONTENT_REVIEW_CREDITS_PER_MINUTE = 10;
export const CONTENT_REVIEW_MAX_DURATION_SECONDS = 3 * 60 * 60;

export function contentReviewCreditsForDurationSeconds(durationSeconds: number): number {
  const seconds = Math.max(1, Math.floor(durationSeconds));
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return minutes * CONTENT_REVIEW_CREDITS_PER_MINUTE;
}

export interface EpisodeUploadPart {
  number: number;
  sizeBytes: number;
}

export interface EpisodeUploadSession {
  id: string;
  partSize: number;
  sizeBytes: number;
  expiresAt: string;
  uploaded: boolean;
  parts: EpisodeUploadPart[];
}

export interface EpisodeUploadResult {
  mediaAssetId: string;
  storageKey: string;
  url: string | null;
}
