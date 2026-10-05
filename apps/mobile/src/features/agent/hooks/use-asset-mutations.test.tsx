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
let scope = { projectId: "project", chapterId: "chapter", generation: 1 };
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
  scope = { projectId: "project", chapterId: "chapter", generation: 1 };
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

it("rejects a delayed discard confirmation after changing chapters", async () => {
  h.read.mockReturnValue(command);
  await render();
  const oldClear = result.clear;
  const next = { ...command, clientKey: "next-key", assetId: "next-asset" };
  scope = { ...scope, chapterId: "next-chapter" };
  h.read.mockReturnValue(next);
  await render();
  await act(async () => oldClear());
  expect(h.clear).not.toHaveBeenCalled();
  expect(h.onSaved).not.toHaveBeenCalled();
  expect(result.pending).toEqual(next);
  await act(async () => result.clear());
  expect(h.clear).toHaveBeenCalledWith("next-key");
});
it("rejects retained submissions after edit permission is removed", async () => {
  await render();
  const oldSubmit = result.submit;
  await render(false);
  await act(async () => oldSubmit(command));
  expect(h.save).not.toHaveBeenCalled();
  expect(h.submit).not.toHaveBeenCalled();
});
it("invalidates discard confirmations on blur and does not revive them after returning", async () => {
  h.read.mockReturnValue(command);
  await render();
  const oldClear = result.clear;
  await render(true, false);
  await act(async () => oldClear());
  await render();
  await act(async () => oldClear());
  expect(h.clear).not.toHaveBeenCalled();
  expect(result.pending).toEqual(command);
});
it("rejects discard after an account change or unmount", async () => {
  h.read.mockReturnValue(command);
  await render();
  const oldClear = result.clear;
  h.generation = 2;
  await act(async () => oldClear());
  expect(h.clear).not.toHaveBeenCalled();
  h.generation = 1;
  await act(async () => root.render(null));
  await act(async () => oldClear());
  expect(h.clear).not.toHaveBeenCalled();
});
it("hides the previous chapter's error while the next chapter loads", async () => {
  h.submit.mockRejectedValueOnce(Error("Old chapter write failed"));
  await render();
  await act(async () => result.submit(command));
  expect(result.error).toBe("Old chapter write failed");
  scope = { ...scope, chapterId: "next-chapter" };
  await render();
  expect(result.error).toBeUndefined();
  expect(result.pending).toBeNull();
});
it("does not let an earlier discard confirmation erase an in-flight retry", async () => {
  h.read.mockReturnValue(command);
  let resolve!: () => void;
  h.submit.mockReturnValue(
    new Promise<void>((done) => {
      resolve = done;
    })
  );
  await render();
  const oldClear = result.clear;
  await act(async () => {
    result.submit(command);
    oldClear();
  });
  expect(h.clear).not.toHaveBeenCalled();
  await act(async () => oldClear());
  expect(h.clear).not.toHaveBeenCalled();
  await render(false);
  await act(async () => resolve());
  expect(result.pending).toBeNull();
  expect(h.onSaved).toHaveBeenCalledOnce();
});
