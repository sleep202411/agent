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
  name: z.string().optional(),
  prompt: z.string().optional(),
  source: z.enum(["generated", "uploaded"]).optional(),
  createdAt: z.number().finite().optional(),
  url: z.string(),
  mediaAssetId: z.string().uuid().optional(),
});
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
