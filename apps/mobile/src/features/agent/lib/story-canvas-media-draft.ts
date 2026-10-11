import {
  canvasReferenceEditSchema,
  type CanvasReferenceEdit,
} from "../../../../canvas-editor/reference-schema";
import { z } from "zod";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
import {
  canvasShotMediaSchema,
  type CanvasShotMedia,
} from "../../../../canvas-editor/shot-media-schema";
import { canvasUpdateSchema, type CanvasSnapshot } from "../../../../canvas-editor/protocol";
import type { CanvasEditScope } from "./story-canvas-draft";

export const canvasMediaDraftSchema = z
  .object({
    edit: z.union([canvasReferenceEditSchema, canvasShotMediaSchema]),
    reference: z.literal(true).optional(),
    title: z.string(),
    baseline: z.string(),
    command: canvasUpdateSchema.optional(),
  })
  .strict();
export type CanvasMediaDraft = z.infer<typeof canvasMediaDraftSchema>;

/** Changes relevant to the selected media action only. Dialogue, row ordering,
 * card positions and unrelated assets never make a picture choice stale. */
export function canvasMediaBaseline(
  snapshot: CanvasSnapshot,
  raw: CanvasShotMedia | CanvasReferenceEdit
) {
  const edit = z.union([canvasReferenceEditSchema, canvasShotMediaSchema]).parse(raw);
  const target = z
    .object({
      id: z.literal(edit.nodeId),
      type: z.enum(["shot", "prompt", "video", "audio"]),
      data: z.record(z.unknown()),
    })
    .parse(snapshot.nodes[edit.nodeId]);
  const refs = target.data.references ?? {};
  let value: unknown;
  if (edit.action === "removeReference") {
    const references = z.record(z.array(z.record(z.unknown()))).parse(refs);
    const matches = (references[edit.field] ?? []).filter((row) => row.id === edit.referenceId);
    if (matches.length !== 1) throw Error("Reference identity changed. Reload the document.");
    value = { field: edit.field, reference: matches[0] };
  } else if (edit.action === "prefer") {
    const references = z.record(z.array(z.unknown())).parse(refs);
    value = { frames: references.frame ?? [], preferred: target.data.preferredFrameEdgeId ?? null };
  } else if (edit.action === "detach") {
    value = {
      refs,
      edge: snapshot.edges[edit.edgeId] ?? null,
      preferred: target.data.preferredFrameEdgeId ?? null,
    };
  } else {
    const sourceId =
      edit.action === "attach"
        ? edit.sourceId
        : z
            .object({ source: z.string(), target: z.literal(edit.nodeId) })
            .parse(snapshot.edges[edit.edgeId]).source;
    const source = z
      .object({ id: z.literal(sourceId), type: z.string(), data: z.record(z.unknown()) })
      .parse(snapshot.nodes[sourceId]);
    const sourceKeys = [
      "src",
      "mediaAssetId",
      "label",
      "name",
      "prompt",
      "generation",
      "bytes",
      "width",
      "height",
      "durationSeconds",
    ];
    const edges = Object.entries(snapshot.edges)
      .flatMap(([id, rawEdge]) => {
        const edge = z
          .object({ source: z.string(), target: z.string() })
          .passthrough()
          .parse(rawEdge);
        if (edge.target !== edit.nodeId && id !== edit.edgeId) return [];
        const node = snapshot.nodes[edge.source] as { type?: unknown } | undefined;
        return [{ id, edge, sourceType: node?.type ?? null }];
      })
      .sort((a, b) => a.id.localeCompare(b.id));
    value = {
      refs,
      edges,
      source: {
        type: source.type,
        data: Object.fromEntries(sourceKeys.map((key) => [key, source.data[key] ?? null])),
      },
    };
  }
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, stable(item)])
      );
    return value;
  };
  return JSON.stringify(
    stable(
      target.type === "shot"
        ? value
        : {
            value,
            modelId: target.data.modelId ?? null,
            mode: target.data.mode ?? null,
          }
    )
  );
}

export function canvasMediaDraftStore(
  scope: CanvasEditScope,
  userId: string,
  storage: DurableRecord = durableRecord(
    "kind" in scope ? "platform-canvas-media-draft" : "story-canvas-media-draft",
    userId,
    "kind" in scope
      ? `${scope.workspaceId}:${scope.projectId}:${scope.sectionId}:${scope.documentId}`
      : `${scope.projectId}:${scope.documentId}`
  )
) {
  const current = () => {
    if (getAuthGeneration() !== scope.generation) throw Error("Canvas session expired.");
  };
  return {
    read: () => {
      current();
      const raw = storage.read();
      return raw === null
        ? null
        : z
            .object({ version: z.literal(1), draft: canvasMediaDraftSchema.nullable() })
            .parse(JSON.parse(raw)).draft;
    },
    write: (draft: CanvasMediaDraft | null) => {
      current();
      storage.write(
        JSON.stringify({
          version: 1,
          draft: draft === null ? null : canvasMediaDraftSchema.parse(draft),
        })
      );
    },
  };
}
