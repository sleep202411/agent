import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { Collaboration } from "@tiptap/extension-collaboration";
import { ScriptCrdt } from "./crdt";
import { scriptHostMessage, type ScriptEditorMessage } from "./protocol";
import { z } from "zod";

const initial = z
  .object({ sessionId: z.string().uuid(), labels: z.record(z.string()) })
  .parse(JSON.parse(document.querySelector("[data-initial]")!.textContent!));
const labels = initial.labels;
const host = window as typeof window & {
  ReactNativeWebView?: { postMessage: (raw: string) => void };
  __fizzScriptReceive?: (raw: string) => void;
};
const send = (
  message:
    | Omit<ScriptEditorMessage, "sessionId">
    | { type: "checkpoint"; revision: number; checkpoint: ReturnType<ScriptCrdt["checkpoint"]> }
    | { type: "error"; message: string }
) => {
  const raw = JSON.stringify({ ...message, sessionId: initial.sessionId });
  if (host.ReactNativeWebView) host.ReactNativeWebView.postMessage(raw);
  else parent.postMessage(raw, "*");
};
let engine: ScriptCrdt | undefined,
  editor: Editor | undefined,
  editable = false,
  failed = false,
  hostBlocked = false,
  revision = 0,
  queued = false;
const status = document.querySelector<HTMLElement>("[data-status]")!;
const toolbar = document.querySelector<HTMLElement>("[data-toolbar]")!;
const setEditable = () => {
  editor?.setEditable(editable && !failed && !hostBlocked);
  for (const button of toolbar.querySelectorAll("button"))
    button.disabled = !editable || failed || hostBlocked;
};
const fail = (error: unknown) => {
  failed = true;
  setEditable();
  const message = error instanceof Error ? error.message : String(error);
  status.textContent = message;
  send({ type: "error", message });
};
const publish = () => {
  if (queued || !engine || failed) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    if (!engine || failed) return;
    try {
      status.textContent = labels.saving;
      send({ type: "checkpoint", revision: ++revision, checkpoint: engine.checkpoint() });
    } catch (e) {
      fail(e);
    }
  });
};
function setup() {
  if (!engine) return;
  engine.doc.on("update", publish);
  editor = new Editor({
    element: document.querySelector<HTMLElement>("[data-editor]")!,
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      Collaboration.configure({ document: engine.doc, field: "content" }),
    ],
    editable,
    editorProps: {
      attributes: { "aria-label": labels.editor },
      handleClick: (_view, _pos, event) => {
        if ((event.target as HTMLElement)?.closest("a")) {
          event.preventDefault();
          return true;
        }
        return false;
      },
    },
  });
  const commands: [string, () => void][] = [
    [
      "bold",
      () => {
        editor!.chain().focus().toggleBold().run();
      },
    ],
    [
      "italic",
      () => {
        editor!.chain().focus().toggleItalic().run();
      },
    ],
    [
      "heading",
      () => {
        editor!.chain().focus().toggleHeading({ level: 2 }).run();
      },
    ],
    [
      "bulletList",
      () => {
        editor!.chain().focus().toggleBulletList().run();
      },
    ],
    [
      "orderedList",
      () => {
        editor!.chain().focus().toggleOrderedList().run();
      },
    ],
    [
      "quote",
      () => {
        editor!.chain().focus().toggleBlockquote().run();
      },
    ],
    [
      "undo",
      () => {
        editor!.commands.undo();
      },
    ],
    [
      "redo",
      () => {
        editor!.commands.redo();
      },
    ],
  ];
  for (const [key, action] of commands) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = labels[key];
    button.onclick = () => {
      if (editable && !failed && !hostBlocked) action();
    };
    toolbar.append(button);
  }
  setEditable();
  publish();
}
host.__fizzScriptReceive = (raw) => {
  try {
    const message = scriptHostMessage.parse(JSON.parse(raw));
    if (message.sessionId !== initial.sessionId) return;
    if (message.type === "init") {
      if (engine) return;
      engine = new ScriptCrdt(() => {
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      }, message.checkpoint);
      engine.merge(message.snapshot, message.updates);
      editable = message.editable;
      setup();
      return;
    }
    if (!engine) return;
    switch (message.type) {
      case "remote":
        engine.merge(message.snapshot, message.updates);
        break;
      case "ack":
        engine.acknowledge(message.edit);
        publish();
        break;
      case "editable":
        editable = message.value;
        setEditable();
        break;
      case "persisted":
        if (message.revision === revision && !failed) {
          hostBlocked = false;
          setEditable();
          status.textContent = engine.checkpoint().pending.length ? labels.pending : labels.synced;
        }
        break;
      case "hostError":
        hostBlocked = true;
        setEditable();
        status.textContent = message.message;
        break;
    }
  } catch (e) {
    fail(e);
  }
};
window.addEventListener("message", (event) => {
  if (event.source === parent && typeof event.data === "string")
    host.__fizzScriptReceive?.(event.data);
});
window.addEventListener("pagehide", () => {
  editor?.destroy();
  engine?.destroy();
  engine = undefined;
});
send({ type: "ready" });
