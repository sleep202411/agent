"use client";

import { createContext, useContext } from "react";
import type { CommentThreadDto } from "@/lib/collab/comments-api";

/**
 * Shared comment-thread state for the canvas. Lives in its own module so the
 * node action bar (node-toolbar) can open/add a comment without importing
 * canvas-comments.tsx (which imports node-toolbar for FLOATING_PANEL — a cycle).
 */
export interface CommentsContextValue {
  activeNodeId: string | null;
  /** Open (or toggle) the comment thread for a node — driven from the node toolbar. */
  toggle: (nodeId: string) => void;
  close: () => void;
  threadByNode: Map<string, CommentThreadDto>;
  commentCount: (nodeId: string) => number;
}

export const CommentsContext = createContext<CommentsContextValue | null>(null);

export function useComments(): CommentsContextValue {
  const value = useContext(CommentsContext);
  if (!value) throw new Error("useComments must be used within a CommentsProvider");
  return value;
}
