import React, { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { useMediaAuthoringCanvas } from "./use-media-authoring-canvas";
import { uploadFileViaSignedUrl as upload } from "./upload-attempt.test-mocks";
import type { CanvasGraphStore } from "@/lib/canvas-core/canvas-graph-context";
let result: ReturnType<typeof useMediaAuthoringCanvas>;
let root: ReturnType<typeof createRoot>, host: HTMLDivElement;
const makeGraph = () => ({
  nodes: [],
  edges: [],
  addLocalNode: vi.fn(),
  promoteLocalNode: vi.fn(),
  addAssets: vi.fn(),
  getNodes: () => [],
  getEdges: () => [],
  getNode: () => null,
});
let graph: ReturnType<typeof makeGraph>;
let resolve: (value: unknown) => void, reject: (reason: Error) => void;
function Harness({ scope = "a" }: { scope?: string }) {
  const value = useMediaAuthoringCanvas({
    graph: graph as unknown as CanvasGraphStore,
    canEdit: true,
    ready: false,
    scopeKey: scope,
    uploadKinds: ["image"],
  });
  useLayoutEffect(() => {
    result = value;
  });
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  upload.mockReset();
  upload.mockImplementation(
    () =>
      new Promise((yes, no) => {
        resolve = yes;
        reject = no;
      })
  );
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL() {
        return "blob:test";
      }
      static revokeObjectURL() {}
    }
  );
  graph = makeGraph();
  host = document.createElement("div");
  root = createRoot(host);
  act(() => root.render(<Harness />));
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});
function start() {
  act(() =>
    result.onPickFiles({
      target: { files: [new File(["x"], "x.png", { type: "image/png" })], value: "x" },
    } as unknown as Parameters<typeof result.onPickFiles>[0])
  );
  return graph.addLocalNode.mock.calls[0][0].id;
}
const uploaded = { url: "https://example.test/x.png", mediaAssetId: "asset" };
it("deleted upload cannot publish assets after transport has settled", async () => {
  const id = start();
  await act(async () => {
    resolve(uploaded);
    result.onNodesDelete([{ id, position: { x: 0, y: 0 }, data: {} }]);
  });
  expect(graph.addAssets).not.toHaveBeenCalled();
  expect(graph.promoteLocalNode).not.toHaveBeenCalled();
});
it("document cleanup rejects a late settled callback", async () => {
  start();
  resolve(uploaded);
  act(() => root.render(<Harness scope="b" />));
  await act(async () => {});
  expect(graph.addAssets).not.toHaveBeenCalled();
});
it("two immediate retries start only one new transport", async () => {
  const id = start();
  await act(async () => {
    reject(new Error("failed"));
  });
  act(() => {
    result.uploadContextValue.retry(id);
    result.uploadContextValue.retry(id);
  });
  expect(upload).toHaveBeenCalledTimes(2);
});
it("current upload still promotes and publishes normally", async () => {
  start();
  await act(async () => {
    resolve(uploaded);
  });
  expect(graph.promoteLocalNode).toHaveBeenCalledOnce();
  expect(graph.addAssets).toHaveBeenCalledOnce();
});

vi.mock(
  "@/app/[locale]/project/_components/project-context",
  () => import("./upload-attempt.test-mocks")
);
vi.mock(
  "@/app/[locale]/project/_stores/project-ui-store",
  () => import("./upload-attempt.test-mocks")
);
vi.mock("@xyflow/react", () => import("./upload-attempt.test-mocks"));
vi.mock("next-intl", () => import("./upload-attempt.test-mocks"));
vi.mock("sonner", () => import("./upload-attempt.test-mocks"));
vi.mock("@/lib/canvas-core/canvas-graph-context", () => import("./upload-attempt.test-mocks"));
vi.mock("@/lib/canvas-core/types", () => import("./upload-attempt.test-mocks"));
vi.mock("@/lib/canvas-core/node-geometry", () => import("./upload-attempt.test-mocks"));
vi.mock("@/lib/media-upload", () => import("./upload-attempt.test-mocks"));
vi.mock("@/components/canvas/use-canvas-tidy", () => import("./upload-attempt.test-mocks"));
vi.mock("@/components/canvas/canvas-history", () => import("./upload-attempt.test-mocks"));
vi.mock("@/components/canvas/authoring/asset-library", () => import("./upload-attempt.test-mocks"));
vi.mock(
  "@/components/canvas/authoring/asset-library-dnd",
  () => import("./upload-attempt.test-mocks")
);
vi.mock("@/components/canvas/authoring/port-colors", () => import("./upload-attempt.test-mocks"));
vi.mock(
  "@/components/canvas/authoring/use-canvas-authoring-shortcuts",
  () => import("./upload-attempt.test-mocks")
);
vi.mock("@/lib/canvas-authoring/generation-api", () => import("./upload-attempt.test-mocks"));
vi.mock("@/lib/canvas-authoring/use-ai-catalog", () => import("./upload-attempt.test-mocks"));
vi.mock("@/lib/canvas-authoring/canvas-wiring", () => import("./upload-attempt.test-mocks"));
vi.mock("@/lib/canvas-authoring/shot-node", () => import("./upload-attempt.test-mocks"));
vi.mock("@/components/canvas/add-node-menu", () => import("./upload-attempt.test-mocks"));
vi.mock(
  "@/components/canvas/authoring/reference-stack",
  () => import("./upload-attempt.test-mocks")
);
vi.mock(
  "@/lib/canvas-authoring/generation-node-types",
  () => import("./upload-attempt.test-mocks")
);
