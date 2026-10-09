import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import {
  DEFAULT_APPEARANCE,
  decodeAppearanceWorkspace,
  encodeAppearanceWorkspace,
  type Workspace,
} from "./appearance-workspace-storage";
import { useAppearanceWorkspace } from "./appearance-workspace";
const workspace = (): Workspace => ({
  applied: DEFAULT_APPEARANCE,
  prompt: "unsent idea",
  baseProjectVersion: 2,
  undo: [],
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});
it("preserves CSS/SVG appearance, copy and forty undo checkpoints", () => {
  const value = workspace();
  value.applied = {
    version: 1,
    presentation: {
      theme: {
        version: 1,
        name: "Test theme",
        css: '[data-experience-ui-region="choices"] [data-ui-part="option"]{background-image:asset("frame")}',
        assets: [
          {
            id: "frame",
            svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg>',
          },
        ],
      },
    },
  };
  value.undo = Array.from({ length: 40 }, (_, n) => ({
    applied: { version: 1, presentation: { copy: { start: { "en-US": `Enter ${n}` } } } },
  }));
  expect(decodeAppearanceWorkspace(encodeAppearanceWorkspace(value).raw)).toEqual(value);
});
it.each([
  { ...workspace(), version: 2 },
  { ...workspace(), version: 99 },
  { ...workspace() },
  { ...workspace(), version: 3, retiredSource: "unsupported" },
  { ...workspace(), version: 3, undo: [{ applied: DEFAULT_APPEARANCE, source: "unsupported" }] },
])("rejects unsupported draft formats and fields: %j", (value) => {
  expect(() => decodeAppearanceWorkspace(JSON.stringify(value))).toThrow();
});
it("retains quota-failed edits in memory, then persists them when storage recovers", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  let state!: ReturnType<typeof useAppearanceWorkspace>;
  function Consumer() {
    state = useAppearanceWorkspace("quota-test", { appearance: null, projectVersion: 4 });
    return null;
  }
  try {
    await act(async () => root.render(<Consumer />));
    const original = Storage.prototype.setItem;
    const fail = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    await act(async () =>
      expect(state.update((current) => ({ ...current, prompt: "do not lose me" }))).toBe(false)
    );
    expect(state.workspace.prompt).toBe("do not lose me");
    const warning = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(warning);
    expect(warning.defaultPrevented).toBe(true);
    expect(localStorage.getItem("fizzdragon.appearance-ux.v1:quota-test")).toBeNull();
    fail.mockImplementation(original);
    await act(async () => expect(state.update((current) => current)).toBe(true));
    expect(
      decodeAppearanceWorkspace(localStorage.getItem("fizzdragon.appearance-ux.v1:quota-test")!)
        .prompt
    ).toBe("do not lose me");
    const saved = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(saved);
    expect(saved.defaultPrevented).toBe(false);
  } finally {
    await act(async () => root.unmount());
  }
});
it("leaves malformed persisted drafts intact and exposes the restore error", async () => {
  const key = "fizzdragon.appearance-ux.v1:broken-test";
  localStorage.setItem(key, '{"version":99,"source":"precious"}');
  const host = document.createElement("div");
  const root = createRoot(host);
  let state!: ReturnType<typeof useAppearanceWorkspace>;
  function Consumer() {
    state = useAppearanceWorkspace("broken-test");
    return null;
  }
  try {
    await act(async () => root.render(<Consumer />));
    expect(state.restoreError).not.toBe("");
    await act(async () =>
      expect(state.update((current) => ({ ...current, prompt: "new thought" }))).toBe(false)
    );
    expect(localStorage.getItem(key)).toContain("precious");
    expect(state.workspace.prompt).toBe("new thought");
  } finally {
    await act(async () => root.unmount());
  }
});
