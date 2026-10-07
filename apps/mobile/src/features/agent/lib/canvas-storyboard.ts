import { z } from "zod";
import type { CanvasSnapshot } from "../../../../canvas-editor/protocol";
import { canvasShotRows } from "./story-canvas-shot-rows";

const node = z.object({ id: z.string(), type: z.string(), data: z.record(z.unknown()) });
const edge = z.object({ id: z.string(), source: z.string(), target: z.string() });
const types: Record<string, "image" | "video"> = {
  image: "image",
  panorama: "image",
  prompt: "image",
  video: "video",
  videoAsset: "video",
};
export type StoryboardMedia = {
  id: string;
  name: string;
  kind: "image" | "video";
  url: string;
  mediaAssetId?: string;
  edgeId?: string;
};
/** Same saved edge order and video/preferred-image selection as Studio/export. */
export function canvasStoryboard(snapshot: CanvasSnapshot) {
  const sources: StoryboardMedia[] = [];
  for (const [id, raw] of Object.entries(snapshot.nodes)) {
    const n = node.parse(raw);
    if (n.id !== id) throw Error("Canvas node identity is inconsistent.");
    if (!Object.hasOwn(types, n.type)) continue;
    const g = n.data.generation as
      | { status?: string; outputs?: { url?: string; assetId?: string }[] }
      | undefined;
    if (g && !["done", "cancelled"].includes(g.status ?? "")) continue;
    const generated = n.type === "prompt" || n.type === "video";
    const url = generated ? g?.outputs?.[0]?.url : n.data.src;
    const readyUrl = typeof url === "string" && /^https?:\/\//i.test(url) ? url : "";
    const asset = generated ? g?.outputs?.[0]?.assetId : n.data.mediaAssetId;
    sources.push({
      id,
      name: typeof n.data.label === "string" ? n.data.label : id,
      kind: types[n.type],
      url: readyUrl,
      mediaAssetId: typeof asset === "string" ? asset : undefined,
    });
  }
  const edges = Object.entries(snapshot.edges).map(([id, raw]) => {
    const e = edge.parse(raw);
    if (e.id !== id) throw Error("Canvas edge identity is inconsistent.");
    return e;
  });
  const rows = canvasShotRows(snapshot).map((row) => {
    const data = node.parse(snapshot.nodes[row.id]).data;
    const refs = Object.values(
      z.record(z.array(z.record(z.unknown()))).parse(data.references ?? {})
    ).flat();
    const media = edges
      .filter((e) => e.target === row.id)
      .flatMap((e) => {
        const source = sources.find((s) => s.id === e.source);
        if (!source) return [];
        const ref = refs.find((r) => r.edgeId === e.id);
        const url = typeof ref?.url === "string" ? ref.url : source.url;
        if (!/^https?:\/\//i.test(url)) return [];
        return [
          {
            ...source,
            edgeId: e.id,
            url,
            mediaAssetId:
              typeof ref?.assetId === "string"
                ? ref.assetId
                : url === source.url
                  ? source.mediaAssetId
                  : undefined,
          },
        ];
      });
    return {
      ...row,
      media:
        media.find((m) => m.kind === "video") ??
        media.find((m) => m.edgeId === data.preferredFrameEdgeId) ??
        media.find((m) => m.kind === "image"),
    };
  });
  return { rows, sources: sources.filter((source) => !!source.url) };
}
