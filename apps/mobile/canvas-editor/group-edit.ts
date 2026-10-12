import * as Y from "yjs";
import { captureCanvasState, encodeCanvasBytes, withCanvasState } from "./state";
import { canvasGroups, canvasGroupEditSchema, type CanvasGroupEdit } from "./group-schema";

/** Web grouping semantics over the same CRDT maps. Group metadata never owns
 * node content, reusable media, wires or geometry. Exact deltas are replayable. */
export function editCanvasGroup(state: string, raw: CanvasGroupEdit) {
  const command = canvasGroupEditSchema.parse(raw);
  return withCanvasState(state, [], (doc) => {
    const nodes = doc.getMap("nodes"),
      groups = doc.getMap("groups");
    const current = canvasGroups(Object.fromEntries(groups.entries()), nodes.keys());
    const selected = "nodeIds" in command ? command.nodeIds : [];
    for (const id of selected) {
      const node = nodes.get(id);
      if (!(node instanceof Y.Map) || node.get("id") !== id)
        throw Error("A selected canvas node is unavailable. Reload the document.");
    }
    const target =
      "groupId" in command ? current.find((group) => group.id === command.groupId) : undefined;
    if ("groupId" in command && command.operation !== "create" && !target)
      throw Error("The canvas group changed. Reload the document.");
    let next = current;
    const positions: { position: Y.Map<unknown>; x: number; y: number }[] = [];
    if (command.operation === "move") {
      // Validate every member before changing any position. Updating existing
      // sub-maps preserves concurrent text/media edits and node identity.
      for (const id of target!.nodeIds) {
        const node = nodes.get(id);
        if (!(node instanceof Y.Map) || node.get("id") !== id)
          throw Error("Canvas group member is invalid.");
        const position = node.get("position");
        if (!(position instanceof Y.Map)) throw Error("Canvas node position is invalid.");
        const x = position.get("x"),
          y = position.get("y");
        if (
          typeof x !== "number" ||
          typeof y !== "number" ||
          !Number.isFinite(x) ||
          !Number.isFinite(y) ||
          !Number.isFinite(x + command.delta.x) ||
          !Number.isFinite(y + command.delta.y)
        )
          throw Error("Canvas node position is invalid.");
        positions.push({ position, x: x + command.delta.x, y: y + command.delta.y });
      }
    } else if (command.operation === "create") {
      if (groups.has(command.groupId)) throw Error("Canvas group ID already exists.");
      const incoming = new Set(selected);
      next = current
        .map((group) => ({ ...group, nodeIds: group.nodeIds.filter((id) => !incoming.has(id)) }))
        .filter((group) => group.nodeIds.length >= 2);
      next.push({ id: command.groupId, nodeIds: [...selected], color: "slate" });
    } else if (command.operation === "add") {
      const incoming = selected.filter((id) => !target!.nodeIds.includes(id));
      const moved = new Set(incoming);
      next = current
        .map((group) => ({
          ...group,
          nodeIds:
            group.id === command.groupId
              ? [...group.nodeIds, ...incoming]
              : group.nodeIds.filter((id) => !moved.has(id)),
        }))
        .filter((group) => group.nodeIds.length >= 2);
    } else if (command.operation === "remove") {
      const removed = new Set(selected);
      next = current
        .map((group) => ({ ...group, nodeIds: group.nodeIds.filter((id) => !removed.has(id)) }))
        .filter((group) => group.nodeIds.length >= 2);
    } else if (command.operation === "ungroup")
      next = current.filter((group) => group.id !== command.groupId);
    else
      next = current.map((group) =>
        group.id === command.groupId ? { ...group, color: command.color } : group
      );
    let update: string | null = null;
    doc.on("update", (bytes: Uint8Array) => {
      update = encodeCanvasBytes(bytes);
    });
    doc.transact(() => {
      for (const { position, x, y } of positions) {
        if (position.get("x") !== x) position.set("x", x);
        if (position.get("y") !== y) position.set("y", y);
      }
      if (JSON.stringify(current) === JSON.stringify(next)) return;
      const ids = new Set(next.map((group) => group.id));
      for (const id of groups.keys()) if (!ids.has(id)) groups.delete(id);
      for (const group of next) {
        const prior = groups.get(group.id) as { color?: unknown; nodeIds?: unknown } | undefined;
        if (
          prior?.color === group.color &&
          Array.isArray(prior.nodeIds) &&
          JSON.stringify(prior.nodeIds) === JSON.stringify(group.nodeIds)
        )
          continue;
        groups.set(group.id, group);
      }
    });
    return { ...captureCanvasState(doc), yjsUpdateBase64: update };
  });
}
