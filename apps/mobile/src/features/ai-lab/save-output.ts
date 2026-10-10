import { outputFilename, outputSource, type OutputFile } from "./output-file";
export async function saveOutput(output: OutputFile, signal: AbortSignal, current: () => boolean) {
  signal.throwIfAborted();
  const response = await fetch(outputSource(output), { signal, credentials: "omit" });
  if (!response.ok) throw new Error(`Media download failed (HTTP ${response.status}).`);
  const blob = await response.blob();
  signal.throwIfAborted();
  const { filename } = outputFilename(output, blob.type, blob.size);
  if (!current()) return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  try {
    document.body.append(link);
    if (current()) link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
