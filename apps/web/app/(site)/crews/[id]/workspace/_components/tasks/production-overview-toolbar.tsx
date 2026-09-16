"use client";

import { type Editor, useEditorState } from "@tiptap/react";
import {
  IconBold,
  IconItalic,
  IconH2,
  IconList,
  IconListNumbers,
  IconCheckbox,
  IconQuote,
  IconArrowBackUp,
  IconArrowForwardUp,
} from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";

export function ProductionOverviewToolbar({ editor }: { editor: Editor }) {
  const t = useTranslations("crewProduction");
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      editable: current.isEditable,
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      heading: current.isActive("heading", { level: 2 }),
      bulletList: current.isActive("bulletList"),
      orderedList: current.isActive("orderedList"),
      checklist: current.isActive("taskList"),
      quote: current.isActive("blockquote"),
      undo: current.can().undo(),
      redo: current.can().redo(),
    }),
  });
  if (!state.editable) return null;
  const actions = [
    { key: "bold", icon: IconBold, run: () => editor.chain().focus().toggleBold().run() },
    { key: "italic", icon: IconItalic, run: () => editor.chain().focus().toggleItalic().run() },
    {
      key: "heading",
      icon: IconH2,
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      key: "bulletList",
      icon: IconList,
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      key: "orderedList",
      icon: IconListNumbers,
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      key: "checklist",
      icon: IconCheckbox,
      run: () => editor.chain().focus().toggleTaskList().run(),
    },
    { key: "quote", icon: IconQuote, run: () => editor.chain().focus().toggleBlockquote().run() },
    { key: "undo", icon: IconArrowBackUp, run: () => editor.chain().focus().undo().run() },
    { key: "redo", icon: IconArrowForwardUp, run: () => editor.chain().focus().redo().run() },
  ] as const;
  return (
    <div className="mx-7 mb-4 sm:mx-12 lg:mx-[72px]">
      <div
        role="group"
        aria-label={t("formatting.label")}
        className="flex flex-wrap gap-1 rounded-lg bg-white/[0.04] p-1"
      >
        {actions.map(({ key, icon: Icon, run }) => (
          <button
            key={key}
            type="button"
            title={t(`formatting.${key}`)}
            aria-label={t(`formatting.${key}`)}
            aria-pressed={key === "undo" || key === "redo" ? undefined : state[key]}
            disabled={(key === "undo" || key === "redo") && !state[key]}
            onMouseDown={(event) => event.preventDefault()}
            onClick={run}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-2 text-sm text-[#d8dae0] hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-35 aria-pressed:bg-white/15"
          >
            <Icon className="size-4" />
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs leading-5 text-[#a7abb2]">{t("formatting.hint")}</p>
    </div>
  );
}
