import type { CanvasReferenceTarget } from "../../../../canvas-editor/reference-schema";
import { z } from "zod";
import type { CanvasSnapshot } from "../../../../canvas-editor/protocol";
const kinds: Record<string, "image" | "video" | "audio"> = {
  image: "image",
  panorama: "image",
  prompt: "image",
  video: "video",
  videoAsset: "video",
  audio: "audio",
  audioAsset: "audio",
};
const nodeSchema = z.object({ id: z.string(), type: z.string(), data: z.record(z.unknown()) });
export type CanvasMediaItem = {
  key: string;
  edgeId?: string;
  sourceId?: string;
  name: string;
  kind: "image" | "video" | "audio";
  url?: string;
  mediaAssetId?: string;
  preferred?: boolean;
  pending?: boolean;
  needsRefresh?: boolean;
};
function mediaUrl(value: unknown) {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? value : undefined;
  } catch {
    return undefined;
  }
}
function assetIdentity(value: unknown) {
  const parsed = z.string().uuid().safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
export function canvasMediaView(
  snapshot: CanvasSnapshot,
  nodeId: string,
  target?: CanvasReferenceTarget
) {
  const shot = nodeSchema.parse(snapshot.nodes[nodeId]);
  if (shot.id !== nodeId || !["shot", "prompt", "video", "audio"].includes(shot.type))
    throw Error("Canvas node is unavailable.");
  const reference = shot.type !== "shot";
  const refs = z.record(z.array(z.record(z.unknown()))).parse(shot.data.references ?? {});
  const sources: CanvasMediaItem[] = Object.values(snapshot.nodes).flatMap((raw) => {
    if (!raw || typeof raw !== "object" || !Object.hasOwn(kinds, (raw as { type: string }).type))
      return [];
    const node = nodeSchema.parse(raw);
    if (node.id === nodeId || (!reference && ["audio", "audioAsset"].includes(node.type)))
      return [];
    const generation = ["prompt", "video", "audio"].includes(node.type);
    const output = generation
      ? (node.data.generation as { outputs?: { url?: unknown; assetId?: unknown }[] } | undefined)
          ?.outputs?.[0]
      : undefined;
    const name =
      [node.data.label, node.data.name, node.data.prompt].find(
        (v): v is string => typeof v === "string" && !!v.trim()
      ) ?? node.id;
    const mediaAssetId = assetIdentity(generation ? output?.assetId : node.data.mediaAssetId);
    return [
      {
        key: node.id,
        sourceId: node.id,
        kind: kinds[node.type],
        name,
        url: mediaUrl(generation ? output?.url : node.data.src),
        mediaAssetId,
        pending: !mediaAssetId && !mediaUrl(generation ? output?.url : node.data.src),
      },
    ];
  });
  const attached: CanvasMediaItem[] = (reference ? Object.keys(refs) : ["frame", "clip"]).flatMap(
    (field) =>
      (refs[field] ?? []).map((ref, index) => {
        const mediaAssetId = assetIdentity(ref.assetId);
        const edgeId = typeof ref.edgeId === "string" ? ref.edgeId : undefined;
        const linked = edgeId
          ? z
              .object({ target: z.literal(nodeId), source: z.string() })
              .safeParse(snapshot.edges[edgeId])
          : undefined;
        const sourceId =
          typeof ref.sourceNodeId === "string"
            ? ref.sourceNodeId
            : linked?.success
              ? linked.data.source
              : undefined;
        return {
          key:
            typeof ref.edgeId === "string"
              ? `edge:${ref.edgeId}`
              : `${field}:${mediaAssetId ? `asset:${mediaAssetId}` : `url:${String(ref.url)}`}`,
          edgeId,
          sourceId,
          kind: reference
            ? ref.kind === "audio"
              ? ("audio" as const)
              : ref.kind === "video"
                ? ("video" as const)
                : ("image" as const)
            : field === "frame"
              ? ("image" as const)
              : ("video" as const),
          name:
            typeof ref.name === "string" && ref.name
              ? ref.name
              : (sources.find((source) => source.sourceId === sourceId)?.name ??
                sourceId ??
                String(index + 1)),
          url: mediaUrl(ref.url),
          mediaAssetId,
          needsRefresh:
            !!edgeId &&
            !!(
              sources.find((source) => source.sourceId === sourceId)?.url ||
              sources.find((source) => source.sourceId === sourceId)?.mediaAssetId
            ) &&
            (sources.find((source) => source.sourceId === sourceId)?.url !== mediaUrl(ref.url) ||
              sources.find((source) => source.sourceId === sourceId)?.mediaAssetId !==
                mediaAssetId),
          preferred:
            !reference &&
            field === "frame" &&
            !!edgeId &&
            shot.data.preferredFrameEdgeId === edgeId,
        };
      })
  );
  const bound = new Set(attached.map((item) => item.edgeId));
  for (const [id, raw] of Object.entries(snapshot.edges)) {
    const edge = z.object({ id: z.literal(id), source: z.string(), target: z.string() }).parse(raw);
    if (edge.target !== nodeId || bound.has(id)) continue;
    const source = sources.find((item) => item.sourceId === edge.source);
    if (source)
      attached.push({
        ...source,
        key: `edge:${id}`,
        edgeId: id,
        url: source.url,
        pending: true,
        needsRefresh: !!source.url || !!source.mediaAssetId,
      });
  }
  const connected = new Set(attached.map((item) => item.sourceId));
  const frames = attached.filter((item) => item.kind === "image");
  const clips = attached.filter((item) => item.kind === "video");
  const explicit = frames.some((item) => item.preferred);
  if (!reference && !explicit && frames[0] && !frames[0].pending) frames[0].preferred = true;
  return {
    title:
      [shot.data.label, shot.data.name, shot.data.prompt].find(
        (value): value is string => typeof value === "string" && !!value.trim()
      ) ?? nodeId,
    explicitPreferred:
      !reference &&
      typeof shot.data.preferredFrameEdgeId === "string" &&
      !!shot.data.preferredFrameEdgeId,
    attached,
    sources: sources
      .filter((item) => !connected.has(item.sourceId))
      .map((item) => ({
        ...item,
        available: reference
          ? !!target &&
            target.fields
              .filter((slot) => slot.kind === item.kind)
              .reduce(
                (total, slot) =>
                  total + Math.max(0, slot.maxItems - (refs[slot.field]?.length ?? 0)),
                0
              ) > attached.filter((row) => row.pending && row.kind === item.kind).length
          : item.kind === "image"
            ? frames.length < 24
            : clips.length < 1,
      })),
  };
}
