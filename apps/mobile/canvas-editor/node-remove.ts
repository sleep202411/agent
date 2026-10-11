import * as Y from "yjs";
import { z } from "zod";
import { captureCanvasState, encodeCanvasBytes, withCanvasState } from "./state";

const referenceLists = z.record(z.array(z.object({ edgeId: z.string().optional() }).passthrough()));
const colors = new Set([
  "slate",
  "red",
  "orange",
  "amber",
  "green",
  "cyan",
  "blue",
  "indigo",
  "pink",
]);

/** Web removeNodeCascade + removeNode: remove wires and their bound references,
 * reconcile group membership, but keep reusable media in the shared inventory.
 * This runs only in the isolated runtime; the host confirms intent and saves
 * the returned exact delta through the document operation recovery journal. */
export function removeCanvasNode(state: string, rawNodeId: string) {
  const nodeId = z.string().min(1).parse(rawNodeId);
  return withCanvasState(state, [], (doc) => {
    const nodes = doc.getMap("nodes"),
      edges = doc.getMap("edges"),
      groups = doc.getMap("groups");
    const node = nodes.get(nodeId);
    if (!(node instanceof Y.Map) || node.get("id") !== nodeId)
      throw Error("Canvas node is unavailable. Reload the document.");

    // Validate the entire cascade before mutation. A malformed reference list
    // must not produce a partial deletion that leaves hidden generation inputs.
    const touching: string[] = [];
    const references = new Map<Y.Map<unknown>, z.infer<typeof referenceLists>>();
    for (const [id, edge] of edges) {
      if (!(edge instanceof Y.Map)) throw Error("Canvas edge data is invalid.");
      const source = edge.get("source"),
        target = edge.get("target");
      if (edge.get("id") !== id || typeof source !== "string" || typeof target !== "string")
        throw Error("Canvas edge data is invalid.");
      if (source !== nodeId && target !== nodeId) continue;
      touching.push(id);
      if (target === nodeId || !nodes.has(target)) continue;
      const targetNode = nodes.get(target);
      if (!(targetNode instanceof Y.Map) || targetNode.get("id") !== target)
        throw Error("Canvas target node data is invalid.");
      const data = targetNode.get("data");
      if (!(data instanceof Y.Map)) throw Error("Canvas target node data is invalid.");
      const current = references.get(data) ?? referenceLists.parse(data.get("references") ?? {});
      references.set(
        data,
        Object.fromEntries(
          Object.entries(current).map(([field, list]) => [
            field,
            list.filter((reference) => reference.edgeId !== id),
          ])
        )
      );
    }

    // Web readAllGroups sorts by id, normalizes colors, and gives the first
    // group ownership of duplicate memberships, even if it later dissolves.
    const claimed = new Set<string>();
    const nextGroups = new Map<string, { id: string; nodeIds: string[]; color: string }>();
    for (const [id, value] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (!value || typeof value !== "object") continue;
      const group = value as { nodeIds?: unknown; color?: unknown };
      const members: string[] = [];
      for (const member of Array.isArray(group.nodeIds) ? group.nodeIds : []) {
        if (
          typeof member !== "string" ||
          member === nodeId ||
          !nodes.has(member) ||
          claimed.has(member)
        )
          continue;
        claimed.add(member);
        members.push(member);
      }
      if (members.length >= 2)
        nextGroups.set(id, {
          id,
          nodeIds: members,
          color: typeof group.color === "string" && colors.has(group.color) ? group.color : "slate",
        });
    }
    let update: string | null = null;
    doc.on("update", (bytes: Uint8Array) => {
      update = encodeCanvasBytes(bytes);
    });
    doc.transact(() => {
      for (const id of touching) edges.delete(id);
      for (const [data, refs] of references) data.set("references", refs);
      nodes.delete(nodeId);
      for (const id of groups.keys()) if (!nextGroups.has(id)) groups.delete(id);
      for (const [id, next] of nextGroups) {
        const prior = groups.get(id) as typeof next;
        if (
          prior.color !== next.color ||
          !Array.isArray(prior.nodeIds) ||
          prior.nodeIds.length !== next.nodeIds.length ||
          prior.nodeIds.some((member, index) => member !== next.nodeIds[index])
        )
          groups.set(id, next);
      }
    });
    return { ...captureCanvasState(doc), yjsUpdateBase64: update };
  });
}
