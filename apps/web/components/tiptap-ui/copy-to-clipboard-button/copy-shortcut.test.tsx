import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/react";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { useCopyToClipboard } from "./use-copy-to-clipboard";
const h = vi.hoisted(() => ({
  shortcut: undefined as undefined | ((event: KeyboardEvent) => void),
}));
vi.mock("react-hotkeys-hook", () => ({
  useHotkeys: (_keys: string, callback: (e: KeyboardEvent) => void) => {
    h.shortcut = callback;
  },
}));
vi.mock("@/hooks/use-tiptap-editor", () => ({ useTiptapEditor: (editor: Editor) => ({ editor }) }));
vi.mock("@/hooks/use-is-breakpoint", () => ({ useIsBreakpoint: () => false }));
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.innerHTML = "";
  delete (navigator as { clipboard?: unknown }).clipboard;
});
it.each([false, true])("respects editor focus for copy shortcuts (%s)", async (focused) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const schema = new Schema({
    nodes: {
      doc: { content: "paragraph+" },
      paragraph: { content: "text*" },
      text: { group: "inline" },
    },
  });
  const doc = schema.node("doc", null, [schema.node("paragraph", null, schema.text("hello"))]);
  const state = EditorState.create({ doc, selection: TextSelection.create(doc, 2, 5) });
  const editor = {
    state,
    isEditable: true,
    isFocused: focused,
    isActive: () => false,
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as Editor;
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  function Host() {
    useCopyToClipboard({ editor, copyWithFormatting: false });
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(<Host />));
  const event = new KeyboardEvent("keydown", { key: "c", ctrlKey: true, cancelable: true });
  await act(async () => h.shortcut!(event));
  expect(event.defaultPrevented).toBe(focused);
  expect(writeText).toHaveBeenCalledTimes(focused ? 1 : 0);
  if (focused) expect(writeText).toHaveBeenCalledWith("ell");
});
