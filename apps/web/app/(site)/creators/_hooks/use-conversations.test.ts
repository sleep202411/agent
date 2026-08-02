// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, type InfiniteData } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConversationDTO, MessageDTO } from "@repo/shared/conversation";
import {
  applyOptimisticMessage,
  applyIncomingMessage,
  clearConversationAccessCache,
  ConversationApiError,
  conversationKeys,
  createOptimisticTextMessage,
  createConversationRecoveryCoordinator,
  flattenMessagePagesChronologically,
  optimisticMessageId,
  removeOptimisticMessage,
  shouldRetryConversationQuery,
  useConversation,
} from "./use-conversations";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function message(id: string, createdAt: string): MessageDTO {
  return {
    id,
    conversationId: "conv-1",
    authorId: "user-1",
    type: "text",
    body: id,
    payload: null,
    createdAt,
  };
}

describe("flattenMessagePagesChronologically", () => {
  it("preserves the server id tiebreaker when timestamps share a millisecond", () => {
    const tiedAt = "2026-07-28T10:00:00.000Z";

    const result = flattenMessagePagesChronologically([
      {
        // Wire order is newest first: id DESC breaks the timestamp tie.
        items: [message("m-c", tiedAt), message("m-b", tiedAt)],
      },
      {
        // A cursor overlap is deduped without changing the total order.
        items: [message("m-b", tiedAt), message("m-a", tiedAt)],
      },
    ]);

    expect(result.map((item) => item.id)).toEqual(["m-a", "m-b", "m-c"]);
  });

  it("replays an existing id in place even when it lives on an older page", () => {
    const qc = new QueryClient();
    const key = conversationKeys.messages("conv-1");
    const original = message("m-old", "2026-07-28T09:00:00.000Z");
    qc.setQueryData<InfiniteData<MessagesPage, string | null>>(key, {
      pages: [
        {
          items: [message("m-new", "2026-07-28T10:00:00.000Z")],
          nextCursor: "older",
        },
        { items: [original], nextCursor: null },
      ],
      pageParams: [null, "older"],
    });

    applyIncomingMessage(qc, "conv-1", { ...original, body: "updated" }, { revalidate: false });

    const data = qc.getQueryData<InfiniteData<MessagesPage, string | null>>(key)!;
    expect(data.pages.flatMap((page) => page.items).filter((item) => item.id === "m-old")).toEqual([
      expect.objectContaining({ body: "updated" }),
    ]);
    qc.clear();
  });
});

describe("optimistic text messages", () => {
  it("shows a send immediately and replaces it when realtime wins the race", () => {
    const qc = new QueryClient();
    const key = conversationKeys.messages("conv-1");
    const original = message("m-old", "2026-07-28T09:00:00.000Z");
    qc.setQueryData(key, timeline(original));

    const optimistic = createOptimisticTextMessage({
      conversationId: "conv-1",
      authorId: "user-1",
      body: "The cut is ready",
      clientKey: "send-1",
      mentions: [{ userId: "user-2", label: "Ada" }],
    });
    applyOptimisticMessage(qc, "conv-1", optimistic);

    let data = qc.getQueryData<InfiniteData<MessagesPage, string | null>>(key)!;
    expect(flattenMessagePagesChronologically(data.pages).map((item) => item.id)).toEqual([
      "m-old",
      optimisticMessageId("send-1"),
    ]);
    expect(optimistic.payload).toEqual({
      kind: "text",
      mentions: [{ userId: "user-2", label: "Ada" }],
    });

    const persisted = {
      ...optimistic,
      id: "m-real",
      clientKey: "send-1",
      createdAt: "2026-07-28T10:00:00.000Z",
    };
    // The service broadcasts before its HTTP response. The realtime frame
    // must remove the temporary row, and the later response must remain
    // idempotent instead of rendering a duplicate.
    applyIncomingMessage(qc, "conv-1", persisted, { revalidate: false });
    applyIncomingMessage(qc, "conv-1", persisted, { revalidate: false });

    data = qc.getQueryData<InfiniteData<MessagesPage, string | null>>(key)!;
    expect(flattenMessagePagesChronologically(data.pages).map((item) => item.id)).toEqual([
      "m-old",
      "m-real",
    ]);
    qc.clear();
  });

  it("removes only the failed optimistic row", () => {
    const qc = new QueryClient();
    const key = conversationKeys.messages("conv-1");
    const original = message("m-old", "2026-07-28T09:00:00.000Z");
    const optimistic = createOptimisticTextMessage({
      conversationId: "conv-1",
      authorId: "user-1",
      body: "Still uploading",
      clientKey: "send-failed",
    });
    qc.setQueryData(key, timeline(optimistic, original));

    removeOptimisticMessage(qc, "conv-1", optimistic.id);

    const data = qc.getQueryData<InfiniteData<MessagesPage, string | null>>(key)!;
    expect(data.pages[0].items).toEqual([original]);
    qc.clear();
  });
});

interface MessagesPage {
  items: MessageDTO[];
  nextCursor: string | null;
}

function timeline(...items: MessageDTO[]): InfiniteData<MessagesPage, string | null> {
  return {
    pages: [{ items, nextCursor: null }],
    pageParams: [null],
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function incoming(message: MessageDTO) {
  return {
    conversationId: message.conversationId,
    message,
    lastMessageAt: message.createdAt,
    unreadCount: 1,
  };
}

describe("conversation realtime recovery", () => {
  it("replays frames after a stale ready response and repeats for reversed frames", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const key = conversationKeys.messages("conv-1");
    const tiedAt = "2026-07-28T10:00:00.000Z";
    const base = message("m-a", tiedAt);
    const older = message("m-b", tiedAt);
    const newer = message("m-c", tiedAt);
    qc.setQueryData(key, timeline(base));

    const firstResponse = deferred();
    let refetchCount = 0;
    vi.spyOn(qc, "refetchQueries").mockImplementation(async (filters) => {
      refetchCount += 1;
      if (refetchCount === 1) {
        await firstResponse.promise;
        // This response started before either WS frame and replaces
        // the whole InfiniteData value with its old snapshot.
        qc.setQueryData(key, timeline(base));
        return;
      }
      if (JSON.stringify(filters?.queryKey) === JSON.stringify(key)) {
        // Server order is `(created_at DESC,id DESC)`. Both JSON
        // timestamps have lost the database microseconds, so the
        // client must accept this REST order rather than frame order.
        qc.setQueryData(key, timeline(newer, older, base));
      }
    });

    const recovery = createConversationRecoveryCoordinator(qc);
    const ready = recovery.recoverAll();
    await Promise.resolve();

    // Newer arrives before older: the WS frame order is the reverse of
    // the authoritative chronological order.
    void recovery.receiveMessage(incoming(newer));
    void recovery.receiveMessage(incoming(older));
    firstResponse.resolve();
    await ready;

    const data = qc.getQueryData<InfiniteData<MessagesPage>>(key);
    expect(data).toBeDefined();
    expect(flattenMessagePagesChronologically(data!.pages).map((item) => item.id)).toEqual([
      "m-a",
      "m-b",
      "m-c",
    ]);
    // One full ready recovery plus a second pass for frames observed
    // during it (the inbox is refetched alongside the timeline).
    expect(refetchCount).toBeGreaterThanOrEqual(3);

    recovery.dispose();
    qc.clear();
  });
});

describe("conversation access revocation", () => {
  it("never retries definitive 403/404 access failures", () => {
    expect(shouldRetryConversationQuery(0, new ConversationApiError(403, null))).toBe(false);
    expect(shouldRetryConversationQuery(0, new ConversationApiError(404, null))).toBe(false);
    expect(shouldRetryConversationQuery(0, new ConversationApiError(500, null))).toBe(true);
    expect(shouldRetryConversationQuery(3, new ConversationApiError(500, null))).toBe(false);
  });

  it("forgets stale detail and history caches together", () => {
    const qc = new QueryClient();
    const conversation = {
      id: "conv-1",
      contextType: "crew",
      contextId: "crew-1",
      participants: [],
      lastMessage: null,
      lastMessageAt: "2026-07-28T10:00:00.000Z",
      unreadCount: 0,
      createdAt: "2026-07-28T10:00:00.000Z",
    } satisfies ConversationDTO;
    qc.setQueryData(conversationKeys.detail("conv-1"), conversation);
    qc.setQueryData(
      conversationKeys.messages("conv-1"),
      timeline(message("private-message", "2026-07-28T10:00:00.000Z"))
    );
    qc.setQueryData(conversationKeys.inboxFiltered(), {
      pages: [
        {
          items: [
            {
              id: "conv-1",
              contextType: "crew",
              contextId: "crew-1",
              counterpartyId: "crew-1",
              counterpartyRole: "member",
              lastMessagePreview: "private",
              lastMessageType: "text",
              lastMessageAt: "2026-07-28T10:00:00.000Z",
              unreadCount: 1,
            },
          ],
          nextCursor: null,
        },
      ],
      pageParams: [null],
    });

    clearConversationAccessCache(qc, "conv-1");

    expect(qc.getQueryData(conversationKeys.detail("conv-1"))).toBeUndefined();
    expect(qc.getQueryData(conversationKeys.messages("conv-1"))).toBeUndefined();
    expect(
      qc.getQueryData<InfiniteData<{ items: Array<{ id: string }> }>>(
        conversationKeys.inboxFiltered()
      )?.pages[0].items
    ).toEqual([]);
    qc.clear();
  });
});

describe("conversation query cancellation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes React Query's AbortSignal through to fetch", async () => {
    let observedSignal: AbortSignal | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        observedSignal = init?.signal ?? null;
        return new Promise<Response>(() => {});
      })
    );

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    function Probe() {
      useConversation("conv-1");
      return null;
    }

    act(() => {
      root.render(createElement(QueryClientProvider, { client: qc }, createElement(Probe)));
    });
    await vi.waitFor(() => expect(observedSignal).not.toBeNull());

    act(() => root.unmount());

    expect((observedSignal as AbortSignal | null)?.aborted).toBe(true);
    container.remove();
    qc.clear();
  });
});
