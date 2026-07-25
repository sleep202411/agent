import { describe, expect, it } from "vitest";
import type { Node } from "@xyflow/react";
import type { CanvasGroup } from "@/lib/canvas-core/types";
import {
  addNodesToCanvasGroup,
  canvasGroupAtPoint,
  canvasGroupBounds,
  canvasGroupDropTarget,
  canvasGroupingAction,
  canvasNodeOverlapRatio,
  canvasGroupPositionChanges,
  groupCanvasNodes,
  reconcileCanvasGroups,
  removeNodesFromCanvasGroups,
  setCanvasGroupColor,
  ungroupCanvasNodes,
} from "./canvas-groups";

describe("canvas groups", () => {
  it("groups an exact selection and dissolves previous single-member remnants", () => {
    const groups = groupCanvasNodes(
      [
        { id: "opening", nodeIds: ["a", "b"], color: "red" },
        { id: "ending", nodeIds: ["c", "d"], color: "blue" },
      ],
      "new-group",
      ["b", "c"]
    );

    expect(groups).toEqual([{ id: "new-group", nodeIds: ["b", "c"], color: "slate" }]);
    expect(ungroupCanvasNodes(groups, "new-group")).toEqual([]);
  });

  it("moves nodes into an existing group without changing its identity or color", () => {
    expect(
      addNodesToCanvasGroup(
        [
          { id: "opening", nodeIds: ["a", "b", "c"], color: "red" },
          { id: "ending", nodeIds: ["d", "e"], color: "blue" },
        ],
        "ending",
        ["b", "outside"]
      )
    ).toEqual([
      { id: "opening", nodeIds: ["a", "c"], color: "red" },
      { id: "ending", nodeIds: ["d", "e", "b", "outside"], color: "blue" },
    ]);
  });

  it("dissolves a source group left with one member after moving a node", () => {
    expect(
      addNodesToCanvasGroup(
        [
          { id: "source", nodeIds: ["a", "b"], color: "red" },
          { id: "target", nodeIds: ["c", "d"], color: "green" },
        ],
        "target",
        ["b"]
      )
    ).toEqual([{ id: "target", nodeIds: ["c", "d", "b"], color: "green" }]);
  });

  it("toggles to ungroup only when the selection exactly covers one group", () => {
    const groups = [
      { id: "group-a", nodeIds: ["a", "b", "c"], color: "cyan" },
    ] satisfies CanvasGroup[];
    expect(canvasGroupingAction(groups, ["a", "b"])).toEqual({
      type: "group",
      nodeIds: ["a", "b"],
    });
    expect(canvasGroupingAction(groups, ["c", "a", "b"])).toEqual({
      type: "ungroup",
      groupId: "group-a",
      nodeIds: ["c", "a", "b"],
      color: "cyan",
    });
    expect(canvasGroupingAction(groups, ["a"])).toBeNull();
  });

  it("dissolves a group when deletion leaves fewer than two members", () => {
    expect(
      removeNodesFromCanvasGroups(
        [{ id: "group-a", nodeIds: ["a", "b", "c"], color: "slate" }],
        ["b", "c"]
      )
    ).toEqual([]);
  });

  it("reconciles stale, duplicate, and cross-group memberships", () => {
    expect(
      reconcileCanvasGroups(
        [
          { id: "opening", nodeIds: ["a", "a", "missing"], color: "red" },
          { id: "ending", nodeIds: ["a", "b"], color: "blue" },
          { id: "ending", nodeIds: ["b"], color: "green" },
        ],
        ["a", "b"]
      )
    ).toEqual([]);
  });

  it("derives a padded boundary from member node positions and dimensions", () => {
    const nodes = [
      {
        id: "a",
        position: { x: 100, y: 200 },
        data: {},
        measured: { width: 300, height: 180 },
      },
      {
        id: "b",
        position: { x: 500, y: 460 },
        data: {},
        measured: { width: 220, height: 160 },
      },
    ] satisfies Node[];

    expect(canvasGroupBounds(nodes, ["a", "b"])).toEqual({
      x: 64,
      y: 164,
      width: 692,
      height: 492,
    });
    expect(canvasGroupBounds(nodes, ["missing"])).toBeNull();
  });

  it("hits the full padded group region, including empty space between members", () => {
    const nodes = [
      {
        id: "a",
        position: { x: 100, y: 100 },
        data: {},
        measured: { width: 200, height: 120 },
      },
      {
        id: "b",
        position: { x: 100, y: 500 },
        data: {},
        measured: { width: 200, height: 120 },
      },
    ] satisfies Node[];
    const groups = [{ id: "group-a", nodeIds: ["a", "b"], color: "blue" }] satisfies CanvasGroup[];

    expect(canvasGroupAtPoint(groups, nodes, { x: 200, y: 360 })?.id).toBe("group-a");
    expect(canvasGroupAtPoint(groups, nodes, { x: 20, y: 360 })).toBeNull();
  });

  it("requires more than half of the dragged node to overlap an outside group", () => {
    const nodes = [
      {
        id: "a",
        position: { x: 100, y: 100 },
        data: {},
        measured: { width: 200, height: 120 },
      },
      {
        id: "b",
        position: { x: 100, y: 500 },
        data: {},
        measured: { width: 200, height: 120 },
      },
      {
        id: "c",
        position: { x: 600, y: 100 },
        data: {},
        measured: { width: 200, height: 120 },
      },
      {
        id: "d",
        position: { x: 600, y: 500 },
        data: {},
        measured: { width: 200, height: 120 },
      },
    ] satisfies Node[];
    const groups = [
      { id: "left", nodeIds: ["a", "b"], color: "blue" },
      { id: "right", nodeIds: ["c", "d"], color: "green" },
    ] satisfies CanvasGroup[];

    expect(
      canvasGroupDropTarget(
        groups,
        nodes,
        {
          id: "outside",
          position: { x: 736, y: 300 },
          data: {},
          measured: { width: 200, height: 120 },
        },
        ["outside"]
      )
    ).toBeNull();
    expect(
      canvasGroupDropTarget(
        groups,
        nodes,
        {
          id: "outside",
          position: { x: 735, y: 300 },
          data: {},
          measured: { width: 200, height: 120 },
        },
        ["outside"]
      )?.id
    ).toBe("right");
    expect(
      canvasGroupDropTarget(
        groups,
        nodes,
        {
          id: "c",
          position: { x: 650, y: 300 },
          data: {},
          measured: { width: 200, height: 120 },
        },
        ["c"]
      )
    ).toBeNull();
  });

  it("measures node overlap against a group boundary", () => {
    const node = {
      id: "member",
      position: { x: 236, y: 100 },
      data: {},
      measured: { width: 200, height: 120 },
    } satisfies Node;
    const bounds = { x: 64, y: 64, width: 272, height: 592 };

    expect(canvasNodeOverlapRatio(node, bounds)).toBe(0.5);
    expect(canvasNodeOverlapRatio({ ...node, position: { x: 237, y: 100 } }, bounds)).toBe(0.495);
  });

  it("moves every group member from the same drag origin", () => {
    const nodes = [
      { id: "a", position: { x: 100, y: 200 }, data: {} },
      { id: "b", position: { x: 500, y: 460 }, data: {} },
      { id: "outside", position: { x: 0, y: 0 }, data: {} },
    ] satisfies Node[];

    expect(canvasGroupPositionChanges(nodes, ["a", "b"], { x: 48, y: -24 }, true)).toEqual([
      {
        type: "position",
        id: "a",
        position: { x: 148, y: 176 },
        dragging: true,
      },
      {
        type: "position",
        id: "b",
        position: { x: 548, y: 436 },
        dragging: true,
      },
    ]);
  });

  it("changes only the selected group's background color", () => {
    expect(
      setCanvasGroupColor(
        [
          { id: "opening", nodeIds: ["a", "b"], color: "slate" },
          { id: "ending", nodeIds: ["c", "d"], color: "red" },
        ],
        "opening",
        "indigo"
      )
    ).toEqual([
      { id: "opening", nodeIds: ["a", "b"], color: "indigo" },
      { id: "ending", nodeIds: ["c", "d"], color: "red" },
    ]);
  });
});
