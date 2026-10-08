import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import {
  extractStoryPlotVideo,
  matchStoryPlotVideos,
  MAX_PLOT_VIDEO_BYTES,
  readStoryPlotArchive,
} from "./story-plot-media";
import { parseStoryPlotImport } from "./story-plot-import";

function archiveFile(bytes: Uint8Array) {
  return {
    name: "videos.zip",
    size: bytes.length,
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as File;
}
const zip = (files: Record<string, Uint8Array>) => archiveFile(zipSync(files));
const plot = (names: string[]) =>
  parseStoryPlotImport(
    JSON.stringify({
      entryNodeId: "opening",
      assets: [],
      nodes: [
        {
          id: "opening",
          type: "scene",
          title: "Opening",
          next: null,
          storyboard: {
            clips: names.map((name, i) => ({
              id: `clip${i}`,
              kind: "video",
              title: "Video",
              prompt: "A scene",
              durationMs: 1000,
              videoFile: name,
            })),
          },
        },
      ],
    })
  );

describe("plot video archives", () => {
  it("matches Unicode names across folders and case, and reports missing or ambiguous files", async () => {
    const archive = await readStoryPlotArchive(
      zip({
        "media/开场.MP4": strToU8("video"),
        "one/ending.mp4": strToU8("one"),
        "two/Ending.MP4": strToU8("two"),
        "__MACOSX/._开场.MP4": strToU8("metadata"),
        "readme.txt": strToU8("ignored"),
      })
    );
    expect(
      matchStoryPlotVideos(plot(["开场.mp4", "folder/ending.mp4", "missing.webm"]), archive).map(
        (match) => [match.entry, match.status]
      )
    ).toEqual([
      ["media/开场.MP4", "matched"],
      [null, "ambiguous"],
      [null, "missing"],
    ]);
  });
  it("treats equivalent Unicode filenames as ambiguous", async () => {
    const archive = await readStoryPlotArchive(
      zip({ "a/café.mp4": strToU8("one"), "b/cafe\u0301.mp4": strToU8("two") })
    );
    expect(matchStoryPlotVideos(plot(["café.mp4"]), archive)[0]?.status).toBe("ambiguous");
  });
  it.each(["../opening.mp4", "/opening.mp4", "C:/opening.mp4", "folder/../../opening.mp4"])(
    "rejects unsafe archive paths: %s",
    async (name) => {
      await expect(readStoryPlotArchive(zip({ [name]: strToU8("video") }))).rejects.toMatchObject({
        code: "zipPath",
      });
    }
  );
  it("rejects claimed oversized videos before allocating their expanded data", async () => {
    const bytes = zipSync({ "opening.mp4": strToU8("video") });
    const view = new DataView(bytes.buffer);
    for (let offset = 0; offset < bytes.length - 28; offset++)
      if (view.getUint32(offset, true) === 0x02014b50)
        view.setUint32(offset + 24, MAX_PLOT_VIDEO_BYTES + 1, true);
    await expect(readStoryPlotArchive(archiveFile(bytes))).rejects.toMatchObject({
      code: "videoSize",
    });
  });
  it("ignores unsupported extensions that coincide with Object prototype names", async () => {
    const bytes = zipSync({
      "notes.constructor": strToU8("text"),
      "opening.mp4": strToU8("video"),
    });
    const view = new DataView(bytes.buffer);
    for (let offset = 0; offset < bytes.length - 28; offset++) {
      if (view.getUint32(offset, true) === 0x02014b50) {
        view.setUint32(offset + 24, MAX_PLOT_VIDEO_BYTES + 1, true);
        break;
      }
    }
    const archive = await readStoryPlotArchive(archiveFile(bytes));
    expect([...archive.entries.keys()]).toEqual(["opening.mp4"]);
  });
  it("extracts just the matched entry and supports cancellation", async () => {
    const archive = await readStoryPlotArchive(
      zip({ "nested/opening.mp4": strToU8("video"), "other.mp4": strToU8("other") })
    );
    const file = await extractStoryPlotVideo(
      archive,
      "nested/opening.mp4",
      new AbortController().signal
    );
    expect([file.name, file.type, file.size]).toEqual(["opening.mp4", "video/mp4", 5]);
    const controller = new AbortController();
    controller.abort();
    await expect(
      extractStoryPlotVideo(archive, "nested/opening.mp4", controller.signal)
    ).rejects.toMatchObject({ name: "AbortError" });
  });
  it("rejects malformed archives", async () => {
    await expect(readStoryPlotArchive(archiveFile(strToU8("not a zip")))).rejects.toMatchObject({
      code: "zipInvalid",
    });
  });
});
