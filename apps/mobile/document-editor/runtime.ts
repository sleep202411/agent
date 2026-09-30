// Bundled locally for the isolated editor WebView; never loaded from a CDN.
import { Editor, Extension, Node, mergeAttributes } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { TextAlign } from "@tiptap/extension-text-align";
import { TextStyle, Color } from "@tiptap/extension-text-style";
import { Highlight } from "@tiptap/extension-highlight";
import { Superscript } from "@tiptap/extension-superscript";
import { Subscript } from "@tiptap/extension-subscript";
import { UniqueID } from "@tiptap/extension-unique-id";
import { CrewProductionDocumentSchema } from "../src/features/services/production-document-schema";
import emojis from "../src/features/services/document-data/emoji.json";

const blocks = ["paragraph", "heading", "blockquote"];
const Metadata = Extension.create({
  name: "productionMetadata",
  addGlobalAttributes() {
    return [
      {
        types: [...blocks, "tableCell", "tableHeader"],
        attributes: {
          nodeTextAlign: {
            default: null,
            renderHTML: (a) => (a.nodeTextAlign ? { style: `text-align:${a.nodeTextAlign}` } : {}),
            parseHTML: (e) => e.style.textAlign || null,
          },
          nodeVerticalAlign: {
            default: null,
            renderHTML: (a) =>
              a.nodeVerticalAlign ? { style: `vertical-align:${a.nodeVerticalAlign}` } : {},
            parseHTML: (e) => e.style.verticalAlign || null,
          },
        },
      },
      {
        types: blocks,
        attributes: {
          indent: {
            default: 0,
            renderHTML: (a) => ({ style: `padding-inline-start:${a.indent * 24}px` }),
          },
        },
      },
      {
        types: [...blocks, "bulletList", "orderedList", "taskList", "tableCell", "tableHeader"],
        attributes: {
          backgroundColor: {
            default: null,
            renderHTML: (a) =>
              a.backgroundColor ? { style: `background-color:${a.backgroundColor}` } : {},
            parseHTML: (e) => e.style.backgroundColor || null,
          },
        },
      },
    ];
  },
});
const Emoji = Node.create({
  name: "emoji",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return { name: { default: null } };
  },
  parseHTML() {
    return [{ tag: "span[data-emoji]", getAttrs: (e) => ({ name: e.getAttribute("data-emoji") }) }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const name = String(node.attrs.name);
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-emoji": name }),
      Object.hasOwn(emojis, name) ? (emojis as Record<string, string>)[name] : `:${name}:`,
    ];
  },
});
export function editorExtensions() {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: false,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      },
    }),
    TableKit.configure({ table: { resizable: false } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TextAlign.configure({ types: ["paragraph", "heading"] }),
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    Superscript,
    Subscript,
    Metadata,
    Emoji,
    UniqueID.configure({
      types: [
        "paragraph",
        "heading",
        "blockquote",
        "bulletList",
        "orderedList",
        "taskList",
        "codeBlock",
        "table",
      ],
    }),
  ];
}
export function startEditor(
  root: HTMLElement,
  initial: unknown,
  labels: Record<string, string>,
  emit: (value: unknown) => void
) {
  const parsed = CrewProductionDocumentSchema.parse(initial);
  const status = root.querySelector<HTMLElement>("[data-status]")!;
  const toolbar = root.querySelector<HTMLElement>("[data-toolbar]")!;
  let saving = false;
  const editor = new Editor({
    element: root.querySelector<HTMLElement>("[data-editor]")!,
    extensions: editorExtensions(),
    content: parsed,
    enableContentCheck: true,
    editorProps: {
      handleDOMEvents: {
        click: (_view, event) => {
          if ((event.target as HTMLElement).closest("a")) {
            event.preventDefault();
            return true;
          }
          return false;
        },
      },
    },
    onUpdate: () => emit({ type: "dirty" }),
  });
  const buttons: HTMLButtonElement[] = [];
  const add = (key: string, run: () => void) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = labels[key] ?? key;
    button.setAttribute("aria-label", labels[key] ?? key);
    button.addEventListener("mousedown", (e) => e.preventDefault());
    button.onclick = () => {
      if (!saving) {
        status.textContent = "";
        run();
      }
    };
    toolbar.append(button);
    buttons.push(button);
  };
  const promptValue = (key: string, run: (value: string) => void) => {
    // Native JS prompts are not used: the input is keyboard-accessible on both platforms.
    const field = root.querySelector<HTMLInputElement>("[data-value]")!;
    field.hidden = false;
    field.placeholder = labels[key] ?? key;
    field.setAttribute("aria-label", labels[key] ?? key);
    field.value = "";
    const apply = root.querySelector<HTMLButtonElement>("[data-apply]")!;
    apply.hidden = false;
    apply.textContent = labels.apply;
    apply.onclick = () => {
      if (saving) return;
      run(field.value);
      field.hidden = true;
      apply.hidden = true;
    };
    field.focus();
  };
  add("undo", () => {
    editor.chain().focus().undo().run();
  });
  add("redo", () => {
    editor.chain().focus().redo().run();
  });
  add("paragraph", () => {
    editor.chain().focus().setParagraph().run();
  });
  for (const level of [1, 2, 3] as const)
    add(`heading${level}`, () => {
      editor.chain().focus().toggleHeading({ level }).run();
    });
  add("bold", () => {
    editor.chain().focus().toggleBold().run();
  });
  add("italic", () => {
    editor.chain().focus().toggleItalic().run();
  });
  add("underline", () => {
    editor.chain().focus().toggleUnderline().run();
  });
  add("strike", () => {
    editor.chain().focus().toggleStrike().run();
  });
  add("bulletList", () => {
    editor.chain().focus().toggleBulletList().run();
  });
  add("orderedList", () => {
    editor.chain().focus().toggleOrderedList().run();
  });
  add("taskList", () => {
    editor.chain().focus().toggleTaskList().run();
  });
  add("quote", () => {
    editor.chain().focus().toggleBlockquote().run();
  });
  add("code", () => {
    editor.chain().focus().toggleCode().run();
  });
  add("codeBlock", () => {
    editor.chain().focus().toggleCodeBlock().run();
  });
  add("rule", () => {
    editor.chain().focus().setHorizontalRule().run();
  });
  add("superscript", () => {
    editor.chain().focus().toggleSuperscript().run();
  });
  add("subscript", () => {
    editor.chain().focus().toggleSubscript().run();
  });
  for (const align of ["left", "center", "right", "justify"])
    add(align, () => {
      editor.chain().focus().setTextAlign(align).run();
      for (const type of [...blocks, "tableCell", "tableHeader"])
        if (editor.isActive(type)) editor.commands.updateAttributes(type, { nodeTextAlign: align });
    });
  for (const [key, delta] of [
    ["indent", 1],
    ["outdent", -1],
  ] as const)
    add(key, () => {
      editor.commands.focus();
      const item = editor.isActive("taskItem")
        ? "taskItem"
        : editor.isActive("listItem")
          ? "listItem"
          : null;
      if (item) {
        if (delta > 0) editor.commands.sinkListItem(item);
        else editor.commands.liftListItem(item);
        return;
      }
      for (const type of blocks)
        if (editor.isActive(type))
          editor.commands.updateAttributes(type, {
            indent: Math.max(
              0,
              Math.min(8, Number(editor.getAttributes(type).indent ?? 0) + delta)
            ),
          });
    });
  add("background", () =>
    promptValue("hexColor", (value) => {
      if (!/^#[0-9a-f]{6}$/i.test(value)) {
        status.textContent = labels.invalid;
        return;
      }
      editor.commands.focus();
      for (const type of [
        ...blocks,
        "bulletList",
        "orderedList",
        "taskList",
        "tableCell",
        "tableHeader",
      ])
        if (editor.isActive(type))
          editor.commands.updateAttributes(type, { backgroundColor: value });
    })
  );
  for (const align of ["top", "middle", "bottom"])
    add(align, () => {
      editor.commands.focus();
      for (const type of [...blocks, "tableCell", "tableHeader"])
        if (editor.isActive(type))
          editor.commands.updateAttributes(type, { nodeVerticalAlign: align });
    });
  add("link", () =>
    promptValue("linkUrl", (href) => {
      if (/^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(href) && !/[\u0000-\u0020\\]/.test(href))
        editor.chain().focus().setLink({ href }).run();
      else status.textContent = labels.invalid;
    })
  );
  add("unlink", () => {
    editor.chain().focus().unsetLink().run();
  });
  for (const kind of ["color", "highlight"] as const)
    add(kind, () =>
      promptValue("hexColor", (value) => {
        if (!/^#[0-9a-f]{6}$/i.test(value)) {
          status.textContent = labels.invalid;
          return;
        }
        if (kind === "color") editor.chain().focus().setColor(value).run();
        else editor.chain().focus().setHighlight({ color: value }).run();
      })
    );
  add("clearFormat", () => {
    editor.chain().focus().unsetAllMarks().run();
  });
  add("emoji", () =>
    promptValue("emojiName", (name) => {
      if (!Object.hasOwn(emojis, name)) {
        status.textContent = labels.invalid;
        return;
      }
      editor.chain().focus().insertContent({ type: "emoji", attrs: { name } }).run();
    })
  );
  add("table", () => {
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  });
  add("addRow", () => {
    editor.chain().focus().addRowAfter().run();
  });
  add("deleteRow", () => {
    editor.chain().focus().deleteRow().run();
  });
  add("addColumn", () => {
    editor.chain().focus().addColumnAfter().run();
  });
  add("deleteColumn", () => {
    editor.chain().focus().deleteColumn().run();
  });
  add("mergeCells", () => {
    editor.chain().focus().mergeCells().run();
  });
  add("splitCell", () => {
    editor.chain().focus().splitCell().run();
  });
  add("deleteTable", () => {
    editor.chain().focus().deleteTable().run();
  });
  const save = root.querySelector<HTMLButtonElement>("[data-save]")!;
  save.textContent = labels.save;
  save.onclick = () => {
    if (saving) return;
    const result = CrewProductionDocumentSchema.safeParse(editor.getJSON());
    if (!result.success) {
      status.textContent = labels.invalid;
      return;
    }
    saving = true;
    editor.setEditable(false);
    save.disabled = true;
    buttons.forEach((b) => (b.disabled = true));
    status.textContent = labels.saving;
    emit({ type: "save", document: result.data });
  };
  emit({ type: "ready" });
  return editor;
}
if (typeof document !== "undefined" && document.querySelector("[data-production-editor]")) {
  const emit = (value: unknown) => {
    const message = JSON.stringify(value);
    const native = (
      window as Window & { ReactNativeWebView?: { postMessage: (value: string) => void } }
    ).ReactNativeWebView;
    if (native) native.postMessage(message);
    else window.parent.postMessage(message, "*");
  };
  try {
    const init = JSON.parse(document.querySelector("[data-initial]")!.textContent!);
    startEditor(
      document.querySelector("[data-production-editor]")!,
      init.document,
      init.labels,
      emit
    );
  } catch {
    emit({ type: "error" });
  }
}
