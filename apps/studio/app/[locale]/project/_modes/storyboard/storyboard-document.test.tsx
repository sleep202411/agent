import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import * as Y from "yjs";
import { CanvasGraphProvider } from "@/lib/canvas-core/canvas-graph-context";
import { useCanvasGraph } from "@/lib/collab/use-canvas-graph";
import { writeNode, readAllNodes } from "@/lib/collab/canvas-doc";
import { useStoryboard } from "./use-storyboard";
vi.mock("./shot-thumbnail", () => ({ ShotThumbnail: () => null, playbackMedia: () => undefined }));
Object.defineProperty(Element.prototype, "setPointerCapture", {
  configurable: true,
  value: () => {},
});
Object.defineProperty(Element.prototype, "hasPointerCapture", {
  configurable: true,
  value: () => false,
});
Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => null });
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/app/[locale]/project/_components/project-context", () => ({
  useProjectContext: () => ({ catalog: { data: undefined } }),
  useOptionalProjectContext: () => null,
  useProjectPayerWorkspace: () => null,
}));
vi.mock("@/lib/media-upload", () => ({ uploadFileViaSignedUrl: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
it("keeps placed videos and reordered shots through a shared document reload", async () => {
  const doc = new Y.Doc();
  const restored = new Y.Doc();
  writeNode(doc, {
    id: "video",
    type: "videoAsset",
    position: { x: 120, y: 90 },
    data: { src: "https://assets.invalid/clip.mp4" },
  });
  let current!: ReturnType<typeof useStoryboard>;
  function Reader() {
    const value = useStoryboard();
    useLayoutEffect(() => {
      current = value;
    }, [value]);
    return null;
  }
  function Harness({ document, canEdit = true }: { document: Y.Doc; canEdit?: boolean }) {
    const graph = useCanvasGraph(document, undefined, canEdit);
    return (
      <CanvasGraphProvider value={graph}>
        <Reader />
      </CanvasGraphProvider>
    );
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(<Harness document={doc} />));
    let first!: string, second!: string;
    await act(async () => {
      first = current.insertShot(0)!;
    });
    await act(async () => {
      second = current.insertShot(1)!;
    });
    await act(async () => {
      expect(current.attachSource(first, "video")).toBe(true);
    });
    expect(current.rows[0].pictures[0]).toMatchObject({
      sourceNodeId: "video",
      kind: "video",
      url: "https://assets.invalid/clip.mp4",
    });
    await act(async () => current.moveShotToIndex(first, 1));
    expect(current.rows.map((row) => row.id)).toEqual([second, first]);
    expect(readAllNodes(doc).find((node) => node.id === "video")!.position).toEqual({
      x: 120,
      y: 90,
    });
    Y.applyUpdate(restored, Y.encodeStateAsUpdate(doc));
    await act(async () => root.render(<Harness key="restored" document={restored} />));
    expect(current.rows.map((row) => row.id)).toEqual([second, first]);
    expect(current.rows[1].pictures[0]).toMatchObject({
      sourceNodeId: "video",
      kind: "video",
      url: "https://assets.invalid/clip.mp4",
    });
    // A full shot must reject another video without losing its original binding.
    writeNode(restored, {
      id: "replacement",
      type: "videoAsset",
      position: { x: 240, y: 90 },
      data: { src: "https://assets.invalid/replacement.mp4" },
    });
    await act(async () => {
      expect(current.attachSource(first, "replacement")).toBe(false);
    });
    expect(current.rows[1].pictures[0].sourceNodeId).toBe("video");
    const oldEdge = current.rows[1].pictures[0].edgeId;
    await act(async () => current.detachPicture(first, oldEdge));
    expect(current.rows[1].pictures).toHaveLength(0);
    expect(readAllNodes(restored).some((node) => node.id === "video")).toBe(true);
    await act(async () => {
      expect(current.attachSource(first, "replacement")).toBe(true);
    });
    expect(current.rows[1].pictures[0].sourceNodeId).toBe("replacement");
    const before = Y.encodeStateAsUpdate(restored);
    await act(async () =>
      root.render(<Harness key="viewer" document={restored} canEdit={false} />)
    );
    await act(async () => {
      expect(current.attachSource(second, "video")).toBe(false);
    });
    expect(Y.encodeStateAsUpdate(restored)).toEqual(before);
  } finally {
    await act(async () => root.unmount());
    doc.destroy();
    restored.destroy();
  }
});

it.each(["video", "image"])(
  "saves a %s pointer drop through the actual panel and graph, then restores it",
  async (kind) => {
    const { CanvasStoryboard } = await import("./canvas-storyboard");
    const doc = new Y.Doc(),
      restored = new Y.Doc();
    writeNode(doc, {
      id: "video",
      type: kind === "video" ? "videoAsset" : "image",
      position: { x: 120, y: 90 },
      data: { src: `https://assets.invalid/clip.${kind === "video" ? "mp4" : "png"}` },
    });
    writeNode(doc, { id: "shot", type: "shot", position: { x: 500, y: 90 }, data: {} });
    const capture = vi.spyOn(Element.prototype, "setPointerCapture").mockImplementation(() => {});
    const captured = vi.spyOn(Element.prototype, "hasPointerCapture").mockReturnValue(false);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const moveNode = vi.fn();
    function Harness({ document }: { document: Y.Doc }) {
      const graph = useCanvasGraph(document);
      return (
        <CanvasGraphProvider value={graph}>
          <CanvasStoryboard>
            {(control) => (
              <>
                {control}
                <div className="react-flow__node" data-id="video" onPointerDown={moveNode}>
                  Video
                </div>
              </>
            )}
          </CanvasStoryboard>
        </CanvasGraphProvider>
      );
    }
    async function pointer(type: string, x: number, y: number) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y });
      await act(async () => host.querySelector(".react-flow__node")!.dispatchEvent(event));
    }
    const hit = vi.spyOn(document, "elementFromPoint");
    try {
      await act(async () => root.render(<Harness document={doc} />));
      await act(async () =>
        [...host.querySelectorAll("button")]
          .find((button) => button.getAttribute("aria-label") === "title")!
          .click()
      );
      hit.mockReturnValue(host.querySelector('[data-storyboard-shot="shot"]'));
      await pointer("pointerdown", 10, 10);
      await pointer("pointermove", 100, 100);
      await pointer("pointerup", 100, 100);
      expect(moveNode).not.toHaveBeenCalled();
      expect(readAllNodes(doc).find((node) => node.id === "video")!.position).toEqual({
        x: 120,
        y: 90,
      });
      const shot = readAllNodes(doc).find((node) => node.id === "shot")!;
      expect(shot.data.references).toMatchObject({
        [kind === "video" ? "clip" : "frame"]: [
          {
            sourceNodeId: "video",
            kind,
            url: `https://assets.invalid/clip.${kind === "video" ? "mp4" : "png"}`,
          },
        ],
      });
      Y.applyUpdate(restored, Y.encodeStateAsUpdate(doc));
      await act(async () => root.render(<Harness key="reload" document={restored} />));
      await act(async () =>
        [...host.querySelectorAll("button")]
          .find((button) => button.getAttribute("aria-label") === "title")!
          .click()
      );
      expect(host.querySelector('[data-storyboard-shot="shot"]')).not.toBeNull();
      expect(readAllNodes(restored).find((node) => node.id === "shot")!.data.references).toEqual(
        shot.data.references
      );
    } finally {
      await act(async () => root.unmount());
      host.remove();
      doc.destroy();
      restored.destroy();
      capture.mockRestore();
      captured.mockRestore();
      hit.mockRestore();
    }
  }
);
