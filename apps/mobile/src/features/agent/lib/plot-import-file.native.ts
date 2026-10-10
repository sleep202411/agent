import { File } from "expo-file-system";
import type { DocumentPickerAsset } from "expo-document-picker";
import { MAX_PLOT_IMPORT_BYTES, StoryPlotImportError } from "./story-plot-import";
export async function readPlotImportFile(asset: DocumentPickerAsset, signal: AbortSignal) {
  const file = new File(asset.uri);
  if (!file.exists) throw Error("Selected plot file is unavailable.");
  if (file.size > MAX_PLOT_IMPORT_BYTES) throw new StoryPlotImportError("size");
  const source = await file.text();
  signal.throwIfAborted();
  return source;
}
