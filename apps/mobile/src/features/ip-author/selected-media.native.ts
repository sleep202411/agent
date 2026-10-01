import { File } from "expo-file-system";
import { fetch } from "expo/fetch";
/** Keep large trailers file-backed instead of materializing a JS Blob/byte array. */
export async function selectedMedia(uri: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const file = new File(uri);
  if (!file.exists) throw new Error("The selected media file is no longer available.");
  return {
    size: file.size,
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
