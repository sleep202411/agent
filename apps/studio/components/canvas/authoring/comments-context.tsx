"use client";

import { createContext, useContext } from "react";
import type { CommentThreadDto } from "@/lib/collab/comments-api";

/**
 * Shared comment-thread state for the canvas. Lives in its own module so the
 * node action bar (node-toolbar) can open/add a comment without importing
 * canvas-comments.tsx (which imports node-toolbar for FLOATING_PANEL — a cycle).
 */
export interface CommentsContextValue {
  enabled: boolean;
  activeNodeId: string | null;
  /** Open (or toggle) the comment thread for a node — driven from the node toolbar. */
  toggle: (nodeId: string) => void;
  close: () => void;
  threadByNode: Map<string, CommentThreadDto>;
  commentCount: (nodeId: string) => number;
}

const NO_COMMENTS: CommentsContextValue = {
  enabled: false,
  activeNodeId: null,
  toggle: () => {},
  close: () => {},
  threadByNode: new Map(),
  commentCount: () => 0,
};

export const CommentsContext = createContext<CommentsContextValue>(NO_COMMENTS);

export function useComments(): CommentsContextValue {
  return useContext(CommentsContext);
}
