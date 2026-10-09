import type { EpisodeVideoSource } from "./episode-upload";
import { episodeVideoType, validateEpisodeVideoSize } from "./episode-video-type";
export function episodeVideoSource(picked: {
  uri: string;
  name: string;
  mimeType?: string;
  file?: File;
}): EpisodeVideoSource {
  const file = picked.file;
  if (!file) throw new Error("Select the original video again to resume in this browser.");
  validateEpisodeVideoSize(file.size);
  return {
    name: file.name,
    size: file.size,
    contentType: episodeVideoType(file.name, file.type),
    read: async (offset, length) =>
      new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()),
  };
}
