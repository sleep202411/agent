import { describe, expect, it } from "vitest";
import { resolveCanvasHistoryShortcut } from "./canvas-history";

describe("resolveCanvasHistoryShortcut", () => {
  it("maps platform undo and redo shortcuts", () => {
    expect(resolveCanvasHistoryShortcut(key("z", { metaKey: true }))).toBe("undo");
    expect(resolveCanvasHistoryShortcut(key("Z", { ctrlKey: true, shiftKey: true }))).toBe("redo");
    expect(resolveCanvasHistoryShortcut(key("y", { ctrlKey: true }))).toBe("redo");
  });

  it("leaves unmodified and unrelated shortcuts alone", () => {
    expect(resolveCanvasHistoryShortcut(key("z"))).toBeNull();
    expect(resolveCanvasHistoryShortcut(key("y", { metaKey: true, shiftKey: true }))).toBeNull();
    expect(resolveCanvasHistoryShortcut(key("c", { metaKey: true }))).toBeNull();
  });
});

function key(
  value: string,
  modifiers: Partial<Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "shiftKey">> = {}
): Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey"> {
  return {
    key: value,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    ...modifiers,
  };
}
