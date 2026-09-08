/** Episode source uploads only; trailers and other media retain their own caps. */
export const EPISODE_SOURCE_MAX_BYTES = 35 * 1024 ** 3;
export const EPISODE_UPLOAD_PART_BYTES = 16 * 1024 ** 2;

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
