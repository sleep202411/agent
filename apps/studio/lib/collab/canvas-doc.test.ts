import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { reconcileCanvasGroups } from "@/lib/canvas-core/canvas-groups";
import {
  groupsMap,
  readAllGroups,
  readAllNodes,
  reconcileCanvasToUpdate,
  removeNode,
  writeCanvasGroups,
  writeNode,
} from "./canvas-doc";

function addNode(doc: Y.Doc, id: string) {
  writeNode(doc, {
    id,
    type: "note",
    position: { x: 0, y: 0 },
    data: {},
  });
}

describe("collaborative canvas groups", () => {
  it("ignores and cleans legacy client-measured node dimensions", () => {
    const doc = new Y.Doc();
    const legacy = new Y.Map<unknown>();
    legacy.set("id", "legacy-sized");
    legacy.set("type", "note");
    const position = new Y.Map<number>();
    position.set("x", 0);
    position.set("y", 0);
    legacy.set("position", position);
    legacy.set("data", new Y.Map<unknown>());
    legacy.set("width", 240);
    legacy.set("height", 120);
    doc.getMap<Y.Map<unknown>>("nodes").set("legacy-sized", legacy);

    expect(readAllNodes(doc)).toEqual([
      { id: "legacy-sized", type: "note", position: { x: 0, y: 0 }, data: {} },
    ]);

    writeNode(doc, readAllNodes(doc)[0]!);
    expect(legacy.has("width")).toBe(false);
    expect(legacy.has("height")).toBe(false);
    doc.destroy();
  });

  it("round-trips group metadata and removes memberships with deleted nodes", () => {
    const doc = new Y.Doc();
    addNode(doc, "a");
    addNode(doc, "b");
    addNode(doc, "c");
    writeCanvasGroups(doc, [{ id: "group-b", nodeIds: ["a", "b", "c"], color: "indigo" }]);

    expect(readAllGroups(doc)).toEqual([
      { id: "group-b", nodeIds: ["a", "b", "c"], color: "indigo" },
    ]);

    removeNode(doc, "b");
    expect(readAllGroups(doc)).toEqual([{ id: "group-b", nodeIds: ["a", "c"], color: "indigo" }]);

    removeNode(doc, "c");
    expect(groupsMap(doc).size).toBe(0);
    doc.destroy();
  });

  it("restores groups with canvas history while leaving the asset root independent", () => {
    const target = new Y.Doc();
    addNode(target, "a");
    addNode(target, "b");
    writeCanvasGroups(target, [{ id: "target", nodeIds: ["a", "b"], color: "cyan" }]);
    const targetUpdate = Y.encodeStateAsUpdate(target);

    const live = new Y.Doc();
    addNode(live, "a");
    addNode(live, "b");
    addNode(live, "c");
    writeCanvasGroups(live, [{ id: "live", nodeIds: ["b", "c"], color: "pink" }]);
    live.getMap("assets").set("kept", { id: "kept" });

    reconcileCanvasToUpdate(live, targetUpdate, "restore");

    expect(
      readAllNodes(live)
        .map((node) => node.id)
        .sort()
    ).toEqual(["a", "b"]);
    expect(readAllGroups(live)).toEqual([{ id: "target", nodeIds: ["a", "b"], color: "cyan" }]);
    expect(live.getMap("assets").has("kept")).toBe(true);
    target.destroy();
    live.destroy();
  });

  it("derives the same valid membership after concurrent grouping updates", () => {
    const base = new Y.Doc();
    ["a", "b", "c"].forEach((id) => addNode(base, id));
    const baseUpdate = Y.encodeStateAsUpdate(base);
    const left = new Y.Doc();
    const right = new Y.Doc();
    Y.applyUpdate(left, baseUpdate);
    Y.applyUpdate(right, baseUpdate);

    writeCanvasGroups(left, [{ id: "z-group", nodeIds: ["a", "b"], color: "blue" }]);
    writeCanvasGroups(right, [{ id: "a-group", nodeIds: ["a", "c"], color: "green" }]);
    Y.applyUpdate(left, Y.encodeStateAsUpdate(right));
    Y.applyUpdate(right, Y.encodeStateAsUpdate(left));

    const validLeft = reconcileCanvasGroups(
      readAllGroups(left),
      readAllNodes(left).map((node) => node.id)
    );
    const validRight = reconcileCanvasGroups(
      readAllGroups(right),
      readAllNodes(right).map((node) => node.id)
    );
    expect(validLeft).toEqual([{ id: "a-group", nodeIds: ["a", "c"], color: "green" }]);
    expect(validRight).toEqual(validLeft);
    base.destroy();
    left.destroy();
    right.destroy();
  });

  it("loads a legacy document without a groups root as an empty group list", () => {
    const legacy = new Y.Doc();
    addNode(legacy, "legacy-node");

    expect(readAllGroups(legacy)).toEqual([]);
    legacy.destroy();
  });
});
