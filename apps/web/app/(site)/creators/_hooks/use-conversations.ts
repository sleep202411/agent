/**
 * Conversations feature data layer.
 *
 * Endpoints:
 *   POST   /aurora/conversations                     open inquiry
 *   GET    /aurora/conversations                     inbox
 *   GET    /aurora/conversations/:id                 detail
 *   GET    /aurora/conversations/:id/messages        paginated
 *   POST   /aurora/conversations/:id/messages        send text
 *   POST   /aurora/conversations/:id/proposals       creator sends proposal
 *   POST   /aurora/conversations/:id/proposals/:m/decline   buyer declines
 *   POST   /aurora/conversations/:id/read            advance read cursor
 *
 * Cache keys are scoped per resource so a single mutation
 * invalidates the right surfaces:
 *   ["conversation", "inbox"]                  inbox list
 *   ["conversation", "detail", id]             detail row
 *   ["conversation", "messages", id]           message timeline
 *
 * Live WS pushes patch the cache directly via the
 * `applyIncomingMessage` helper so connected tabs don't need to
 * refetch.
 */

"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import type {
  ConversationCardDTO,
  ConversationDTO,
  ConversationContextType,
  MessageDTO,
} from "@repo/shared/conversation";
import type { CurrencyCode } from "@repo/shared/crew";
import type { ServiceTier } from "@repo/shared/creator-service";
import { openConversationWs } from "@/src/lib/conversations/ws-client";

// ─── Fetch helpers ──────────────────────────────────────────

const BASE = "/aurora";

export class ConversationApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(
      (body && typeof body === "object" && "message" in body
        ? String((body as { message: unknown }).message)
        : null) ?? `Conversation API error ${status}`
    );
    this.name = "ConversationApiError";
  }
}

interface CallOpts {
  body?: unknown;
  query?: Record<string, string | number | undefined>;
}

async function call<T>(method: string, path: string, opts: CallOpts = {}): Promise<T> {
  const url = buildUrl(path, opts.query);
  const init: RequestInit = {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  };
  const res = await fetch(url, init);
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = await res.text().catch(() => null);
    }
    throw new ConversationApiError(res.status, body);
  }
  return (await res.json()) as T;
}

function buildUrl(path: string, query?: CallOpts["query"]): string {
  const url = `${BASE}${path}`;
  if (!query) return url;
  const entries = Object.entries(query).filter(([, v]) => v !== undefined && v !== "");
  if (entries.length === 0) return url;
  const qs = new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
  return `${url}?${qs}`;
}

const api = {
  get: <T>(p: string, o?: CallOpts) => call<T>("GET", p, o),
  post: <T>(p: string, o?: CallOpts) => call<T>("POST", p, o),
};

// ─── Wire bodies ───────────────────────────────────────────

export interface OpenConversationBody {
  contextType: "service";
  contextId: string;
  firstMessage?: string;
}

export interface SendProposalBody {
  note?: string;
  packageTier: ServiceTier;
  price: number;
  currency: CurrencyCode;
  deliveryDays: number;
  revisions: number;
  scope: string[];
}

interface InboxResponse {
  items: ConversationCardDTO[];
  nextCursor: string | null;
}

interface MessagesResponse {
  items: MessageDTO[];
  nextCursor: string | null;
}

// ─── Cache keys ────────────────────────────────────────────

export const conversationKeys = {
  all: ["conversation"] as const,
  inbox: () => ["conversation", "inbox"] as const,
  inboxFiltered: (contextType?: ConversationContextType) =>
    ["conversation", "inbox", contextType ?? "all"] as const,
  detail: (id: string) => ["conversation", "detail", id] as const,
  messages: (id: string) => ["conversation", "messages", id] as const,
};

// ─── Queries ───────────────────────────────────────────────

export function useInbox(contextType?: ConversationContextType) {
  return useInfiniteQuery<
    InboxResponse,
    ConversationApiError,
    { items: ConversationCardDTO[]; hasMore: boolean },
    ReturnType<typeof conversationKeys.inboxFiltered>,
    string | null
  >({
    queryKey: conversationKeys.inboxFiltered(contextType),
    initialPageParam: null,
    queryFn: ({ pageParam }) =>
      api.get<InboxResponse>("/conversations", {
        query: {
          ...(contextType ? { contextType } : {}),
          limit: 24,
          ...(pageParam ? { cursor: pageParam } : {}),
        },
      }),
    getNextPageParam: (last) => last.nextCursor,
    select: (data) => {
      const items: ConversationCardDTO[] = [];
      const seen = new Set<string>();
      for (const page of data.pages) {
        for (const item of page.items) {
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          items.push(item);
        }
      }
      const last = data.pages[data.pages.length - 1];
      return { items, hasMore: !!last?.nextCursor };
    },
  });
}

export function useConversation(id: string | null) {
  return useQuery<ConversationDTO, ConversationApiError>({
    queryKey: id ? conversationKeys.detail(id) : ["conversation", "detail", "_none"],
    enabled: !!id,
    queryFn: () => api.get<ConversationDTO>(`/conversations/${id}`),
  });
}

export function useMessages(conversationId: string | null) {
  return useInfiniteQuery<
    MessagesResponse,
    ConversationApiError,
    { items: MessageDTO[]; hasMore: boolean },
    ReturnType<typeof conversationKeys.messages>,
    string | null
  >({
    queryKey: conversationId
      ? conversationKeys.messages(conversationId)
      : (["conversation", "messages", "_none"] as never),
    enabled: !!conversationId,
    initialPageParam: null,
    queryFn: ({ pageParam }) =>
      api.get<MessagesResponse>(`/conversations/${conversationId}/messages`, {
        query: {
          limit: 50,
          ...(pageParam ? { cursor: pageParam } : {}),
        },
      }),
    getNextPageParam: (last) => last.nextCursor,
    select: (data) => {
      // Server returns newest-first; flatten + dedupe; UI scrolls
      // bottom-aligned so we reverse for ascending render.
      const seen = new Set<string>();
      const out: MessageDTO[] = [];
      for (const page of data.pages) {
        for (const msg of page.items) {
          if (seen.has(msg.id)) continue;
          seen.add(msg.id);
          out.push(msg);
        }
      }
      out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const last = data.pages[data.pages.length - 1];
      return { items: out, hasMore: !!last?.nextCursor };
    },
  });
}

// ─── Mutations ─────────────────────────────────────────────

export function useOpenConversation() {
  const qc = useQueryClient();
  return useMutation<
    { conversation: ConversationDTO; firstMessage: MessageDTO | null },
    ConversationApiError,
    OpenConversationBody
  >({
    mutationFn: (body) =>
      api.post<{ conversation: ConversationDTO; firstMessage: MessageDTO | null }>(
        "/conversations",
        { body }
      ),
    onSuccess: ({ conversation, firstMessage }) => {
      qc.setQueryData(conversationKeys.detail(conversation.id), conversation);
      qc.invalidateQueries({ queryKey: conversationKeys.inbox() });
      if (firstMessage) {
        // Prepend the first message to the cache if the timeline
        // query is already alive (rare on a freshly-opened conv).
        seedFirstMessage(qc, conversation.id, firstMessage);
      }
    },
  });
}

export function useSendText(conversationId: string) {
  const qc = useQueryClient();
  return useMutation<MessageDTO, ConversationApiError, { body: string }>({
    mutationFn: ({ body }) =>
      api.post<MessageDTO>(`/conversations/${conversationId}/messages`, {
        body: { body },
      }),
    onSuccess: (message) => {
      applyIncomingMessage(qc, conversationId, message);
    },
  });
}

export function useSendProposal(conversationId: string) {
  const qc = useQueryClient();
  return useMutation<MessageDTO, ConversationApiError, SendProposalBody>({
    mutationFn: (body) =>
      api.post<MessageDTO>(`/conversations/${conversationId}/proposals`, {
        body,
      }),
    onSuccess: (message) => {
      applyIncomingMessage(qc, conversationId, message);
    },
  });
}

export function useDeclineProposal(conversationId: string) {
  const qc = useQueryClient();
  return useMutation<MessageDTO, ConversationApiError, { messageId: string }>({
    mutationFn: ({ messageId }) =>
      api.post<MessageDTO>(`/conversations/${conversationId}/proposals/${messageId}/decline`),
    onSuccess: (message) => {
      applyIncomingMessage(qc, conversationId, message);
    },
  });
}

export function useMarkRead(conversationId: string) {
  const qc = useQueryClient();
  return useMutation<
    { lastReadMessageId: string },
    ConversationApiError,
    { lastReadMessageId: string }
  >({
    mutationFn: (body) => api.post(`/conversations/${conversationId}/read`, { body }),
    onSuccess: () => {
      // Invalidate inbox row (unreadCount) + detail; messages list
      // doesn't change on read.
      qc.invalidateQueries({ queryKey: conversationKeys.inbox() });
      qc.invalidateQueries({ queryKey: conversationKeys.detail(conversationId) });
    },
  });
}

// ─── Cache helpers exposed for WS push handler ─────────────

/**
 * Splice an incoming message into the per-conversation timeline
 * cache without refetch. Called both by mutation onSuccess (so the
 * sender sees their message instantly) and by the WS push handler
 * (so the other side does too).
 *
 * Idempotent — re-applying the same message id no-ops.
 */
export function applyIncomingMessage(
  qc: ReturnType<typeof useQueryClient>,
  conversationId: string,
  message: MessageDTO
) {
  const key = conversationKeys.messages(conversationId);
  qc.setQueryData<InfiniteData<MessagesResponse>>(key, (old) => {
    if (!old) return old;
    // Server returns newest-first; the *first* page is the newest
    // batch, so prepend new messages there. Skip duplicates.
    const firstPage = old.pages[0];
    if (!firstPage) return old;
    if (firstPage.items.some((m) => m.id === message.id)) {
      // Already present — could be an update (proposal status flip).
      // Patch in place by id.
      return {
        ...old,
        pages: old.pages.map((p) => ({
          ...p,
          items: p.items.map((m) => (m.id === message.id ? message : m)),
        })),
      };
    }
    const patchedFirst = { ...firstPage, items: [message, ...firstPage.items] };
    return { ...old, pages: [patchedFirst, ...old.pages.slice(1)] };
  });
  // Inbox previews go stale — fire a refetch.
  qc.invalidateQueries({ queryKey: conversationKeys.inbox() });
}

function seedFirstMessage(
  qc: ReturnType<typeof useQueryClient>,
  conversationId: string,
  message: MessageDTO
) {
  const key = conversationKeys.messages(conversationId);
  const existing = qc.getQueryData<InfiniteData<MessagesResponse>>(key);
  if (existing) {
    applyIncomingMessage(qc, conversationId, message);
    return;
  }
  qc.setQueryData<InfiniteData<MessagesResponse>>(key, {
    pages: [{ items: [message], nextCursor: null }],
    pageParams: [null],
  });
}

// ─── WS subscription provider hook ─────────────────────────

/**
 * Mounts the conversations WS once per session. Patches the cache
 * on every push so any live view reacts without refetching. Closes
 * the socket on unmount.
 *
 * Call at the app shell (under the auth boundary), NOT per-component
 * — see project_chat_ws_lifecycle.
 */
export function useConversationsWs(enabled: boolean) {
  const qc = useQueryClient();
  // Stable ref so re-renders don't re-open the socket.
  const clientRef = useRef<ReturnType<typeof openConversationWs> | null>(null);

  // Stable handler set captures qc at mount time; qc is referentially
  // stable across renders so this is safe.
  const handlers = useMemo(
    () => ({
      onMessage: (data: {
        conversationId: string;
        message: MessageDTO;
        lastMessageAt: string;
        unreadCount: number;
      }) => {
        applyIncomingMessage(qc, data.conversationId, data.message);
      },
      onReadAdvanced: () => {
        // Other side advanced their read cursor — refresh the inbox
        // row that may display "read" state in the future.
        qc.invalidateQueries({ queryKey: conversationKeys.inbox() });
      },
      onContextChanged: (data: { conversationId: string }) => {
        qc.invalidateQueries({
          queryKey: conversationKeys.detail(data.conversationId),
        });
        qc.invalidateQueries({ queryKey: conversationKeys.inbox() });
      },
      onReconnected: () => {
        // Recover any missed-while-offline messages by refetching
        // every active timeline + inbox.
        qc.invalidateQueries({ queryKey: conversationKeys.all });
      },
    }),
    [qc]
  );

  useEffect(() => {
    if (!enabled) {
      clientRef.current?.close();
      clientRef.current = null;
      return;
    }
    if (clientRef.current) return;
    clientRef.current = openConversationWs(handlers);
    return () => {
      clientRef.current?.close();
      clientRef.current = null;
    };
  }, [enabled, handlers]);
}
