import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLinkHandler } from "./use-link-popover";

let editor: Editor;
let root: Root;
let container: HTMLDivElement;
let handler: ReturnType<typeof useLinkHandler>;
const onSetLink = vi.fn();

function Controls() {
  const value = useLinkHandler({ editor, onSetLink });
  useLayoutEffect(() => {
    handler = value;
  });
  return null;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  onSetLink.mockClear();
  editor = new Editor({
    extensions: [StarterKit.configure({ link: { openOnClick: false } })],
    content: '<p>See <a href="https://old.example">project brief</a> today</p>',
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<Controls />));
});

afterEach(() => {
  act(() => root.unmount());
  editor.destroy();
  container.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
});

function applyLink(from: number, to = from) {
  act(() => editor.commands.setTextSelection({ from, to }));
  act(() => handler.setUrl("https://new.example"));
  act(() => handler.setLink());
}

describe("document link editing", () => {
  it("preserves the existing label when changing its URL from a collapsed caret", () => {
    applyLink(8);
    expect(editor.getText()).toBe("See project brief today");
    expect(editor.getHTML()).toContain('href="https://new.example"');
    expect(editor.getHTML()).not.toContain("old.example");
    expect(onSetLink).toHaveBeenCalledOnce();
  });

  it("preserves linked text when the link is selected", () => {
    applyLink(5, 18);
    expect(editor.getText()).toBe("See project brief today");
    expect(editor.getHTML()).toContain('href="https://new.example"');
  });

  it("inserts a URL as text when adding a new link at an unlinked caret", () => {
    act(() =>
      editor.commands.setContent({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Hello " }] }],
      })
    );
    applyLink(7);
    expect(editor.getText()).toBe("Hello https://new.example");
    expect(editor.getHTML()).toContain('href="https://new.example"');
  });

  it("links selected plain text without replacing its label", () => {
    act(() => editor.commands.setContent("<p>project brief</p>"));
    applyLink(1, 14);
    expect(editor.getText()).toBe("project brief");
    expect(editor.getHTML()).toContain('href="https://new.example"');
  });
});
