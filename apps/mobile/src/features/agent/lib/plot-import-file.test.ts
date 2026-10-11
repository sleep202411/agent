import { expect, it, vi } from "vitest";
import type { DocumentPickerAsset } from "expo-document-picker";
import { readPlotImportFile } from "./plot-import-file";
import { MAX_PLOT_IMPORT_BYTES } from "./story-plot-import";
const asset = (file: unknown) =>
  ({ uri: "fixture", name: "plot.json", file }) as DocumentPickerAsset;
it("reads the browser File instead of fetching an arbitrary URI", async () => {
  const text = vi.fn().mockResolvedValue('{"nodes":[]}');
  expect(
    await readPlotImportFile(asset({ size: 12, text }), new AbortController().signal)
  ).toContain("nodes");
});
it("rejects large files before reading and ignores cancelled reads", async () => {
  const text = vi.fn();
  await expect(
    readPlotImportFile(
      asset({ size: MAX_PLOT_IMPORT_BYTES + 1, text }),
      new AbortController().signal
    )
  ).rejects.toThrow();
  expect(text).not.toHaveBeenCalled();
  const controller = new AbortController();
  text.mockImplementation(async () => {
    controller.abort();
    return "{}";
  });
  await expect(readPlotImportFile(asset({ size: 2, text }), controller.signal)).rejects.toThrow();
});
