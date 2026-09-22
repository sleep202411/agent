import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/hooks/use-tiptap-editor", () => ({ useTiptapEditor: (editor: Editor) => ({ editor }) }));
import { useScrollToHash } from "./use-scroll-to-hash";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*", attrs: { "data-id": { default: null } }, toDOM: () => ["p", 0] },
    text: { group: "inline" },
  },
});
function fixture() {
  const doc = schema.node("doc", null, [
    schema.node("paragraph", { "data-id": "intro" }, schema.text("Introduction")),
  ]);
  const scroll = vi.fn();
  const dispatch = vi.fn();
  const nodeDOM = vi.fn(() => ({ scrollIntoView: scroll }));
  const editor = {
    state: EditorState.create({ doc }),
    isDestroyed: false,
    extensionManager: { extensions: [{ name: "uniqueID", options: { attributeName: "data-id" } }] },
    view: { dispatch, nodeDOM },
  } as unknown as Editor;
  return { editor, dispatch, nodeDOM, scroll };
}
function Harness({ editor }: { editor: Editor }) {
  useScrollToHash({ editor });
  return null;
}
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  window.history.replaceState(null, "", "/en-US/crews?crew=test#intro");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
});
it("does not select or scroll a document after its editor leaves", () => {
  const f = fixture();
  act(() => root.render(<Harness editor={f.editor} />));
  act(() => root.render(null));
  act(() => vi.runAllTimers());
  expect(f.dispatch).not.toHaveBeenCalled();
  expect(f.scroll).not.toHaveBeenCalled();
});
it("cancels the deferred DOM lookup when leaving after selection", () => {
  const f = fixture();
  act(() => root.render(<Harness editor={f.editor} />));
  act(() => vi.advanceTimersByTime(500));
  expect(f.dispatch).toHaveBeenCalledTimes(1);
  act(() => root.render(null));
  act(() => vi.runAllTimers());
  expect(f.nodeDOM).not.toHaveBeenCalled();
});
it("does not run an older hash after the user navigates to a new target", () => {
  const f = fixture();
  act(() => root.render(<Harness editor={f.editor} />));
  window.history.replaceState(null, "", "/en-US/crews?crew=test#other");
  act(() => window.dispatchEvent(new Event("hashchange")));
  act(() => vi.runAllTimers());
  expect(f.dispatch).not.toHaveBeenCalled();
});
it("resolves the same anchor for a replacement editor", () => {
  const first = fixture(),
    second = fixture();
  act(() => root.render(<Harness editor={first.editor} />));
  act(() => vi.runAllTimers());
  expect(first.scroll).toHaveBeenCalledTimes(1);
  act(() => root.render(<Harness editor={second.editor} />));
  act(() => vi.runAllTimers());
  expect(second.scroll).toHaveBeenCalledTimes(1);
});
it("selects and scrolls the active document", () => {
  const f = fixture();
  act(() => root.render(<Harness editor={f.editor} />));
  act(() => vi.runAllTimers());
  expect(f.dispatch).toHaveBeenCalledTimes(1);
  expect(f.scroll).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
});

it("retains navigation after Strict Mode effect replay", () => {
  const f = fixture();
  act(() =>
    root.render(
      <React.StrictMode>
        <Harness editor={f.editor} />
      </React.StrictMode>
    )
  );
  act(() => vi.runAllTimers());
  expect(f.dispatch).toHaveBeenCalledTimes(1);
  expect(f.scroll).toHaveBeenCalledTimes(1);
});
