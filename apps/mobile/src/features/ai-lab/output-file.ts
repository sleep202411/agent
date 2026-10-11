export type OutputFile = { id: string; url: string; type: "image" | "video" | "audio" };
export function outputSource(output: OutputFile) {
  const url = new URL(output.url);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
    throw new Error("Invalid generated media URL.");
  return url.href;
}
export function outputFilename(output: OutputFile, contentType: string, size: number) {
  const mime = contentType.split(";")[0]!.trim().toLowerCase();
  if (!mime.startsWith(`${output.type}/`) || !size)
    throw new Error("The download did not contain the expected media.");
  const extensions: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
    "audio/ogg": "ogg",
    "audio/flac": "flac",
    "audio/webm": "webm",
  };
  const extension = extensions[mime];
  if (!extension) throw new Error("This media format cannot be saved. Open the original result.");
  return {
    filename: `fizzdragon-${output.id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80)}.${extension}`,
    mime,
  };
}
