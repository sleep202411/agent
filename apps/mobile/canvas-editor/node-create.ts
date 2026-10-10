import { z } from "zod";
import * as Y from "yjs";
import { compareByOrder, orderBetween } from "@repo/shared";
import { canvasNodeCreateSchema, type CanvasNodeCreate } from "./schema";
import { captureCanvasState, encodeCanvasBytes, withCanvasState } from "./state";

/** Web writeNode layout. Never replaces an existing node on an ID collision;
 * retries must replay the exact prepared update, not regenerate a new node. */
export function createCanvasNode(state: string, raw: CanvasNodeCreate) {
  const command = canvasNodeCreateSchema.parse(raw);
  return withCanvasState(state, [], (doc) => {
    const nodes = doc.getMap("nodes");
    if (command.type === "aiActor") {
      if (command.actor.nodeId !== command.nodeId) throw Error("Actor node identity mismatch.");
      const existing = nodes.get(command.nodeId);
      if (existing instanceof Y.Map) {
        const data = existing.get("data");
        if (
          existing.get("id") === command.nodeId &&
          existing.get("type") === "image" &&
          data instanceof Y.Map &&
          data.get("aiActorId") === command.actor.actorId &&
          data.get("mediaAssetId") === command.actor.mediaAssetId
        ) {
          // A previous save may have succeeded before its local acknowledgement.
          // Do not overwrite later user edits to the label, source or position.
          return { ...captureCanvasState(doc), yjsUpdateBase64: null };
        }
      }
    }
    if (nodes.has(command.nodeId))
      throw Error("Canvas node ID already exists. Reload the document.");
    let fields: Record<string, unknown>;
    let type: string = command.type;
    let imported:
      | {
          id: string;
          mediaAssetId: string;
          kind: string;
          url: string;
          name: string;
          createdAt: number;
          source: string;
          category: string;
        }
      | undefined;
    if (command.type === "aiActor") {
      type = "image";
      fields = {
        src: command.actor.url,
        mediaAssetId: command.actor.mediaAssetId,
        label: command.actor.name,
        aiActorId: command.actor.actorId,
      };
    } else if (command.type === "uploadedAsset") {
      const asset = command.asset;
      if (doc.getMap("assets").has(asset.mediaAssetId))
        throw Error("This upload is already in the library. Add it from the library instead.");
      type =
        asset.kind === "video" ? "videoAsset" : asset.kind === "audio" ? "audioAsset" : "image";
      fields = { src: asset.url, mediaAssetId: asset.mediaAssetId, label: asset.name };
      imported = { ...asset, id: asset.mediaAssetId, source: "uploaded", category: "general" };
    } else if (command.type === "libraryAsset") {
      const source = doc.getMap("assets").get(command.assetId);
      if (!source) throw Error("This library asset is no longer available. Reload the library.");
      const asset = z
        .object({
          id: z.literal(command.assetId),
          kind: z.enum(["image", "video", "audio"]),
          url: z.string().min(1),
          mediaAssetId: z.string().uuid().optional(),
          panorama: z.boolean().optional(),
          name: z.string().optional(),
          prompt: z.string().optional(),
        })
        .parse(source);
      type =
        asset.kind === "video"
          ? "videoAsset"
          : asset.kind === "audio"
            ? "audioAsset"
            : asset.panorama
              ? "panorama"
              : "image";
      fields = {
        src: asset.url,
        mediaAssetId: asset.mediaAssetId,
        label: asset.name ?? asset.prompt,
      };
    } else if (command.type === "shot") {
      const shots: { id: string; order?: string | null }[] = [];
      for (const [id, value] of nodes) {
        if (!(value instanceof Y.Map) || value.get("type") !== "shot") continue;
        const data = value.get("data");
        const order = data instanceof Y.Map ? data.get("order") : undefined;
        if (order != null && typeof order !== "string")
          throw Error("Canvas shot order is invalid.");
        shots.push({ id, order });
      }
      shots.sort(compareByOrder);
      fields = { order: orderBetween(shots.at(-1)?.order, null) };
    } else {
      fields = command.type === "note" ? command.data : { ...command.data, references: {} };
    }
    let update: string | null = null;
    doc.on("update", (bytes: Uint8Array) => {
      update = encodeCanvasBytes(bytes);
    });
    doc.transact(() => {
      if (imported) doc.getMap("assets").set(imported.id, imported);
      const node = new Y.Map<unknown>();
      nodes.set(command.nodeId, node);
      node.set("id", command.nodeId);
      node.set("type", type);
      node.set("position", new Y.Map<number>(Object.entries(command.position)));
      const data = new Y.Map<unknown>();
      node.set("data", data);
      for (const [key, value] of Object.entries(fields))
        if (value !== undefined) data.set(key, value);
    });
    return { ...captureCanvasState(doc), yjsUpdateBase64: update };
  });
}
