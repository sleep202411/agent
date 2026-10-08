import { unzip, unzipSync } from "fflate";
import type { StoryPlotImport } from "./story-plot-import";

export const MAX_PLOT_ZIP_BYTES = 512 * 1024 * 1024;
export const MAX_PLOT_ZIP_EXPANDED_BYTES = 1024 * 1024 * 1024;
export const MAX_PLOT_VIDEO_BYTES = 250 * 1024 * 1024;
const VIDEO_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

export type StoryPlotMediaBinding = { nodeId: string; clipId: string; mediaAssetId: string };
export type StoryPlotVideoReference = { nodeId: string; clipId: string; filename: string };
export type StoryPlotArchive = { name: string; bytes: Uint8Array; entries: Map<string, string[]> };
export class StoryPlotArchiveError extends Error {
  constructor(readonly code: "zipSize" | "zipInvalid" | "zipExpanded" | "videoSize" | "zipPath") {
    super(code);
  }
}

export function storyPlotVideoReferences(plot: StoryPlotImport): StoryPlotVideoReference[] {
  return plot.nodes.flatMap((node) =>
    node.type === "scene"
      ? node.storyboard.clips.flatMap((clip) =>
          clip.videoFile ? [{ nodeId: node.id, clipId: clip.id, filename: clip.videoFile }] : []
        )
      : []
  );
}

/** Match a basename (including Unicode filenames) independently of folder and case. */
export function plotVideoFilename(path: string): string {
  return (path.replaceAll("\\", "/").split("/").at(-1) ?? "").normalize("NFC").toLowerCase();
}

export async function readStoryPlotArchive(file: File): Promise<StoryPlotArchive> {
  if (file.size > MAX_PLOT_ZIP_BYTES) throw new StoryPlotArchiveError("zipSize");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = new Map<string, string[]>();
  let expanded = 0;
  let count = 0;
  try {
    // Read the directory only: no entry is inflated during file selection.
    unzipSync(bytes, {
      filter(entry) {
        if (++count > 10_000) throw new StoryPlotArchiveError("zipExpanded");
        const path = entry.name.replaceAll("\\", "/");
        if (
          path.startsWith("/") ||
          /^[A-Za-z]:/.test(path) ||
          path.split("/").includes("..") ||
          /[\x00-\x1f\x7f]/.test(path)
        ) {
          throw new StoryPlotArchiveError("zipPath");
        }
        if (path.startsWith("__MACOSX/") || path.split("/").at(-1)?.startsWith("._")) return false;
        const name = plotVideoFilename(path);
        if (!Object.hasOwn(VIDEO_TYPES, name.split(".").at(-1) ?? "")) return false;
        if (entry.originalSize > MAX_PLOT_VIDEO_BYTES) throw new StoryPlotArchiveError("videoSize");
        expanded += entry.originalSize;
        if (expanded > MAX_PLOT_ZIP_EXPANDED_BYTES) throw new StoryPlotArchiveError("zipExpanded");
        entries.set(name, [...(entries.get(name) ?? []), entry.name]);
        return false;
      },
    });
  } catch (error) {
    if (error instanceof StoryPlotArchiveError) throw error;
    throw new StoryPlotArchiveError("zipInvalid");
  }
  return { name: file.name, bytes, entries };
}

export function matchStoryPlotVideos(plot: StoryPlotImport, archive: StoryPlotArchive) {
  return storyPlotVideoReferences(plot).map((reference) => {
    const matches = archive.entries.get(plotVideoFilename(reference.filename)) ?? [];
    return {
      ...reference,
      entry: matches.length === 1 ? matches[0]! : null,
      status:
        matches.length === 1
          ? ("matched" as const)
          : matches.length
            ? ("ambiguous" as const)
            : ("missing" as const),
    };
  });
}

/** Inflate one matched video at a time; never hold an expanded archive in memory. */
export function extractStoryPlotVideo(
  archive: StoryPlotArchive,
  entry: string,
  signal: AbortSignal
): Promise<File> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("Upload aborted", "AbortError"));
    const abort = () => {
      terminate();
      reject(new DOMException("Upload aborted", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    const terminate = unzip(
      archive.bytes,
      { filter: (file) => file.name === entry },
      (error, files) => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) return reject(new DOMException("Upload aborted", "AbortError"));
        const bytes = files?.[entry];
        if (error || !bytes?.length) return reject(new StoryPlotArchiveError("zipInvalid"));
        if (bytes.length > MAX_PLOT_VIDEO_BYTES)
          return reject(new StoryPlotArchiveError("videoSize"));
        const name = entry.replaceAll("\\", "/").split("/").at(-1)!;
        resolve(
          new File([bytes as Uint8Array<ArrayBuffer>], name, {
            type: VIDEO_TYPES[name.split(".").at(-1)!.toLowerCase()],
          })
        );
      }
    );
  });
}
