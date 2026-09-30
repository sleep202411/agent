import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkbenchAssetUpload } from "./workbench-asset-upload";
const state = vi.hoisted(() => ({ allowed: true, storage: true, error: false, enqueue: vi.fn() }));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("../../_hooks/use-crew-assets", () => ({
  useCrewAssetContext: () => ({
    isError: state.error,
    data: { capabilities: { upload: state.allowed }, storageAvailable: state.storage },
  }),
}));
vi.mock("../transfers/crew-transfer-center", () => ({
  useCrewTransfers: () => ({ enqueueAssetFiles: state.enqueue }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  state.allowed = true;
  state.storage = true;
  state.error = false;
  state.enqueue.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
function render(active = true) {
  act(() => root.render(<WorkbenchAssetUpload crewId="crew" active={active} />));
}
function drop(file: File) {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { files: [file] } });
  act(() => host.querySelector("button")!.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
}
it("queues dropped files into the crew asset root", () => {
  render();
  const file = new File(["script"], "episode.txt");
  drop(file);
  expect(state.enqueue).toHaveBeenCalledWith([file], null);
});
it("queues file picker selections and resets the picker for reuse", () => {
  render();
  const input = host.querySelector("input")!;
  const file = new File(["music"], "music.wav");
  Object.defineProperty(input, "files", { value: [file] });
  act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
  expect(state.enqueue).toHaveBeenCalledWith([file], null);
  expect(input.value).toBe("");
});
it.each(["permission", "storage", "error", "inactive"])(
  "blocks drops when %s denies uploading",
  (reason) => {
    state.allowed = reason !== "permission";
    state.storage = reason !== "storage";
    state.error = reason === "error";
    render(reason !== "inactive");
    expect(host.querySelector("button")!.disabled).toBe(true);
    drop(new File(["script"], "episode.txt"));
    expect(state.enqueue).not.toHaveBeenCalled();
  }
);
