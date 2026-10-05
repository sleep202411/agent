import { canvasShotRows } from "./story-canvas-shot-rows";
import { z } from "zod";
import type { CanvasSnapshot } from "../../../../canvas-editor/protocol";
const node = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  data: z.record(z.unknown()).default({}),
});
const asset = z.object({
  id: z.string().min(1),
  kind: z.enum(["image", "video", "audio"]),
  panorama: z.boolean().optional(),
  name: z.string().optional(),
  prompt: z.string().optional(),
  source: z.enum(["generated", "uploaded"]).optional(),
  createdAt: z.number().finite().optional(),
  url: z.string(),
  mediaAssetId: z.string().uuid().optional(),
});
/** Output identity survives signed-URL refresh when a durable asset is available. */
function nodeMedia(value: z.infer<typeof node>, title: string) {
  const kinds: Record<string, "image" | "video" | "audio"> = {
    image: "image",
    videoAsset: "video",
    audioAsset: "audio",
    prompt: "image",
    video: "video",
    audio: "audio",
  };
  if (!Object.hasOwn(kinds, value.type)) return [];
  const kind = kinds[value.type]!;
  const generated = ["prompt", "video", "audio"].includes(value.type);
  const generation = value.data.generation;
  const rows: unknown[] = generated
    ? generation &&
      typeof generation === "object" &&
      Array.isArray((generation as { outputs?: unknown }).outputs)
      ? (generation as { outputs: unknown[] }).outputs
      : []
    : [{ url: value.data.src, assetId: value.data.mediaAssetId }];
  const seen = new Set<string>();
  return rows.flatMap((raw) => {
    const output = z
      .object({
        type: z.enum(["image", "video", "audio"]).optional(),
        url: z.string().optional(),
        assetId: z.string().uuid().optional(),
      })
      .safeParse(raw);
    if (!output.success || (output.data.type && output.data.type !== kind)) return [];
    const { url = "", assetId: mediaAssetId } = output.data;
    if (!mediaAssetId && !url) return [];
    const id = mediaAssetId ? `asset:${mediaAssetId}` : `url:${url}`;
    if (seen.has(id)) return [];
    seen.add(id);
    return [asset.parse({ id, name: title, kind, url, mediaAssetId })];
  });
}
/** Native read projection only; the original CRDT is never rewritten from this. */
export function canvasOverview(snapshot: CanvasSnapshot) {
  const shots = canvasShotRows(snapshot);
  let nextShot = 0;
  const ordered = Object.values(snapshot.nodes).map((raw) =>
    (raw as { type?: unknown } | null)?.type === "shot" ? snapshot.nodes[shots[nextShot++].id] : raw
  );
  return {
    nodes: ordered.map((raw) => {
      const value = node.parse(raw);
      const title =
        [
          value.data.label,
          value.data.title,
          value.data.name,
          value.type === "note" && typeof value.data.text === "string"
            ? value.data.text.split("\n")[0]
            : undefined,
        ].find((v): v is string => typeof v === "string" && !!v.trim()) ?? value.type;
      const text =
        [value.data.prompt, value.data.text, value.data.content].find(
          (v): v is string => typeof v === "string" && !!v.trim()
        ) ?? "";
      const generation = ["prompt", "video", "audio"].includes(value.type);
      return {
        media: nodeMedia(value, title),
        panorama:
          value.type === "panorama"
            ? {
                title,
                url: typeof value.data.src === "string" ? value.data.src : undefined,
                mediaAssetId:
                  typeof value.data.mediaAssetId === "string" ? value.data.mediaAssetId : undefined,
              }
            : undefined,
        shotNumber:
          value.type === "shot" ? shots.findIndex((shot) => shot.id === value.id) + 1 : undefined,
        id: value.id,
        title,
        text,
        type: value.type,
        canRename: generation || ["image", "videoAsset", "audioAsset"].includes(value.type),
        canEditText: value.type === "note",
        canEditPrompt: generation && value.data.locked !== true,
      };
    }),
    assets: Object.values(snapshot.assets).map((raw) => asset.parse(raw)),
    connections: Object.keys(snapshot.edges).length,
    groups: Object.keys(snapshot.groups).length,
  };
}

export type CanvasLibraryAsset = ReturnType<typeof canvasOverview>["assets"][number];
