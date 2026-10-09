import { File, FileMode } from "expo-file-system";
import { fetch } from "expo/fetch";
/** Keep large trailers file-backed instead of materializing a JS Blob/byte array. */
export async function selectedMedia(uri: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const file = new File(uri);
  if (!file.exists) throw new Error("The selected media file is no longer available.");
  return {
    size: file.size,
    readHeader: () => {
      signal.throwIfAborted();
      const handle = file.open(FileMode.ReadOnly);
      try {
        return handle.readBytes(12);
      } finally {
        handle.close();
      }
    },
    put: (url: string, headers: Record<string, string>, signal: AbortSignal) =>
      fetch(url, {
        method: "PUT",
        headers,
        body: file,
        signal,
        credentials: "omit",
        redirect: "error",
      }),
  };
}
