// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
let root: Root | undefined;
let host: HTMLDivElement;
function render(element: React.ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(element));
}
function renderHook<T>(hook: () => T) {
  const result = {} as { current: T };
  function Harness() {
    result.current = hook();
    return null;
  }
  render(<Harness />);
  return { result };
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
import type { FizzAiModel } from "@/lib/canvas-authoring/generation-api";
import {
  OperationConfirmBar,
  useSpawnComposedOperation,
  type OperationDef,
} from "./operation-confirm-bar";
const mocks = vi.hoisted(() => ({
  addNode: vi.fn(),
  addEdge: vi.fn(),
  selectNodes: vi.fn(),
  error: vi.fn(),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { error: mocks.error } }));
vi.mock("./node-toolbar", () => ({ FLOATING_PANEL: "" }));
vi.mock("@xyflow/react", () => ({
  useReactFlow: () => ({ getNode: () => undefined }),
  useStore: () => 1,
}));
vi.mock("@/lib/canvas-authoring/use-ai-catalog", () => ({
  useAiCatalog: () => ({ data: { models: [] } }),
}));
vi.mock("@/lib/canvas-core/canvas-graph-context", () => ({ useCanvasGraphContext: () => mocks }));
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  vi.clearAllMocks();
});
function operation(enabled: boolean, allowed = true): OperationDef {
  const model = {
    id: "fixture",
    enabled,
    access: { allowed },
    type: "image",
    input_schema: { type: "object", properties: {} },
    generationModes: ["relight"],
  } as FizzAiModel;
  return {
    opType: "relight",
    labelKey: "opRelight",
    findModel: () => model,
    resolveMode: () => "relight",
  };
}
it("does not create a composed card for a disabled model", () => {
  const { result } = renderHook(() => useSpawnComposedOperation());
  act(() => result.current(operation(false), "source", "https://fixture.invalid/image.png"));
  expect(mocks.addNode).not.toHaveBeenCalled();
  expect(mocks.error).toHaveBeenCalledWith("noModelForOp");
});
it("does not create an auto-submit result for a disabled model", () => {
  const closed = vi.fn();
  render(
    <OperationConfirmBar
      op={operation(false)}
      sourceNodeId="source"
      sourceUrl="https://fixture.invalid/image.png"
      onClose={closed}
    />
  );
  act(() =>
    Array.from(host.querySelectorAll("button"))
      .find((button) => button.getAttribute("aria-label") === "run")!
      .click()
  );
  expect(mocks.addNode).not.toHaveBeenCalled();
  expect(closed).not.toHaveBeenCalled();
  expect(mocks.error).toHaveBeenCalledWith("noModelForOp");
});

it("preserves enabled composed operations", () => {
  const { result } = renderHook(() => useSpawnComposedOperation());
  act(() => result.current(operation(true), "source", "https://fixture.invalid/image.png"));
  expect(mocks.addNode).toHaveBeenCalledOnce();
  expect(mocks.addEdge).toHaveBeenCalledOnce();
  expect(mocks.error).not.toHaveBeenCalled();
});
it("preserves enabled auto-submit operations", () => {
  const closed = vi.fn();
  render(
    <OperationConfirmBar
      op={operation(true)}
      sourceNodeId="source"
      sourceUrl="https://fixture.invalid/image.png"
      onClose={closed}
    />
  );
  act(() => host.querySelector<HTMLButtonElement>('button[aria-label="run"]')!.click());
  expect(mocks.addNode).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ autoSubmit: true }) })
  );
  expect(closed).toHaveBeenCalledOnce();
});
it("retains plan denial for composed operations", () => {
  const { result } = renderHook(() => useSpawnComposedOperation());
  act(() => result.current(operation(true, false), "source", "https://fixture.invalid/image.png"));
  expect(mocks.addNode).not.toHaveBeenCalled();
  expect(mocks.error).toHaveBeenCalledWith("lockedForOp");
});
it("retains plan denial for auto-submit operations", () => {
  const closed = vi.fn();
  render(
    <OperationConfirmBar
      op={operation(true, false)}
      sourceNodeId="source"
      sourceUrl="https://fixture.invalid/image.png"
      onClose={closed}
    />
  );
  const button = host.querySelector<HTMLButtonElement>('button[aria-label="run"]')!;
  expect(button.disabled).toBe(true);
  act(() => button.click());
  expect(mocks.addNode).not.toHaveBeenCalled();
  expect(closed).not.toHaveBeenCalled();
});
