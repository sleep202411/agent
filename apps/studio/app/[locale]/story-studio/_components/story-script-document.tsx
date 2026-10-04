"use client";

import { DocumentSyncError } from "@/components/document-sync-error";
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Collaboration from "@tiptap/extension-collaboration";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useTranslations } from "next-intl";
import type * as Y from "yjs";
import { useAuth } from "@/app/_components/auth-provider";
import { toCollabUser } from "@/lib/collab/collab-user";
import { useStoryScriptDocument } from "../_lib/use-story-documents";
import { RICH_TEXT_DOC_ROOT_SCHEMA } from "@/lib/collab/protocol";
import { useCollabDoc } from "@/lib/collab/use-collab-doc";
import { getStoryWorkbench } from "@/lib/story-projects-api";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";

/**
 * Script step — free-form rich-text writing. The script is the pipeline's
 * SOURCE TEXT (a collaborative Tiptap document over Yjs), not a projection of
 * the tree: the authoring pipeline reads it downstream to generate chapters
 * and nodes. Markdown shortcuts (`# `, `**`, `- ` …) come from StarterKit's
 * input rules.
 */
export function StoryScriptDocument({ projectId }: { projectId: string }) {
  const t = useTranslations("storyStudio");
  const projectT = useTranslations("project");
  const { user } = useAuth();
  const collabUser = useMemo(() => toCollabUser(user), [user]);
  const activeChapterId = useStoryProjectUiStore((state) => state.activeChapterId);

  const workbenchQuery = useQuery({
    queryKey: ["story-studio", "script-workbench", projectId, activeChapterId, user?.id ?? null],
    queryFn: ({ signal }) => getStoryWorkbench(projectId, activeChapterId as string, signal),
    enabled: Boolean(projectId && activeChapterId && user),
    retry: false,
  });
  const canEdit = workbenchQuery.data?.project.capabilities.includes("story.edit") ?? false;

  const documentQuery = useStoryScriptDocument(projectId, activeChapterId);
  const {
    doc,
    status: connStatus,
    error: syncError,
    retry: retrySync,
  } = useCollabDoc(documentQuery.data?.id ?? null, collabUser, RICH_TEXT_DOC_ROOT_SCHEMA);

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      <DocumentSyncError
        error={syncError}
        retry={retrySync}
        retrying={connStatus === "connecting"}
        className="mx-6 mt-3"
      />
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {documentQuery.isError ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-white/72">{projectT("documentOpenError")}</p>
          </div>
        ) : doc ? (
          <ScriptEditor
            key={documentQuery.data?.id}
            doc={doc}
            canEdit={canEdit}
            placeholder={t("scriptDoc.placeholder")}
          />
        ) : null}
        {doc && !syncError && connStatus !== "synced" && (
          <span className="pointer-events-none absolute right-6 bottom-4 text-xs text-white/62">
            {connStatus === "offline" ? projectT("offlineSaved") : projectT("connecting")}
          </span>
        )}
      </div>
    </main>
  );
}

function ScriptEditor({
  doc,
  canEdit,
  placeholder,
}: {
  doc: Y.Doc;
  canEdit: boolean;
  placeholder: string;
}) {
  const editor = useEditor(
    {
      extensions: [
        // Collaboration owns undo/redo (Yjs undo manager) — StarterKit's own
        // history must stay off or the two fight over the same keystrokes.
        StarterKit.configure({ undoRedo: false }),
        Placeholder.configure({ placeholder }),
        Collaboration.configure({ document: doc, field: "content" }),
      ],
      editable: canEdit,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class: [
            "outline-none min-h-full text-[15px] leading-relaxed text-white/90",
            "[&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:tracking-[-0.02em] [&_h1]:mt-6 [&_h1]:mb-2",
            "[&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-[-0.015em] [&_h2]:mt-5 [&_h2]:mb-1.5",
            "[&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-1",
            "[&_p]:my-1.5 [&_blockquote]:border-l-2 [&_blockquote]:border-white/20 [&_blockquote]:pl-4 [&_blockquote]:text-white/62",
            "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5",
            "[&_code]:rounded [&_code]:bg-white/[0.08] [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px]",
            "[&_hr]:my-6 [&_hr]:border-white/10",
            "[&_.is-editor-empty:first-child]:before:pointer-events-none [&_.is-editor-empty:first-child]:before:float-left [&_.is-editor-empty:first-child]:before:h-0 [&_.is-editor-empty:first-child]:before:text-white/62 [&_.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]",
          ].join(" "),
        },
      },
    },
    [doc]
  );

  useEffect(() => {
    editor?.setEditable(canEdit);
  }, [editor, canEdit]);

  return (
    <div className="mx-auto h-full w-full max-w-3xl cursor-text px-6 pt-8 pb-16">
      <EditorContent editor={editor} className="h-full" />
    </div>
  );
}
