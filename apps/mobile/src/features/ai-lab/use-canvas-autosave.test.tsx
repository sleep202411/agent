import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCanvasAutosave } from "./use-canvas-autosave";
import {
  canvasCardStateSchema,
  CanvasCardConflictError,
} from "../../../canvas-editor/card-state-schema";
import type { GenerationDraft } from "./draft";
import type { GenerationModel } from "./catalog-api";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
vi.mock("expo-modules-core", () => ({ uuid: { v4: () => "ref" } }));
const base = canvasCardStateSchema.parse({ prompt: "Old", modelId: "model" });
const seed = { prompt: "Old", settings: {}, references: {}, canvasBase: base };
const model: GenerationModel = {
  id: "model",
  name: "Model",
  enabled: true,
  type: "image",
  schemaVersion: "1",
  input_schema: { type: "object", properties: { prompt: { type: "string" } } },
};
let stored: GenerationDraft;
let root: Root;
let host: HTMLDivElement;
let controller: AbortController;
const saveAuthoring = vi.fn();
const store = {
  read: () => stored,
  save: (value: GenerationDraft) => {
    stored = value;
  },
  clear: vi.fn(),
};
const run = async (
  request: () => Promise<unknown>,
  success: () => void,
  failure: (e: unknown) => void
) => {
  try {
    await request();
    success();
  } catch (e) {
    failure(e);
  }
};
function Harness() {
  const [draft, setDraft] = useState(stored);
  const state = useCanvasAutosave({
    enabled: true,
    draft,
    model,
    seed,
    store,
    saveAuthoring,
    getSignal: () => controller.signal,
    run,
    saveDraft: (value) => {
      store.save(value);
      setDraft(value);
    },
  });
  return <button onClick={state.retry}>{state.error ?? "Ready"}</button>;
}
beforeEach(async () => {
  vi.useFakeTimers();
  saveAuthoring.mockReset();
  saveAuthoring.mockResolvedValue(undefined);
  controller = new AbortController();
  stored = {
    mode: "image",
    presetId: "preset",
    modelId: "model",
    schemaVersion: "1",
    values: { prompt: "New" },
    canvasBase: base,
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});
it("debounces and advances its baseline only after acknowledgement, without looping", async () => {
  let acknowledge!: () => void;
  saveAuthoring.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        acknowledge = resolve;
      })
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(799);
  });
  expect(saveAuthoring).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(stored.canvasBase).toEqual(base);
  expect(stored.canvasSave?.after.prompt).toBe("New");
  await act(async () => acknowledge());
  expect(stored.canvasSave).toBeUndefined();
  expect(stored.canvasBase?.prompt).toBe("New");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(saveAuthoring).toHaveBeenCalledOnce();
});
it("retains the frozen edit after a lost reply and retries it explicitly", async () => {
  saveAuthoring.mockRejectedValueOnce(Error("Lost reply"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(800);
  });
  const checkpoint = stored.canvasSave;
  expect(checkpoint).toBeDefined();
  expect(host.textContent).toBe("Lost reply");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(saveAuthoring).toHaveBeenCalledOnce();
  await act(async () => host.querySelector("button")!.click());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(800);
  });
  expect(saveAuthoring.mock.calls[1]?.[0]).toEqual(checkpoint);
  expect(stored.canvasSave).toBeUndefined();
});
it("requires review of collaborator changes while retaining the user's draft", async () => {
  const current = { ...base, prompt: "Collaborator" };
  saveAuthoring.mockRejectedValueOnce(new CanvasCardConflictError(current));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(800);
  });
  expect(stored.canvasConflict).toEqual(current);
  expect(stored.values.prompt).toBe("New");
  expect(stored.canvasSave).toBeUndefined();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(saveAuthoring).toHaveBeenCalledOnce();
});
it("does not start a save after the editor lifetime is aborted", async () => {
  controller.abort();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(800);
  });
  expect(saveAuthoring).not.toHaveBeenCalled();
});
