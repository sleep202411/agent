import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDeleteNode } from "./delete-node-button/use-delete-node";
import { useDuplicate } from "./duplicate-button/use-duplicate";
import { useMoveNode } from "./move-node-button/use-move-node";

vi.mock("@/hooks/use-is-breakpoint", () => ({ useIsBreakpoint: () => false }));
let editor: Editor;
let root: Root;
let container: HTMLDivElement;
let input: HTMLInputElement;
let direct: () => boolean;
type Action = "delete" | "duplicate" | "move";
function Controls({ action }: { action: Action }) {
  const del = useDeleteNode({ editor });
  const duplicate = useDuplicate({ editor });
  const move = useMoveNode({ editor, direction: "down" });
  useLayoutEffect(() => {
    direct =
      action === "delete"
        ? del.handleDeleteNode
        : action === "duplicate"
          ? duplicate.handleDuplicate
          : move.handleMoveNode;
  });
  return null;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  editor = new Editor({
    extensions: [StarterKit],
    content: "<p>First block</p><p>Second block</p>",
  });
  document.body.append(editor.view.dom);
  editor.commands.setTextSelection(3);
  container = document.createElement("div");
  input = document.createElement("input");
  document.body.append(container, input);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  editor.destroy();
  document.body.innerHTML = "";
  vi.clearAllTimers();
  vi.useRealTimers();
});
const actions: Action[] = ["delete", "duplicate", "move"];
function press(action: Action, target: HTMLElement) {
  const options =
    action === "delete"
      ? { key: "Backspace", code: "Backspace" }
      : action === "duplicate"
        ? { key: "d", code: "KeyD", ctrlKey: true }
        : { key: "ArrowDown", code: "ArrowDown", ctrlKey: true, shiftKey: true };
  const event = new KeyboardEvent("keydown", { ...options, bubbles: true, cancelable: true });
  act(() => target.dispatchEvent(event));
  act(() => target.dispatchEvent(new KeyboardEvent("keyup", { ...options, bubbles: true })));
  return event;
}
it.each(actions)("leaves the document unchanged for %s in an unrelated input", (action) => {
  act(() => root.render(<Controls action={action} />));
  act(() => input.focus());
  const before = editor.getJSON();
  const event = press(action, input);
  expect(editor.getJSON()).toEqual(before);
  expect(event.defaultPrevented).toBe(false);
});
it.each(actions)("keeps explicit %s menu actions available after editor blur", (action) => {
  act(() => root.render(<Controls action={action} />));
  act(() => input.focus());
  const before = editor.getJSON();
  act(() => expect(direct()).toBe(true));
  expect(editor.getJSON()).not.toEqual(before);
});

it.each(actions)("retains %s shortcuts for the focused editor", (action) => {
  act(() => root.render(<Controls action={action} />));
  act(() => editor.view.focus());
  expect(editor.isFocused).toBe(true);
  const before = editor.getJSON();
  press(action, editor.view.dom);
  expect(editor.getJSON()).not.toEqual(before);
});
