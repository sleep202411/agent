import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { GameUIProject } from "@repo/shared/experience-runtime";
import {
  DEFAULT_APPEARANCE,
  WORKSPACE_STORAGE_BUDGET,
  decodeAppearanceWorkspace,
  encodeAppearanceWorkspace,
  type Workspace,
} from "./appearance-workspace-storage";
import { useAppearanceWorkspace } from "./appearance-workspace";
const game = (id = "a", large = false): GameUIProject => ({
  source: {
    apiVersion: 1,
    surface: "main-menu",
    entry: "menu.js",
    files: [{ path: "menu.js", content: `export function mount(){} // ${id}` }],
  },
  artifact: {
    apiVersion: 1,
    surface: "main-menu",
    sourceHash: id.repeat(64),
    artifactHash: "f".repeat(64),
    toolchain: "test",
    javascript: large ? "x".repeat(400000) : `mount${id}`,
    css: "",
  },
});
const workspace = (): Workspace => ({
  applied: DEFAULT_APPEARANCE,
  gameUi: game(),
  prompt: "unsent idea",
  baseProjectVersion: 2,
  undo: [],
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});
it("stores one build for forty appearance undo entries and restores references without losing copy or source", () => {
  const value = workspace();
  value.undo = Array.from({ length: 40 }, (_, n) => ({
    gameUi: value.gameUi,
    applied: { version: 1, presentation: { copy: { start: { "en-US": `Enter ${n}` } } } },
  }));
  const encoded = encodeAppearanceWorkspace(value);
  expect(Object.keys(JSON.parse(encoded.raw).gameUIs)).toHaveLength(1);
  expect(encoded.raw.match(/"javascript"/g)).toHaveLength(1);
  expect(decodeAppearanceWorkspace(encoded.raw)).toEqual(value);
  const restored = decodeAppearanceWorkspace(encoded.raw);
  expect(restored.undo[0]!.gameUi).toBe(restored.gameUi);
});
it("trims the oldest undo versions to the byte budget and preserves current source, prompt and project version", () => {
  const value = workspace();
  value.gameUi = game("a", true);
  value.undo = ["b", "c", "d", "e"].map((id) => ({
    applied: DEFAULT_APPEARANCE,
    gameUi: game(id, true),
  }));
  const encoded = encodeAppearanceWorkspace(value);
  expect(encoded.raw.length * 2).toBeLessThanOrEqual(WORKSPACE_STORAGE_BUDGET);
  const restored = decodeAppearanceWorkspace(encoded.raw);
  expect(restored.gameUi).toEqual(value.gameUi);
  expect(restored.prompt).toBe(value.prompt);
  expect(restored.baseProjectVersion).toBe(2);
  expect(restored.undo).toEqual(value.undo.slice(-restored.undo.length));
  expect(restored.undo.length).toBeLessThan(4);
});
it("imports only active undo checkpoints from retired chat state while retaining the current draft", () => {
  const old = {
    choices: "glass",
    transport: "glass",
    layout: "column",
    size: 1,
    accent: "#e52227",
  };
  const draft = decodeAppearanceWorkspace(
    JSON.stringify({
      applied: old,
      candidate: null,
      candidateLabel: "default",
      history: [],
      prompt: "draft",
      gameUi: game(),
      baseProjectVersion: 3,
      messages: [
        { kind: "updated", before: old, beforeGameUi: game() },
        { kind: "undone", before: old },
        { kind: "failed", text: "failure" },
      ],
    })
  );
  expect(draft.undo).toHaveLength(1);
  expect(draft.applied.presentation?.theme?.css).toContain("flex-direction:column");
  expect(draft.gameUi).toEqual(game());
  expect(draft.prompt).toBe("draft");
  const stored = JSON.parse(encodeAppearanceWorkspace(draft).raw);
  for (const key of ["messages", "history", "candidate", "candidateLabel"])
    expect(stored).not.toHaveProperty(key);
});
it("rejects missing builds and future formats instead of silently erasing drafts", () => {
  const stored = JSON.parse(encodeAppearanceWorkspace(workspace()).raw);
  stored.gameUIs = {};
  expect(() => decodeAppearanceWorkspace(JSON.stringify(stored))).toThrow("missing");
  expect(() => decodeAppearanceWorkspace(JSON.stringify({ ...stored, version: 3 }))).toThrow();
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

it("keeps the entire current draft even when it alone exceeds the undo budget", () => {
  const value = workspace();
  value.gameUi!.source.files = Array.from({ length: 4 }, (_, n) => ({
    path: n === 0 ? "menu.js" : `source${n}.js`,
    content: "x".repeat(64 * 1024),
  }));
  value.gameUi!.artifact.javascript = "x".repeat(512 * 1024);
  value.gameUi!.artifact.css = "x".repeat(256 * 1024);
  value.undo = [{ applied: DEFAULT_APPEARANCE, gameUi: null }];
  const encoded = encodeAppearanceWorkspace(value);
  expect(encoded.raw.length * 2).toBeGreaterThan(WORKSPACE_STORAGE_BUDGET);
  expect(encoded.workspace.undo).toEqual([]);
  expect(decodeAppearanceWorkspace(encoded.raw).gameUi).toEqual(value.gameUi);
});
