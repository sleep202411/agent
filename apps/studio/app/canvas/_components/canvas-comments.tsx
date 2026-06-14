"use client";

import { useState } from "react";
import { ViewportPortal, type Node } from "@xyflow/react";
import { IconCheck, IconMessage, IconMessagePlus, IconSend, IconX } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useDocumentComments } from "@/lib/collab/use-comments";
import type { CommentThreadDto } from "@/lib/collab/comments-api";
import type { DocumentProvider } from "@/lib/collab/document-provider";
import { FLOATING_PANEL } from "./node-toolbar";

interface CanvasCommentsProps {
  documentId: string | null;
  provider: DocumentProvider | null;
  nodes: Node[];
  currentUserId?: string;
}

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
 * Per-node comments: a pin on every node that has an open thread (and a
 * "+comment" pin on the selected node), opening a thread panel with the
 * conversation, a reply box, and resolve. Real-time via {@link useDocumentComments}.
 */
export function CanvasComments({
  documentId,
  provider,
  nodes,
  currentUserId,
}: CanvasCommentsProps) {
  const { threads, createThread, reply, resolve } = useDocumentComments(documentId, provider);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);

  // First open thread per node (one ongoing thread per node in the UI).
  const threadByNode = new Map<string, CommentThreadDto>();
  for (const thread of threads) {
    if (thread.status !== "open" || !thread.blockId) continue;
    if (!threadByNode.has(thread.blockId)) {
      threadByNode.set(thread.blockId, thread);
    }
  }

  const selected = nodes.filter((node) => node.selected);
  const pinNodeIds = new Set<string>(threadByNode.keys());
  if (selected.length === 1) pinNodeIds.add(selected[0].id);

  const activeNode = activeNodeId ? (nodes.find((node) => node.id === activeNodeId) ?? null) : null;
  const activeThread = activeNodeId ? (threadByNode.get(activeNodeId) ?? null) : null;

  return (
    <>
      <ViewportPortal>
        {[...pinNodeIds].map((nodeId) => {
          const node = nodes.find((n) => n.id === nodeId);
          if (!node) return null;
          const thread = threadByNode.get(nodeId);
          const count = thread?.comments.length ?? 0;
          const width = node.measured?.width ?? 0;
          const isActive = nodeId === activeNodeId;
          return (
            <button
              key={nodeId}
              type="button"
              onClick={() => setActiveNodeId(isActive ? null : nodeId)}
              style={{
                // Anchor just outside the node's top-right corner — clears the
                // header's model chip, the mid-height handles, and the centered
                // selection toolbar across every node type.
                transform: `translate(${node.position.x + width + 8}px, ${node.position.y}px)`,
              }}
              className={cn(
                "pointer-events-auto absolute top-0 left-0 z-[900] flex h-7 items-center gap-1 rounded-full px-2 text-xs font-medium shadow-md backdrop-blur-xl transition-colors",
                count > 0
                  ? "bg-popover/90 text-white hover:bg-accent"
                  : "bg-popover/80 text-white/70 hover:bg-accent hover:text-white",
                isActive && "bg-accent text-white"
              )}
            >
              {count > 0 ? (
                <>
                  <IconMessage className="size-3.5" stroke={1.8} />
                  <span className="tabular-nums">{count}</span>
                </>
              ) : (
                <IconMessagePlus className="size-3.5" stroke={1.8} />
              )}
            </button>
          );
        })}
      </ViewportPortal>

      {activeNode && (
        <ThreadPanel
          key={activeNode.id}
          thread={activeThread}
          currentUserId={currentUserId}
          onClose={() => setActiveNodeId(null)}
          onCreate={(body) => createThread({ blockId: activeNode.id, body })}
          onReply={(body) => (activeThread ? reply(activeThread.id, body) : Promise.resolve())}
          onResolve={() => (activeThread ? resolve(activeThread.id) : Promise.resolve())}
        />
      )}
    </>
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
  onCreate: (body: string) => Promise<void>;
  onReply: (body: string) => Promise<void>;
  onResolve: () => Promise<void>;
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
