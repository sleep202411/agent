"use client";

import { useState } from "react";
import { ViewportPortal, type Node } from "@xyflow/react";
import { IconCheck, IconMessage, IconSend, IconX } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useDocumentComments } from "@/lib/collab/use-comments";
import type { CommentThreadDto } from "@/lib/collab/comments-api";
import type { DocumentProvider } from "@/lib/collab/document-provider";
import { FLOATING_PANEL } from "./node-toolbar";
import { CommentsContext, useComments, type CommentsContextValue } from "./comments-context";

function relativeTime(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * Owns the per-document comment threads + which node's thread is open, and
 * exposes them via context so the node action bar can open/add a comment
 * (the "+comment" affordance lives in the toolbar now, not a floating pin).
 * Render {@link CommentsLayer} inside ReactFlow for the pins + thread panel.
 */
export function CommentsProvider({
  documentId,
  provider,
  currentUserId,
  children,
}: {
  documentId: string | null;
  provider: DocumentProvider | null;
  currentUserId?: string;
  children: React.ReactNode;
}) {
  const { threads, createThread, reply, resolve } = useDocumentComments(documentId, provider);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);

  // First open thread per node (one ongoing thread per node in the UI).
  const threadByNode = new Map<string, CommentThreadDto>();
  for (const thread of threads) {
    if (thread.status !== "open" || !thread.blockId) continue;
    if (!threadByNode.has(thread.blockId)) threadByNode.set(thread.blockId, thread);
  }

  const value: CommentsContextValue = {
    activeNodeId,
    toggle: (nodeId) => setActiveNodeId((cur) => (cur === nodeId ? null : nodeId)),
    close: () => setActiveNodeId(null),
    threadByNode,
    commentCount: (nodeId) => threadByNode.get(nodeId)?.comments.length ?? 0,
  };

  return (
    <CommentsContext.Provider value={value}>
      {children}
      {activeNodeId && (
        <ThreadPanel
          key={activeNodeId}
          thread={threadByNode.get(activeNodeId) ?? null}
          currentUserId={currentUserId}
          onClose={() => setActiveNodeId(null)}
          onCreate={(body) => createThread({ blockId: activeNodeId, body })}
          onReply={(body) => {
            const thread = threadByNode.get(activeNodeId);
            return thread ? reply(thread.id, body) : Promise.resolve();
          }}
          onResolve={() => {
            const thread = threadByNode.get(activeNodeId);
            return thread ? resolve(thread.id) : Promise.resolve();
          }}
        />
      )}
    </CommentsContext.Provider>
  );
}

/**
 * Pins for nodes that have an open thread — rendered inside ReactFlow's
 * viewport so they track pan/zoom. The "+comment" action for the selected node
 * is in the node toolbar; a node's pin hides while it's selected so the two
 * don't double up.
 */
export function CommentsLayer({ nodes }: { nodes: Node[] }) {
  const { threadByNode, activeNodeId, toggle, commentCount } = useComments();
  return (
    <ViewportPortal>
      {[...threadByNode.keys()].map((nodeId) => {
        const node = nodes.find((n) => n.id === nodeId);
        if (!node || node.selected) return null; // selected → toolbar handles it
        const count = commentCount(nodeId);
        const width = node.measured?.width ?? 0;
        const isActive = nodeId === activeNodeId;
        return (
          <button
            key={nodeId}
            type="button"
            onClick={() => toggle(nodeId)}
            style={{
              transform: `translate(${node.position.x + width + 8}px, ${node.position.y}px)`,
            }}
            className={cn(
              "pointer-events-auto absolute top-0 left-0 z-[900] flex h-7 items-center gap-1 rounded-full px-2 text-xs font-medium shadow-md backdrop-blur-xl transition-colors",
              isActive ? "bg-accent text-white" : "bg-popover/90 text-white hover:bg-accent"
            )}
          >
            <IconMessage className="size-3.5" stroke={1.8} />
            <span className="tabular-nums">{count}</span>
          </button>
        );
      })}
    </ViewportPortal>
  );
}

function ThreadPanel({
  thread,
  currentUserId,
  onClose,
  onCreate,
  onReply,
  onResolve,
}: {
  thread: CommentThreadDto | null;
  currentUserId?: string;
  onClose: () => void;
  onCreate: (body: string) => Promise<unknown>;
  onReply: (body: string) => Promise<unknown>;
  onResolve: () => Promise<unknown>;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      if (thread) await onReply(body);
      else await onCreate(body);
      setDraft("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={cn(
        "absolute top-20 right-4 z-30 flex max-h-[calc(100vh-7rem)] w-80 flex-col rounded-2xl",
        FLOATING_PANEL
      )}
    >
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="text-sm font-medium">{thread ? "Comments" : "New comment"}</span>
        <div className="flex items-center gap-0.5">
          {thread && (
            <button
              type="button"
              aria-label="Resolve thread"
              onClick={() => void onResolve()}
              className="flex size-7 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white"
            >
              <IconCheck className="size-4" stroke={1.8} />
            </button>
          )}
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex size-7 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white"
          >
            <IconX className="size-4" stroke={1.8} />
          </button>
        </div>
      </div>

      {thread && thread.comments.length > 0 && (
        <div className="flex flex-col gap-3 overflow-y-auto px-3 pb-2">
          {thread.comments.map((comment) => (
            <div key={comment.id} className="text-sm">
              <div className="mb-0.5 flex items-baseline gap-1.5">
                <span className="font-medium">
                  {comment.createdById === currentUserId ? "You" : "Teammate"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {relativeTime(comment.createdAt)}
                </span>
              </div>
              <p className="whitespace-pre-wrap break-words text-white/90">{comment.body}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-1.5 p-2">
        <textarea
          value={draft}
          autoFocus
          placeholder={thread ? "Reply…" : "Add a comment…"}
          rows={1}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          className="field-sizing-content max-h-32 min-h-9 flex-1 resize-none rounded-xl bg-muted px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          aria-label="Send"
          disabled={!draft.trim() || busy}
          onClick={() => void submit()}
          className="flex size-9 items-center justify-center rounded-xl bg-white text-black transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <IconSend className="size-4" stroke={1.8} />
        </button>
      </div>
    </div>
  );
}
