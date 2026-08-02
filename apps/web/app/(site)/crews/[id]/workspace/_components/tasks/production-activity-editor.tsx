"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import type { JSONContent } from "@tiptap/core";
import { Placeholder } from "@tiptap/extensions";
import { UniqueID } from "@tiptap/extension-unique-id";
import { EditorContent, EditorContext, useEditor } from "@tiptap/react";
import { renderToReactElement } from "@tiptap/static-renderer/pm/react";
import { StarterKit } from "@tiptap/starter-kit";

import { SlashDropdownMenu } from "@/components/tiptap-ui/slash-dropdown-menu";
import type { SlashMenuConfig } from "@/components/tiptap-ui/slash-dropdown-menu/use-slash-dropdown-menu";
import { NotionToolbarFloating } from "@/components/tiptap-templates/notion-like/notion-like-editor-toolbar-floating";
import type { CrewProductionDocument } from "@/app/(site)/crews/_hooks/use-crew";
import { useTranslations } from "@/src/i18n/i18n";

import "@/components/tiptap-node/blockquote-node/blockquote-node.scss";
import "@/components/tiptap-node/code-block-node/code-block-node.scss";
import "@/components/tiptap-node/heading-node/heading-node.scss";
import "@/components/tiptap-node/list-node/list-node.scss";
import "@/components/tiptap-node/paragraph-node/paragraph-node.scss";
import "./production-activity-editor.scss";

export const EMPTY_PRODUCTION_ACTIVITY_DOCUMENT: CrewProductionDocument = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

const ACTIVITY_SLASH_ITEMS: NonNullable<SlashMenuConfig["enabledItems"]> = [
  "text",
  "heading_1",
  "heading_2",
  "heading_3",
  "bullet_list",
  "ordered_list",
  "quote",
  "code_block",
];

function createActivityExtensions() {
  return [
    StarterKit.configure({
      horizontalRule: false,
      link: {
        openOnClick: false,
        HTMLAttributes: {
          rel: "noopener noreferrer nofollow",
          target: "_blank",
        },
      },
    }),
    UniqueID.configure({
      types: ["paragraph", "heading", "blockquote", "bulletList", "orderedList", "codeBlock"],
    }),
  ];
}

export function ProductionActivityEditor({
  value,
  placeholder,
  ariaLabel,
  onChange,
  onSubmit,
  onFocusChange,
}: {
  value: CrewProductionDocument;
  placeholder: string;
  ariaLabel: string;
  onChange: (document: CrewProductionDocument, plainText: string) => void;
  onSubmit: () => void;
  onFocusChange?: (focused: boolean) => void;
}) {
  const t = useTranslations("crewProduction");
  const callbacks = useRef({ onChange, onSubmit, onFocusChange });

  useEffect(() => {
    callbacks.current = { onChange, onSubmit, onFocusChange };
  }, [onChange, onSubmit, onFocusChange]);

  const extensions = useMemo(
    () => [
      ...createActivityExtensions(),
      Placeholder.configure({
        placeholder,
        emptyEditorClass: "is-editor-empty",
        emptyNodeClass: "is-empty",
      }),
    ],
    [placeholder]
  );

  const slashMenuConfig = useMemo<SlashMenuConfig>(
    () => ({
      enabledItems: ACTIVITY_SLASH_ITEMS,
      decorationContent: t("slashFilter"),
      labels: {
        text: slashLabel(t, "paragraph"),
        heading_1: slashLabel(t, "heading1"),
        heading_2: slashLabel(t, "heading2"),
        heading_3: slashLabel(t, "heading3"),
        bullet_list: slashLabel(t, "bulletList"),
        ordered_list: slashLabel(t, "orderedList"),
        quote: slashLabel(t, "blockquote"),
        code_block: slashLabel(t, "codeBlock"),
      },
    }),
    [t]
  );

  const editor = useEditor({
    immediatelyRender: false,
    content: value,
    extensions,
    editorProps: {
      attributes: {
        class: "production-activity-prosemirror",
        role: "textbox",
        "aria-label": ariaLabel,
        "aria-multiline": "true",
      },
      handleKeyDown: (_view, event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          callbacks.current.onSubmit();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: instance, transaction }) => {
      if (!transaction.docChanged || instance.view.composing) return;
      callbacks.current.onChange(
        instance.getJSON() as CrewProductionDocument,
        instance.getText({ blockSeparator: "\n" }).trim()
      );
    },
    onFocus: () => callbacks.current.onFocusChange?.(true),
    onBlur: () => callbacks.current.onFocusChange?.(false),
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (JSON.stringify(editor.getJSON()) === JSON.stringify(value)) return;
    editor.commands.setContent(value, { emitUpdate: false, errorOnInvalidContent: true });
  }, [editor, value]);

  if (!editor) return <div className="min-h-[110px]" aria-hidden="true" />;

  return (
    <EditorContext.Provider value={{ editor }}>
      <EditorContent editor={editor} className="production-activity-editor">
        <SlashDropdownMenu config={slashMenuConfig} />
        <NotionToolbarFloating />
      </EditorContent>
    </EditorContext.Provider>
  );
}

export function ProductionActivityRichText({
  content,
  className,
}: {
  content: CrewProductionDocument;
  className?: string;
}) {
  const rendered = renderToReactElement({
    extensions: createActivityExtensions(),
    content: content as JSONContent,
  }) as ReactNode;

  return <div className={className}>{rendered}</div>;
}

function slashLabel(t: ReturnType<typeof useTranslations>, key: string) {
  return {
    title: t(`blocks.${key}`),
    subtext: t(`blockDescriptions.${key}`),
    group: t("blockGroups.content"),
  };
}
