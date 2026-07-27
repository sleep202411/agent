// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Node } from "@xyflow/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CanvasGroupingActionsProvider,
  useCanvasGrouping,
  useCanvasNodeGroupingAction,
  type CanvasGroupingController,
} from "./canvas-grouping";

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...actual,
    ViewportPortal: ({ children }: { children: ReactNode }) => children,
    useReactFlow: () => ({
      screenToFlowPosition: (position: { x: number; y: number }) => position,
    }),
    useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
  };
});

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("canvas node group drop", () => {
  let container: HTMLDivElement;
  let root: Root;
  let result: ReturnType<typeof useCanvasGrouping> | null;
  const addNodesToGroup = vi.fn(() => true);
  const removeNodesFromGroups = vi.fn(() => true);
  const onNodesChange = vi.fn();
  const selectNodes = vi.fn();

  const nodes = [
    {
      id: "member-a",
      position: { x: 100, y: 100 },
      data: {},
      measured: { width: 200, height: 120 },
    },
    {
      id: "member-b",
      position: { x: 100, y: 500 },
      data: {},
      measured: { width: 200, height: 120 },
    },
    {
      id: "outside",
      position: { x: 600, y: 700 },
      data: {},
      measured: { width: 200, height: 120 },
    },
  ] satisfies Node[];

  const controller: CanvasGroupingController = {
    groups: [{ id: "target", nodeIds: ["member-a", "member-b"], color: "green" }],
    toggleGroup: vi.fn(() => null),
    addNodesToGroup,
    removeNodesFromGroups,
    setGroupColor: vi.fn(),
    isNodeGroupable: () => true,
  };

  function Harness() {
    result = useCanvasGrouping({
      controller,
      nodes,
      canEdit: true,
      onNodesChange,
      selectNodes,
    });
    return (
      <>
        <span data-drop-target={result.dropTargetGroup?.id ?? ""} />
        {result.viewportLayer}
      </>
    );
  }

  function GroupActionProbe({ nodeId }: { nodeId: string }) {
    const action = useCanvasNodeGroupingAction(nodeId);
    return action ? (
      <button type="button" data-group-id={action.groupId} onClick={action.remove}>
        remove
      </button>
    ) : null;
  }

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    addNodesToGroup.mockClear();
    removeNodesFromGroups.mockClear();
    onNodesChange.mockClear();
    selectNodes.mockClear();
    result = null;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("announces the target while dragging and commits membership on release", async () => {
    await act(async () => root.render(<Harness />));
    const outside = nodes[2]!;

    await act(async () => {
      current().nodeHandlers.onNodeDragStart(
        new MouseEvent("mousedown", { clientX: 700, clientY: 760 }),
        outside,
        [outside]
      );
      current().nodeHandlers.onNodeDrag(
        new MouseEvent("mousemove", { clientX: 200, clientY: 360 }),
        { ...outside, position: { x: 180, y: 300 } },
        [outside]
      );
    });

    expect(container.querySelector("span")?.dataset.dropTarget).toBe("target");

    await act(async () => {
      current().nodeHandlers.onNodeDragStop(
        new MouseEvent("mouseup", { clientX: 200, clientY: 360 }),
        { ...outside, position: { x: 100, y: 300 } },
        [outside]
      );
    });

    expect(addNodesToGroup).toHaveBeenCalledWith("target", ["outside"]);
    expect(container.querySelector("span")?.dataset.dropTarget).toBe("");
  });

  it("offers an explicit remove action only for a node that belongs to a group", async () => {
    await act(async () =>
      root.render(
        <CanvasGroupingActionsProvider controller={controller} canEdit>
          <GroupActionProbe nodeId="member-a" />
          <GroupActionProbe nodeId="outside" />
        </CanvasGroupingActionsProvider>
      )
    );

    const button = container.querySelector<HTMLButtonElement>("button");
    expect(button?.dataset.groupId).toBe("target");
    expect(container.querySelectorAll("button")).toHaveLength(1);

    await act(async () => button?.click());

    expect(removeNodesFromGroups).toHaveBeenCalledWith(["member-a"]);
  });

  it("does not remove membership when a grouped node is dragged outside", async () => {
    await act(async () => root.render(<Harness />));
    const member = nodes[0]!;
    const moved = { ...member, position: { x: 900, y: 900 } };

    await act(async () => {
      current().nodeHandlers.onNodeDragStart(
        new MouseEvent("mousedown", { clientX: 200, clientY: 160 }),
        member,
        [member]
      );
      current().nodeHandlers.onNodeDrag(
        new MouseEvent("mousemove", { clientX: 1_000, clientY: 960 }),
        moved,
        [moved]
      );
      current().nodeHandlers.onNodeDragStop(
        new MouseEvent("mouseup", { clientX: 1_000, clientY: 960 }),
        moved,
        [moved]
      );
    });

    expect(removeNodesFromGroups).not.toHaveBeenCalled();
    expect(addNodesToGroup).not.toHaveBeenCalled();
  });

  function current() {
    if (!result) throw new Error("Grouping result is unavailable.");
    return result;
  }
});
