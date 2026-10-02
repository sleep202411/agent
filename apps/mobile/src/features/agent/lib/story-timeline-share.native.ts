import { Directory, File, Paths } from "expo-file-system";
import { isAvailableAsync, shareAsync } from "expo-sharing";
import type { TimelineExportArtifact } from "./story-timeline-export-session";
/** The share sheet owns a copy so closing the editor can release the encoder file. */
export async function shareTimelineVideo(
  artifact: TimelineExportArtifact,
  filename: string,
  current: () => boolean
) {
  if (!(await isAvailableAsync())) throw Error("File sharing is unavailable on this device.");
  if (!current()) return;
  const directory = new Directory(
    Paths.cache,
    `timeline-share-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  try {
    directory.create();
    const file = new File(directory, filename);
    new File(artifact.uri).copy(file);
    if (current()) await shareAsync(file.uri, { mimeType: "video/mp4", UTI: "public.mpeg-4" });
  } finally {
    if (directory.exists) directory.delete();
  }
}
