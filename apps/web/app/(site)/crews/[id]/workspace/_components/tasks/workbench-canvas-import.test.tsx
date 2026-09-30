import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CrewApiError } from "@/app/(site)/crews/_hooks/api";
import { WorkbenchCanvasImport } from "./workbench-canvas-import";
const state = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), invalidate: vi.fn() }));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: "user" } }) }));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/src/lib/region/cell", () => ({
  getStudioHref: () => "https://studio.fizzdragon.com/en-US",
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: state.invalidate }),
}));
vi.mock("@/app/(site)/crews/_hooks/api", () => ({
  CrewApiError: class extends Error {
    constructor(
      public status: number,
      body: unknown
    ) {
      super(String(body));
    }
  },
  crewApi: { get: state.get, post: state.post },
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
const id = "01990000-0000-7000-8000-000000000001";
beforeEach(() => {
  state.get.mockReset().mockResolvedValue({
    projectId: id,
    title: "Story",
    sourceRevision: 3,
    sourceHash: "a".repeat(64),
    plotTree: { nodes: [{ id: "scene", type: "scene", content: { title: "Scene One" } }] },
  });
  state.post.mockReset().mockResolvedValue({ taskIds: ["task"], replayed: false });
  state.invalidate.mockReset().mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<WorkbenchCanvasImport crewId="crew" />));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
async function preview() {
  act(() => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      `https://studio.fizzdragon.com/story-studio/projects/${id}/canvas`
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
}
function button(key: string) {
  return [...host.querySelectorAll("button")].find((b) => b.textContent === key)!;
}
it("previews without writing and confirms exactly once on repeated clicks", async () => {
  await preview();
  expect(host.textContent).toContain("Scene One");
  expect(state.post).not.toHaveBeenCalled();
  await act(async () => {
    button("confirmImport").click();
    button("confirmImport").click();
  });
  expect(state.post).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("importDone");
});
it("retains the exact request after an uncertain result", async () => {
  state.post.mockRejectedValueOnce(new Error("Connection lost"));
  await preview();
  await act(async () => button("confirmImport").click());
  expect(host.querySelector("input")!.disabled).toBe(true);
  expect(host.textContent).toContain("Connection lost");
  await act(async () => button("retryImport").click());
  expect(state.post.mock.calls[1]).toEqual(state.post.mock.calls[0]);
  expect(host.textContent).toContain("importDone");
});

it("allows a fresh preview after a definitive stale-source rejection", async () => {
  state.post.mockRejectedValueOnce(new CrewApiError(409, "Canvas changed"));
  await preview();
  await act(async () => button("confirmImport").click());
  expect(host.querySelector("input")!.disabled).toBe(false);
  expect(button("retryImport")).toBeUndefined();
  await preview();
  expect(state.get).toHaveBeenCalledTimes(2);
});

it("stages the versioned scene batch without submitting it", async () => {
  const onStage = vi.fn();
  act(() => root.render(<WorkbenchCanvasImport crewId="crew" onStage={onStage} />));
  await preview();
  await act(async () => button("stageTasks").click());
  expect(state.post).not.toHaveBeenCalled();
  expect(onStage).toHaveBeenCalledWith(
    expect.objectContaining({
      key: `canvas:${id}`,
      body: { sourceRevision: 3, sourceHash: "a".repeat(64) },
      items: [{ title: "Scene One", assetCategory: "production" }],
    })
  );
});
