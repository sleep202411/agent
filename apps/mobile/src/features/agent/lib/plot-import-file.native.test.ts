import { expect, it, vi, beforeEach } from "vitest";
import { readPlotImportFile } from "./plot-import-file.native";
import { MAX_PLOT_IMPORT_BYTES } from "./story-plot-import";
const h = vi.hoisted(() => ({ exists: true, size: 2, text: vi.fn() }));
vi.mock("expo-file-system", () => ({
  File: class {
    get exists() {
      return h.exists;
    }
    get size() {
      return h.size;
    }
    text() {
      return h.text();
    }
  },
}));
const asset = { uri: "file:///cache/plot.json", name: "plot.json", lastModified: 0 };
beforeEach(() => {
  h.exists = true;
  h.size = 2;
  h.text.mockReset().mockResolvedValue("{}");
});
it("reads native cached files", async () => {
  expect(await readPlotImportFile(asset, new AbortController().signal)).toBe("{}");
});
it("checks actual native size and existence before reading", async () => {
  h.size = MAX_PLOT_IMPORT_BYTES + 1;
  await expect(readPlotImportFile(asset, new AbortController().signal)).rejects.toThrow();
  h.size = 2;
  h.exists = false;
  await expect(readPlotImportFile(asset, new AbortController().signal)).rejects.toThrow();
  expect(h.text).not.toHaveBeenCalled();
});
