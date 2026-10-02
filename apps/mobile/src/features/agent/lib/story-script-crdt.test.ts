import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { Collaboration } from "@tiptap/extension-collaboration";
import { expect, it } from "vitest";
import * as Y from "yjs";
import { ScriptCrdt } from "../../../../script-editor/crdt";
const ids =
  (start = 1) =>
  () =>
    `00000000-0000-4000-8000-${String(start++).padStart(12, "0")}`;
function seed(engine: ScriptCrdt) {
  const p = new Y.XmlElement("paragraph"),
    text = new Y.XmlText();
  text.insert(0, "Script");
  p.insert(0, [text]);
  engine.doc.getXmlFragment("content").insert(0, [p]);
  return text;
}
const body = (engine: ScriptCrdt) => engine.doc.getXmlFragment("content").toString();
it("merges concurrent rich-text edits without dropping either author's content", () => {
  const mobile = new ScriptCrdt(ids()),
    web = new ScriptCrdt(ids(20));
  try {
    const text = seed(mobile);
    const initial = mobile.checkpoint();
    web.merge(initial.state, []);
    mobile.acknowledge(initial.pending[0]);
    text.insert(0, "Mobile ");
    const remoteText = (web.doc.getXmlFragment("content").get(0) as Y.XmlElement).get(
      0
    ) as Y.XmlText;
    remoteText.insert(remoteText.length, " Web");
    const a = mobile.checkpoint().pending[0],
      b = web.checkpoint().pending[0];
    mobile.merge(null, [b.yjsUpdateBase64]);
    web.merge(null, [a.yjsUpdateBase64]);
    expect(body(mobile)).toBe(body(web));
    expect(body(mobile)).toContain("Mobile Script Web");
    expect(mobile.checkpoint().pending).toEqual([a]);
  } finally {
    mobile.destroy();
    web.destroy();
  }
});
it("restores exact pending mutation IDs across restart, including deletion", () => {
  const first = new ScriptCrdt(ids());
  const text = seed(first);
  first.acknowledge(first.checkpoint().pending[0]);
  text.delete(0, 2);
  const checkpoint = first.checkpoint();
  first.destroy();
  const reopened = new ScriptCrdt(ids(20), checkpoint);
  try {
    expect(body(reopened)).toContain("ript");
    expect(reopened.checkpoint().pending).toEqual(checkpoint.pending);
    reopened.acknowledge(checkpoint.pending[0]);
    expect(reopened.checkpoint().pending).toEqual([]);
  } finally {
    reopened.destroy();
  }
});
it("a late receipt preserves edits made while the request was in flight", () => {
  const engine = new ScriptCrdt(ids());
  try {
    const text = seed(engine),
      first = engine.checkpoint().pending[0];
    text.insert(0, "New ");
    const newer = engine.checkpoint().pending[1];
    engine.acknowledge(first);
    expect(engine.checkpoint().pending).toEqual([newer]);
  } finally {
    engine.destroy();
  }
});
it("rejects mismatched receipts without clearing the journal", () => {
  const engine = new ScriptCrdt(ids());
  try {
    seed(engine);
    const before = engine.checkpoint();
    expect(() => engine.acknowledge({ ...before.pending[0], yjsUpdateBase64: "AAA=" })).toThrow(
      "does not match"
    );
    expect(engine.checkpoint().pending).toEqual(before.pending);
  } finally {
    engine.destroy();
  }
});
it("validates the entire remote batch before applying any part", () => {
  const local = new ScriptCrdt(ids()),
    remote = new ScriptCrdt(ids(20));
  try {
    seed(remote);
    const before = body(local);
    expect(() => local.merge(remote.checkpoint().state, ["////"])).toThrow();
    expect(body(local)).toBe(before);
    expect(local.checkpoint().pending).toEqual([]);
  } finally {
    local.destroy();
    remote.destroy();
  }
});
it("never returns mutable pending journal references", () => {
  const engine = new ScriptCrdt(ids());
  try {
    seed(engine);
    const checkpoint = engine.checkpoint();
    checkpoint.pending[0].clientKey = ids(50)();
    expect(engine.checkpoint().pending[0].clientKey).not.toBe(checkpoint.pending[0].clientKey);
  } finally {
    engine.destroy();
  }
});
it("rejects duplicate restored mutation IDs and use after close", () => {
  const engine = new ScriptCrdt(ids());
  seed(engine);
  const checkpoint = engine.checkpoint();
  expect(
    () =>
      new ScriptCrdt(ids(), {
        ...checkpoint,
        pending: [...checkpoint.pending, ...checkpoint.pending],
      })
  ).toThrow("Duplicate");
  engine.destroy();
  expect(() => engine.checkpoint()).toThrow("closed");
});

it("binds the official Tiptap rich-text schema and preserves formatting through restart", () => {
  const engine = new ScriptCrdt(ids());
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      Collaboration.configure({ document: engine.doc, field: "content" }),
    ],
  });
  let restored: ScriptCrdt | undefined, viewer: Editor | undefined;
  try {
    editor.commands.setContent({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Scene" }] },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Action", marks: [{ type: "bold" }] }],
        },
      ],
    });
    const saved = engine.checkpoint();
    expect(saved.pending.length).toBeGreaterThan(0);
    restored = new ScriptCrdt(ids(30), saved);
    viewer = new Editor({
      element: document.createElement("div"),
      extensions: [
        StarterKit.configure({ undoRedo: false }),
        Collaboration.configure({ document: restored.doc, field: "content" }),
      ],
    });
    expect(viewer.getJSON()).toEqual(editor.getJSON());
    expect(viewer.getHTML()).toContain("<strong>Action</strong>");
  } finally {
    viewer?.destroy();
    restored?.destroy();
    editor.destroy();
    engine.destroy();
  }
});
