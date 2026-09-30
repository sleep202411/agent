import { expect, it } from "vitest";
import { documentEditorHtml, editorMessage } from "./production-document-editor-bridge";
const document = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      attrs: { id: "11111111-1111-4111-8111-111111111111" },
      content: [{ type: "text", text: "</script><img src=x onerror=alert(1)>" }],
    },
  ],
};
it("escapes initialization data and runs only the bundled editor script", () => {
  const html = documentEditorHtml(document, { format: "<img>", save: "Save" });
  expect(html).not.toContain("<img src=x");
  expect(html).toContain("\\u003c/script>");
  expect(html).toContain("default-src");
  expect(html).not.toContain('src="https://');
});
it.each([
  null,
  "{}",
  '{"type":"save","document":{}}',
  '{"type":"ready","url":"x"}',
  "x".repeat(2100001),
])("rejects untrusted bridge shape %j", (raw) => {
  expect(editorMessage(raw)).toBeNull();
});
it("validates canonical snapshot messages", () => {
  expect(editorMessage(JSON.stringify({ type: "save", document }))).toEqual({
    type: "save",
    document,
  });
});

it("boots the committed offline bundle and emits a validated save snapshot", () => {
  const raw = documentEditorHtml(
    {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "11111111-1111-4111-8111-111111111111" },
          content: [{ type: "text", text: "Offline editor" }],
        },
      ],
    },
    { format: "Format", save: "Save", saving: "Saving" }
  );
  const parsed = new DOMParser().parseFromString(raw, "text/html");
  const root = globalThis.document.createElement("div");
  root.innerHTML = parsed.body.innerHTML;
  globalThis.document.body.append(root);
  const messages: string[] = [];
  const nativeWindow = window as Window & {
    ReactNativeWebView?: { postMessage: (v: string) => void };
  };
  nativeWindow.ReactNativeWebView = { postMessage: (value) => messages.push(value) };
  try {
    const script = root.querySelector<HTMLScriptElement>('script[nonce="editor"]')!;
    new Function(script.textContent!)();
    expect(messages.map(editorMessage)).toContainEqual({ type: "ready" });
    root.querySelector<HTMLButtonElement>("[data-save]")!.click();
    expect(messages.map(editorMessage).some((value) => value?.type === "save")).toBe(true);
  } finally {
    delete nativeWindow.ReactNativeWebView;
    root.remove();
  }
});
