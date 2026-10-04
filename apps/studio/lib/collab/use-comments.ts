"use client";

import { useCallback } from "react";
import {
  addComment,
  createCommentThread,
  listCommentThreads,
  resolveCommentThread,
  type CommentThreadDto,
  type CreateThreadInput,
} from "./comments-api";
import type { DocumentProvider } from "./document-provider";

import { useDocumentFeed } from "./use-document-feed";

const COMMENTS_CHANGED = "comments_changed";

export interface DocumentCommentsHandle {
  threads: CommentThreadDto[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  createThread: (input: CreateThreadInput) => Promise<void>;
  reply: (threadId: string, body: string) => Promise<void>;
  resolve: (threadId: string) => Promise<void>;
}

/**
 * Per-document comment threads with real-time sync: fetches on open, refetches
 * when a peer signals a change over the WS app-event channel, and nudges peers
 * after this client mutates.
 */
export function useDocumentComments(
  documentId: string | null,
  provider: DocumentProvider | null
): DocumentCommentsHandle {
  const {
    rows: threads,
    loading,
    error,
    refetch,
    isActive,
  } = useDocumentFeed(documentId, provider, COMMENTS_CHANGED, listCommentThreads);

  const notifyPeers = useCallback(() => {
    if (!isActive()) return;
    provider?.broadcastAppEvent({ type: COMMENTS_CHANGED });
  }, [provider, isActive]);

  const createThread = useCallback(
    async (input: CreateThreadInput) => {
      if (!documentId || !isActive()) return;
      await createCommentThread(documentId, input);
      await refetch();
      notifyPeers();
    },
    [documentId, refetch, notifyPeers, isActive]
  );

  const reply = useCallback(
    async (threadId: string, body: string) => {
      if (!documentId || !isActive()) return;
      await addComment(documentId, threadId, body);
      await refetch();
      notifyPeers();
    },
    [documentId, refetch, notifyPeers, isActive]
  );

  const resolve = useCallback(
    async (threadId: string) => {
      if (!documentId || !isActive()) return;
      await resolveCommentThread(documentId, threadId);
      await refetch();
      notifyPeers();
    },
    [documentId, refetch, notifyPeers, isActive]
  );

  return { threads, loading, error, refetch, createThread, reply, resolve };
}
