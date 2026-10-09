import { readBlobImageHeader } from "@/lib/image-upload-metadata";
/** Web keeps the browser Blob; native resolves the file-backed implementation. */
export async function selectedMedia(uri: string, signal: AbortSignal) {
  const response = await fetch(uri, { signal });
  if (!response.ok) throw new Error(`Cannot read selected media: HTTP ${response.status}`);
  const blob = await response.blob();
  signal.throwIfAborted();
  return {
    size: blob.size,
    readHeader: () => readBlobImageHeader(blob),
    put: (url: string, headers: Record<string, string>, signal: AbortSignal) =>
      fetch(url, {
        method: "PUT",
        headers,
        body: blob,
        signal,
        credentials: "omit",
        redirect: "error",
      }),
  };
}
