// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useShotPictureForm, type ShotPictureForm } from "./use-shot-picture-form";
import type { ShotRow } from "./use-storyboard";

const mocks = vi.hoisted(() => ({
  nodes: [] as Array<{ id: string; data: { prompt: string } }>,
  patch: vi.fn(),
  submit: vi.fn(),
  create: vi.fn(() => "new-card"),
}));
vi.mock("@/lib/canvas-core/canvas-graph-context", () => ({
  useCanvasGraphContext: () => ({ nodes: mocks.nodes, patchNodeData: mocks.patch }),
}));
vi.mock("@/app/[locale]/project/_components/project-context", () => ({
  useProjectContext: () => ({ catalog: { data: undefined } }),
}));
vi.mock("@/lib/canvas-authoring/use-canvas-generation", () => ({
  useGeneration: () => ({
    submit: mocks.submit,
    cancel: vi.fn(),
    canSubmit: true,
    disabledReason: null,
  }),
}));
let root: Root;
let host: HTMLDivElement;
let form: ShotPictureForm;
const row = { id: "shot", pictures: [] } as unknown as ShotRow;
function Harness({
  bound = false,
  shotId = "shot",
  slot = "image",
}: {
  bound?: boolean;
  shotId?: string;
  slot?: "image" | "video";
}) {
  const current = useShotPictureForm(
    bound
      ? {
          ...row,
          id: shotId,
          pictures: [
            {
              edgeId: "edge",
              sourceNodeId: "card",
              generationModality: "image",
              kind: "image",
              url: undefined,
              status: "empty",
            },
          ],
        }
      : { ...row, id: shotId },
    slot,
    mocks.create
  );
  useLayoutEffect(() => {
    form = current;
  });
  return null;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  mocks.nodes = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("uses a blur commit when Generate runs before React renders the draft", () => {
  act(() => root.render(<Harness />));
  act(() => {
    form.setPrompt("latest blur text");
    form.generate();
  });
  expect(mocks.create).toHaveBeenCalledWith(
    "shot",
    "image",
    expect.objectContaining({ prompt: "latest blur text" })
  );
  expect(mocks.submit).toHaveBeenCalledWith("new-card");
});
it("uses the committed collaborative prompt and same-turn edits on a bound card", () => {
  mocks.nodes = [{ id: "card", data: { prompt: "initial" } }];
  act(() => root.render(<Harness bound />));
  mocks.nodes = [{ id: "card", data: { prompt: "collaborator edit" } }];
  act(() => root.render(<Harness bound />));
  act(() => form.generate());
  expect(mocks.patch).toHaveBeenLastCalledWith(
    "card",
    expect.objectContaining({ prompt: "collaborator edit" })
  );
  act(() => {
    form.setPrompt("local blur edit");
    form.generate();
  });
  expect(mocks.patch).toHaveBeenLastCalledWith(
    "card",
    expect.objectContaining({ prompt: "local blur edit" })
  );
  expect(mocks.submit).toHaveBeenLastCalledWith("card");
});

it.each(["shot", "slot"])("does not submit another %s's uncommitted draft", (target) => {
  act(() => root.render(<Harness />));
  act(() => {
    form.setPrompt("only for the first cell");
    form.setSettings({ seed: 42 });
  });
  const shotId = target === "shot" ? "second" : "shot";
  const slot = target === "slot" ? "video" : "image";
  act(() => root.render(<Harness shotId={shotId} slot={slot} />));
  expect(form.prompt).toBe("");
  expect(form.settings).not.toHaveProperty("seed", 42);
  act(() => form.generate());
  expect(mocks.create).toHaveBeenLastCalledWith(
    shotId,
    slot,
    expect.objectContaining({ prompt: "" })
  );
  act(() => root.render(<Harness />));
  expect(form.prompt).toBe("");
});
it("retains a local draft across ordinary rerenders of the same cell", () => {
  act(() => root.render(<Harness />));
  act(() => {
    form.setPrompt("keep this draft");
    form.setSettings({ seed: 42 });
  });
  act(() => root.render(<Harness />));
  expect(form.prompt).toBe("keep this draft");
  expect(form.settings).toEqual({ seed: 42 });
});
