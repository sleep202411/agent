import { File, FileMode } from "expo-file-system";
import type { EpisodeVideoSource } from "./episode-upload";
import { episodeVideoType, validateEpisodeVideoSize } from "./episode-video-type";
export function episodeVideoSource(picked: {
  uri: string;
  name: string;
  mimeType?: string;
}): EpisodeVideoSource {
  if (!picked.uri.startsWith("file://"))
    throw new Error("Copy the selected video to the app before uploading.");
  const file = new File(picked.uri),
    size = file.size;
  if (!file.exists) throw new Error("Selected video no longer exists.");
  validateEpisodeVideoSize(size);
  return {
    name: picked.name,
    size,
    contentType: episodeVideoType(picked.name, picked.mimeType),
    read: async (offset, length) => {
      if (!file.exists || file.size !== size) throw new Error("Selected video changed.");
      const handle = file.open(FileMode.ReadOnly);
      try {
        handle.offset = offset;
        return handle.readBytes(length);
      } finally {
        handle.close();
      }
    },
  };
}
