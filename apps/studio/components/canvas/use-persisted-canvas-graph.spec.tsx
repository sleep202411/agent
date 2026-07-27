// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  usePersistedCanvasGraph,
  type PersistedCanvasAdapter,
  type PersistedCanvasGraphResult,
  type PersistedCanvasSnapshot,
} from "./use-persisted-canvas-graph";

interface TestSnapshot extends PersistedCanvasSnapshot {
  groups: string[];
}

describe("usePersistedCanvasGraph document updates", () => {
  let container: HTMLDivElement;
  let root: Root;
  let result: PersistedCanvasGraphResult<TestSnapshot> | null;
  let applied: TestSnapshot[];
  const save =
    vi.fn<(snapshot: TestSnapshot, request?: { keepalive?: boolean }) => Promise<void>>();

  const adapter: PersistedCanvasAdapter<TestSnapshot> = {
    load: async () => ({ nodes: [], edges: [], assets: [], groups: [] }),
    save,
  };
  const extendSnapshot = (graph: PersistedCanvasSnapshot): TestSnapshot => ({
    ...graph,
    groups: applied.at(-1)?.groups ?? [],
  });
  const onApplySnapshot = (snapshot: TestSnapshot) => {
    applied.push(snapshot);
  };

  function Harness() {
    result = usePersistedCanvasGraph<TestSnapshot>({
      adapter,
      canEdit: true,
      extendSnapshot,
      onApplySnapshot,
    });
    return <span data-status={result.status} />;
  }

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    save.mockReset().mockResolvedValue();
    result = null;
    applied = [];
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("puts product-owned fields on the shared undo and redo stack", async () => {
    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(current().status).toBe("ready");

    act(() => {
      expect(
        current().commitSnapshotUpdate((snapshot) => ({
          ...snapshot,
          groups: ["group-1"],
        }))
      ).toBe(true);
    });
    expect(applied.at(-1)?.groups).toEqual(["group-1"]);
    expect(current().graph.canUndo).toBe(true);

    act(() => current().graph.undo());
    expect(applied.at(-1)?.groups).toEqual([]);
    expect(current().graph.canRedo).toBe(true);

    act(() => current().graph.redo());
    expect(applied.at(-1)?.groups).toEqual(["group-1"]);
  });

  it("flushes the latest debounced document before leaving", async () => {
    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      current().commitSnapshotUpdate((snapshot) => ({
        ...snapshot,
        groups: ["group-1"],
      }));
    });
    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      await current().flush({ keepalive: true });
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ groups: ["group-1"] }), {
      keepalive: true,
    });
    expect(current().status).toBe("saved");
  });

  it("keeps a failed snapshot queued and rejects the leaving flush", async () => {
    save.mockRejectedValue(new Error("Storage unavailable"));
    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      current().commitSnapshotUpdate((snapshot) => ({
        ...snapshot,
        groups: ["group-1"],
      }));
    });

    await act(async () => {
      await expect(current().flush({ keepalive: true })).rejects.toThrow("Storage unavailable");
    });

    expect(current().status).toBe("error");
    expect(current().error).toBe("Storage unavailable");
    expect(save).toHaveBeenCalledTimes(1);
  });

  function current(): PersistedCanvasGraphResult<TestSnapshot> {
    if (!result) throw new Error("Hook result is unavailable.");
    return result;
  }
});
