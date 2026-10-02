import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useAssetMutations } from "./use-asset-mutations";
import type { AssetCommand } from "../api/story-asset-mutations";
const h = vi.hoisted(() => ({
  read: vi.fn(),
  save: vi.fn(),
  submit: vi.fn(),
  clear: vi.fn(),
  generation: 1,
  onSaved: vi.fn(),
}));
vi.mock("../api/story-asset-mutations", () => ({
  assetMutationPending: () => ({ read: h.read, save: h.save, submit: h.submit, clear: h.clear }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const scope = { projectId: "project", chapterId: "chapter", generation: 1 };
const command: AssetCommand = {
  action: "archive",
  assetId: "asset",
  clientKey: "key",
  input: { expectedVersion: 1 },
};
let root: Root, host: HTMLDivElement, result: ReturnType<typeof useAssetMutations>;
function Probe({ canEdit = true, active = true }: { canEdit?: boolean; active?: boolean }) {
  const value = useAssetMutations(scope, "user", active, canEdit, h.onSaved);
  useLayoutEffect(() => {
    result = value;
  });
  return null;
}
const render = async (canEdit = true, active = true) => {
  await act(async () => root.render(<Probe canEdit={canEdit} active={active} />));
};
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.read.mockReturnValue(null);
  h.submit.mockResolvedValue({});
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("loads pending recovery and disables new edits", async () => {
  h.read.mockReturnValue(command);
  await render();
  expect(result.pending).toEqual(command);
  expect(result.locked).toBe(true);
  await act(async () => result.submit(command));
  expect(h.submit).toHaveBeenCalledWith(command);
  expect(h.onSaved).toHaveBeenCalledOnce();
});
it("keeps recovery and reports a lost reply", async () => {
  h.submit.mockRejectedValueOnce(Error("Lost reply"));
  await render();
  await act(async () => result.submit(command));
  expect(result.pending).toEqual(command);
  expect(result.error).toBe("Lost reply");
  expect(h.onSaved).not.toHaveBeenCalled();
});
it("does not dispatch after storage failure", async () => {
  h.save.mockImplementation(() => {
    throw Error("Storage full");
  });
  await render();
  await act(async () => result.submit(command));
  expect(h.submit).not.toHaveBeenCalled();
  expect(result.error).toBe("Storage full");
});
it("blocks viewers and inactive screens", async () => {
  await render(false);
  await act(async () => result.submit(command));
  expect(h.save).not.toHaveBeenCalled();
  await render(true, false);
  await act(async () => result.submit(command));
  expect(h.save).not.toHaveBeenCalled();
});
it("keeps edits locked when recovery cannot be read", async () => {
  h.read.mockImplementation(() => {
    throw Error("Corrupt recovery");
  });
  await render();
  expect(result.locked).toBe(true);
  await act(async () => result.submit(command));
  expect(h.save).not.toHaveBeenCalled();
  expect(result.error).toBe("Corrupt recovery");
});
