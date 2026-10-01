import { File, FileMode } from "expo-file-system";
import type { ReviewVideoSource } from "./content-review-upload";
export function reviewVideoSource(picked: {
  uri: string;
  name: string;
  mimeType?: string;
}): ReviewVideoSource {
  if (!picked.uri.startsWith("file://"))
    throw new Error("Copy the selected video to the app before uploading");
  if (
    !/\.(mp4|mov)$/i.test(picked.name) &&
    !["video/mp4", "video/quicktime"].includes(picked.mimeType?.toLowerCase() ?? "")
  )
    throw new Error("Select an MP4 or MOV video");
  const file = new File(picked.uri),
    size = file.size;
  return {
    name: picked.name,
    size,
    contentType:
      picked.mimeType?.toLowerCase() === "video/quicktime" ||
      picked.name.toLowerCase().endsWith(".mov")
        ? "video/quicktime"
        : "video/mp4",
    read: async (offset, length) => {
      if (file.size !== size) throw new Error("Selected video changed");
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
