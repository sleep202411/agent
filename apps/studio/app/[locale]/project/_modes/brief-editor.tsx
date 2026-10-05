"use client";

import { DocumentSyncError } from "@/components/document-sync-error";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type * as Y from "yjs";
import { useAuth } from "@/app/_components/auth-provider";
import { useProjectContext } from "@/app/[locale]/project/_components/project-context";
import { useModeDocument } from "@/lib/collab/use-mode-document";
import { useCollabDoc } from "@/lib/collab/use-collab-doc";
import { TEXT_DOC_ROOT_SCHEMA } from "@/lib/collab/protocol";
import { toCollabUser } from "@/lib/collab/collab-user";

/** Transaction origin marking this client's own keystrokes (skipped on observe). */
const LOCAL_EDIT = Symbol("brief-local-edit");

/**
 * Apply the minimal prefix/suffix diff of `oldStr`→`next` onto a Y.Text under
 * `origin` — so a local keystroke edits only the changed span (concurrent peer
 * edits merge) instead of replacing the whole body.
 */
function applyTextDiff(ytext: Y.Text, oldStr: string, next: string, origin: unknown): void {
  if (oldStr === next) return;
  let start = 0;
  const minLen = Math.min(oldStr.length, next.length);
  while (start < minLen && oldStr[start] === next[start]) start += 1;
  let oldEnd = oldStr.length;
  let nextEnd = next.length;
  while (oldEnd > start && nextEnd > start && oldStr[oldEnd - 1] === next[nextEnd - 1]) {
    oldEnd -= 1;
    nextEnd -= 1;
  }
  const removed = oldEnd - start;
  const inserted = next.slice(start, nextEnd);
  ytext.doc?.transact(() => {
    if (removed > 0) ytext.delete(start, removed);
    if (inserted) ytext.insert(start, inserted);
  }, origin);
}

/**
 * Brief mode editor — a collaborative plain-text document over a Y.Text body.
 * Proves the multi-mode collab spine end to end: a second root schema + a second
 * document type, sharing the canvas's provider / sync / autosave machinery.
 * (Rich text + @mentions are deferred; this is the text-mode foundation.)
 */
export function BriefEditor() {
  const t = useTranslations("project");
  const common = useTranslations("common");
  const { projectId, canEdit } = useProjectContext();
  const { user } = useAuth();
  const collabUser = useMemo(() => toCollabUser(user), [user]);
  const {
    documentId,
    status: docStatus,
    error,
    retry,
    retrying,
  } = useModeDocument(projectId, "brief");
  const {
    doc,
    status: connStatus,
    error: syncError,
    retry: retrySync,
  } = useCollabDoc(documentId, collabUser, TEXT_DOC_ROOT_SCHEMA);

  const [value, setValue] = useState("");
  const ytextRef = useRef<Y.Text | null>(null);

  useEffect(() => {
    if (!doc) {
      ytextRef.current = null;
      return;
    }
    const ytext = doc.getText("content");
    ytextRef.current = ytext;
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setValue(ytext.toString());
    const observer = (_event: Y.YTextEvent, tx: Y.Transaction) => {
      // Our own edit is already in the textarea; re-syncing would move the caret.
      if (tx.origin === LOCAL_EDIT) return;
      setValue(ytext.toString());
    };
    ytext.observe(observer);
    return () => ytext.unobserve(observer);
  }, [doc]);

  const onChange = (next: string) => {
    if (!canEdit) return; // viewers are read-only (server rejects writes too)
    const ytext = ytextRef.current;
    // Diff against `value` (what the user sees), NOT ytext.toString() — the
    // Y.Text may already hold a remote edit not yet rendered, and diffing
    // against it would delete that remote content. Diffing the rendered baseline
    // yields just this keystroke, which the CRDT merges with the remote edit.
    if (ytext) applyTextDiff(ytext, value, next, LOCAL_EDIT);
    setValue(next);
  };

  if (docStatus === "loading") {
    return (
      <div
        role="status"
        className="flex h-full items-center justify-center text-sm text-muted-foreground"
      >
        {common("loading")}
      </div>
    );
  }

  if (docStatus === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <p role="alert" className="max-w-md text-sm text-muted-foreground">
          {error || t("documentOpenError")}
        </p>
        <button
          type="button"
          onClick={retry}
          disabled={retrying}
          className="rounded-full bg-white/[0.08] px-4 py-2 text-sm text-white/80 hover:bg-white/[0.12] disabled:opacity-50"
        >
          {common("retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <DocumentSyncError
        error={syncError}
        retry={retrySync}
        retrying={connStatus === "connecting"}
        className="mx-6 mt-3"
      />
      {error ? (
        <div className="flex items-center justify-between gap-4 px-6 py-3 text-sm">
          <p role="alert" className="text-muted-foreground">
            {error}
          </p>
          <button
            type="button"
            onClick={retry}
            disabled={retrying}
            className="shrink-0 rounded-full bg-white/[0.08] px-4 py-2 text-white/80 hover:bg-white/[0.12] disabled:opacity-50"
          >
            {common("retry")}
          </button>
        </div>
      ) : null}
      <div className="mx-auto min-h-0 w-full max-w-3xl flex-1 px-6 pt-6 pb-10">
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={canEdit ? t("briefPlaceholder") : ""}
          readOnly={!canEdit}
          disabled={!doc}
          className="h-full w-full resize-none bg-transparent text-[15px] leading-relaxed text-white/90 outline-none placeholder:text-muted-foreground"
        />
      </div>
      {doc && !syncError && connStatus !== "synced" && (
        <span className="pointer-events-none absolute right-6 bottom-4 text-xs text-muted-foreground">
          {connStatus === "offline" ? t("offlineSaved") : t("connecting")}
        </span>
      )}
    </div>
  );
}
