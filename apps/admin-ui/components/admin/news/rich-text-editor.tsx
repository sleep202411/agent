"use client";

import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import {
  IconBlockquote,
  IconBold,
  IconCode,
  IconH2,
  IconH3,
  IconItalic,
  IconLink,
  IconList,
  IconListNumbers,
  IconStrikethrough,
  type Icon,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";

// tiptap-markdown adds `markdown` to editor storage at runtime but does not
// augment the @tiptap/core Storage type, so read it through this shape.
type MarkdownStorage = { markdown: { getMarkdown: () => string } };

function getMarkdown(editor: Editor): string {
  return (editor.storage as unknown as MarkdownStorage).markdown.getMarkdown();
}

/**
 * WYSIWYG rich-text editor (TipTap v3) that reads and writes **Markdown**, so
 * the stored body stays compatible with the public web renderer (react-markdown
 * + remark-gfm). StarterKit already bundles link/underline; we only add the
 * placeholder + markdown serialization.
 *
 * The editor is uncontrolled after mount — the parent re-keys it per locale to
 * load that locale's markdown (see news-editor.tsx) instead of feeding `value`
 * back on every keystroke.
 */
export function RichTextEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
}) {
  const editor = useEditor({
    immediatelyRender: false, // required under Next SSR to avoid hydration mismatch
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Placeholder.configure({ placeholder: placeholder ?? "正文内容……" }),
      Markdown.configure({ html: false, transformPastedText: true, linkify: true }),
    ],
    content: value,
    editorProps: {
      attributes: { class: "min-h-[280px] px-3.5 py-3 focus:outline-none" },
    },
    onUpdate: ({ editor }) => onChange(getMarkdown(editor)),
  });

  if (!editor) {
    return <div className="news-rte min-h-[320px] rounded-lg border border-slate-200 bg-white" />;
  }

  return (
    <div className="news-rte overflow-hidden rounded-lg border border-slate-200 bg-white focus-within:border-slate-300">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const setLink = () => {
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("链接地址", previous ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-slate-50/70 px-2 py-1.5">
      <Btn
        icon={IconBold}
        label="加粗"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      />
      <Btn
        icon={IconItalic}
        label="斜体"
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      />
      <Btn
        icon={IconStrikethrough}
        label="删除线"
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      />
      <Divider />
      <Btn
        icon={IconH2}
        label="标题 2"
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      />
      <Btn
        icon={IconH3}
        label="标题 3"
        active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      />
      <Divider />
      <Btn
        icon={IconList}
        label="无序列表"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      />
      <Btn
        icon={IconListNumbers}
        label="有序列表"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      />
      <Btn
        icon={IconBlockquote}
        label="引用"
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      />
      <Btn
        icon={IconCode}
        label="代码"
        active={editor.isActive("codeBlock")}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      />
      <Divider />
      <Btn icon={IconLink} label="链接" active={editor.isActive("link")} onClick={setLink} />
    </div>
  );
}

function Btn({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: Icon;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        "grid size-7 place-items-center rounded-md transition",
        active
          ? "bg-slate-900 text-white"
          : "text-slate-500 hover:bg-slate-200/70 hover:text-slate-900"
      )}
    >
      <Icon className="size-4" stroke={1.8} />
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-4 w-px bg-slate-200" />;
}
