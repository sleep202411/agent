const AZURE_BLOB_PUBLIC_ROOT = "https://fizzdragonblob.blob.core.windows.net/foundry-outputs";

/**
 * Immutable Azure Blob release used by both the player and the future creator
 * example project. A new media revision gets a new version segment; published
 * objects under an existing version are never overwritten.
 */
export const JINLING_MEDIA_RELEASE = {
  releaseId: "jinling-rumeng-s01-v1",
  provider: "azure-blob",
  container: "foundry-outputs",
  objectPrefix: "interactive-films/jinling-rumeng/s01/v1",
  publicRoot: AZURE_BLOB_PUBLIC_ROOT,
} as const;

export function jinlingMediaUrl(relativePath: string): string {
  const normalizedPath = relativePath.replace(/^\/+/, "");
  return `${JINLING_MEDIA_RELEASE.publicRoot}/${JINLING_MEDIA_RELEASE.objectPrefix}/${normalizedPath}`;
}

export const jinlingP00Video = (fileName: string): string => jinlingMediaUrl(`p00/${fileName}`);

export const jinlingAudio = (fileName: string): string => jinlingMediaUrl(`audio/${fileName}`);

export const jinlingFilmClip = (clipId: string): string =>
  jinlingMediaUrl(`film-cut-v2/${clipId.toLowerCase()}.mp4`);

export const jinlingFilmChapter = (chapterId: string): string =>
  jinlingMediaUrl(`film-cut-v2/chapters/${chapterId.toLowerCase()}.mp4`);
