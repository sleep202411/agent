import * as FileSystem from "expo-file-system/legacy";
import { isAvailableAsync, shareAsync } from "expo-sharing";
import { outputFilename, outputSource, type OutputFile } from "./output-file";
export async function saveOutput(output: OutputFile, signal: AbortSignal, current: () => boolean) {
  signal.throwIfAborted();
  const source = outputSource(output);
  if (!(await isAvailableAsync())) throw new Error("File sharing is unavailable on this device.");
  signal.throwIfAborted();
  if (!current()) return;
  if (!FileSystem.cacheDirectory) throw new Error("Download storage is unavailable.");
  const directory = `${FileSystem.cacheDirectory}generation-${Date.now()}-${Math.random().toString(36).slice(2)}/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const download = FileSystem.createDownloadResumable(source, directory + "output", {});
  const abort = () => {
    void download.cancelAsync().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    const result = await download.downloadAsync();
    signal.throwIfAborted();
    if (!result || result.status < 200 || result.status >= 300)
      throw new Error(`Media download failed (HTTP ${result?.status ?? "unknown"}).`);
    const info = await FileSystem.getInfoAsync(result.uri);
    const contentType =
      Object.entries(result.headers).find(([key]) => key.toLowerCase() === "content-type")?.[1] ??
      "";
    const { filename, mime } = outputFilename(
      output,
      contentType,
      info.exists && !info.isDirectory ? info.size : 0
    );
    signal.throwIfAborted();
    if (!current()) return;
    const uri = directory + filename;
    await FileSystem.moveAsync({ from: result.uri, to: uri });
    signal.throwIfAborted();
    if (current()) await shareAsync(uri, { mimeType: mime });
  } finally {
    signal.removeEventListener("abort", abort);
    await FileSystem.deleteAsync(directory, { idempotent: true });
  }
}
