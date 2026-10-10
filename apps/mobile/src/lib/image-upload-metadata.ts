/** Match Studio's raster metadata correction; the server still validates the full file. */
export async function imageUploadMetadata(
  fileName: string,
  contentType: string,
  readHeader: () => Promise<Uint8Array> | Uint8Array
) {
  if (!contentType.startsWith("image/")) return { fileName, contentType };
  const bytes = await readHeader();
  const starts = (signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  const detected = starts([137, 80, 78, 71, 13, 10, 26, 10])
    ? { type: "image/png", extension: "png" }
    : starts([255, 216, 255])
      ? { type: "image/jpeg", extension: "jpg" }
      : starts([82, 73, 70, 70]) &&
          bytes.length >= 12 &&
          [87, 69, 66, 80].every((byte, index) => bytes[index + 8] === byte)
        ? { type: "image/webp", extension: "webp" }
        : null;
  if (!detected) return { fileName, contentType };
  const extensions: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
  };
  const matches = extensions[fileName.split(".").pop()?.toLowerCase() ?? ""] === detected.type;
  return {
    contentType: detected.type,
    fileName: matches ? fileName : `${fileName.replace(/\.[^.]+$/, "")}.${detected.extension}`,
  };
}

export function readBlobImageHeader(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read image header"));
    reader.readAsArrayBuffer(blob.slice(0, 12));
  });
}
