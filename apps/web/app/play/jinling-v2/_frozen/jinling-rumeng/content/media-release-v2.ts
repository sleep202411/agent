const AZURE_BLOB_PUBLIC_ROOT = "https://fizzdragonblob.blob.core.windows.net/foundry-outputs";

/**
 * Immutable Azure Blob release for the《无字来客》v2 storyline (三分钟版, the
 * 26-clip pack in docs/jinling-rumeng/20-THREE-MINUTE-VIDEO-PROMPT-PACK.md).
 * A separate `s01/v2` version segment — v1's `s01/v1` objects are never
 * overwritten, so both storylines can coexist during the swap.
 */
export const JINLING_MEDIA_RELEASE_V2 = {
  releaseId: "jinling-rumeng-s01-v2",
  provider: "azure-blob",
  container: "foundry-outputs",
  objectPrefix: "interactive-films/jinling-rumeng/s01/v2",
  publicRoot: AZURE_BLOB_PUBLIC_ROOT,
} as const;

export function jinlingMediaUrlV2(relativePath: string): string {
  const normalizedPath = relativePath.replace(/^\/+/, "");
  return `${JINLING_MEDIA_RELEASE_V2.publicRoot}/${JINLING_MEDIA_RELEASE_V2.objectPrefix}/${normalizedPath}`;
}

/** One clip id → its 1080p master mp4 under the v2 film-cut folder. */
export const jinlingFilmClipV2 = (clipId: string): string =>
  jinlingMediaUrlV2(`film-cut/${clipId.toLowerCase()}.mp4`);
