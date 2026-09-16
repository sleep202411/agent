import { describe, expect, it, vi } from "vitest";
import { Schema, DOMSerializer } from "@tiptap/pm/model";
import { EditorState, TextSelection, NodeSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { extractContent } from "./use-copy-to-clipboard";
vi.mock("@/hooks/use-tiptap-editor", () => ({ useTiptapEditor: vi.fn() }));
vi.mock("@/hooks/use-is-breakpoint", () => ({ useIsBreakpoint: vi.fn() }));
const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*", toDOM: () => ["p", 0] },
    text: { group: "inline" },
  },
});
const doc = schema.node("doc", null, [
  schema.node("paragraph", null, schema.text("hello")),
  schema.node("paragraph", null, schema.text("world")),
]);
function editor(from: number, to = from, node = false): Editor {
  const selection = node ? NodeSelection.create(doc, from) : TextSelection.create(doc, from, to);
  return {
    state: EditorState.create({ doc, selection }),
    view: {
      serializeForClipboard: (slice: {
        content: Parameters<DOMSerializer["serializeFragment"]>[0];
      }) => {
        const dom = document.createElement("div");
        dom.append(DOMSerializer.fromSchema(schema).serializeFragment(slice.content));
        return { dom };
      },
    },
  } as unknown as Editor;
}
describe("editor clipboard selection", () => {
  it("copies only selected text inside a paragraph", () => {
    expect(extractContent(editor(2, 5), false)).toEqual({
      textContent: "ell",
      htmlContent: undefined,
    });
  });
  it("preserves a selection spanning paragraphs", () => {
    const result = extractContent(editor(4, 11));
    expect(result.textContent).toBe("lo\nwor");
    expect(result.htmlContent).toBe("<p>lo</p><p>wor</p>");
  });
  it("preserves whole-block copy for a collapsed cursor", () => {
    expect(extractContent(editor(2)).textContent).toBe("hello");
  });
  it("preserves whole-node selections", () => {
    expect(extractContent(editor(0, 0, true)).textContent).toBe("hello");
  });
});
