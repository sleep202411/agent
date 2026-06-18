"use client";

import { useCallback, useEffect, useState } from "react";
import {
  addComment,
  createCommentThread,
  listCommentThreads,
  resolveCommentThread,
  type CommentThreadDto,
  type CreateThreadInput,
} from "./comments-api";
import type { DocumentProvider } from "./document-provider";

const COMMENTS_CHANGED = "comments_changed";

function isCommentsChanged(data: unknown): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: string }).type === COMMENTS_CHANGED
  );
}

export interface DocumentCommentsHandle {
  threads: CommentThreadDto[];
  loading: boolean;
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
  const [threads, setThreads] = useState<CommentThreadDto[]>([]);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (!documentId) return;
    try {
      setThreads(await listCommentThreads(documentId));
    } catch {
      /* 401 raises the login dialog; transient errors retry on next signal */
    }
  }, [documentId]);

  useEffect(() => {
    if (!documentId) {
      /* eslint-disable-next-line react-hooks/set-state-in-effect */
      setThreads([]);
      return;
    }
    let cancelled = false;

    setLoading(true);
    void refetch().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [documentId, refetch]);

  // Refetch when a peer reports a comment change.
  useEffect(() => {
    if (!provider) return;
    return provider.onAppEvent((data) => {
      if (isCommentsChanged(data)) void refetch();
    });
  }, [provider, refetch]);

  const notifyPeers = useCallback(() => {
    provider?.broadcastAppEvent({ type: COMMENTS_CHANGED });
  }, [provider]);

  const createThread = useCallback(
    async (input: CreateThreadInput) => {
      if (!documentId) return;
      await createCommentThread(documentId, input);
      await refetch();
      notifyPeers();
    },
    [documentId, refetch, notifyPeers]
  );

  const reply = useCallback(
    async (threadId: string, body: string) => {
      if (!documentId) return;
      await addComment(documentId, threadId, body);
      await refetch();
      notifyPeers();
    },
    [documentId, refetch, notifyPeers]
  );

  const resolve = useCallback(
    async (threadId: string) => {
      if (!documentId) return;
      await resolveCommentThread(documentId, threadId);
      await refetch();
      notifyPeers();
    },
    [documentId, refetch, notifyPeers]
  );

  return { threads, loading, createThread, reply, resolve };
}
