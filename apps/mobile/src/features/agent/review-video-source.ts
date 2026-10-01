import type { ReviewVideoSource } from "./content-review-upload";
export function reviewVideoSource(picked: {
  uri: string;
  name: string;
  mimeType?: string;
  file?: File;
}): ReviewVideoSource {
  const file = picked.file;
  if (!file) throw new Error("Select the original video again to resume in this browser");
  const contentType =
    file.type.toLowerCase() === "video/quicktime" || file.name.toLowerCase().endsWith(".mov")
      ? "video/quicktime"
      : "video/mp4";
  if (
    !/\.(mp4|mov)$/i.test(file.name) &&
    !["video/mp4", "video/quicktime"].includes(file.type.toLowerCase())
  )
    throw new Error("Select an MP4 or MOV video");
  return {
    name: file.name,
    size: file.size,
    contentType,
    read: async (offset, length) =>
      new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()),
  };
}
