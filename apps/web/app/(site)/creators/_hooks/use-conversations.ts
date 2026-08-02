/**
 * Conversations feature data layer.
 *
 * Endpoints:
 *   POST   /aurora/conversations                     open inquiry
 *   GET    /aurora/conversations                     inbox
 *   GET    /aurora/conversations/:id                 detail
 *   GET    /aurora/conversations/:id/messages        paginated
 *   POST   /aurora/conversations/:id/messages        send text
 *   POST   /aurora/conversations/:id/attachments     send crew assets
 *   POST   /aurora/conversations/:id/task-cards      send crew task card
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
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { useCallback } from "react";
import type {
  ConversationCardDTO,
  ConversationDTO,
  ConversationContextType,
  ConversationMentionPayload,
  MessageDTO,
} from "@repo/shared/conversation";
import type { CurrencyCode } from "@repo/shared/crew";
import type { ServiceTier } from "@repo/shared/creator-service";

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

export function shouldRetryConversationQuery(
  failureCount: number,
  error: ConversationApiError
): boolean {
  // Membership removal is definitive until the user is invited again;
  // retrying it would keep stale protected data mounted for the global
  // retry window before the view can enforce its boundary.
  return !isConversationAccessError(error) && failureCount < 3;
}

interface CallOpts {
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
}

async function call<T>(method: string, path: string, opts: CallOpts = {}): Promise<T> {
  const url = buildUrl(path, opts.query);
  const init: RequestInit = {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    signal: opts.signal,
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

/**
 * Pages arrive in the server's total order
 * `(createdAt DESC, id DESC)`. Preserve that order exactly and reverse
 * the finished sequence for chronological rendering. Sorting again in
 * JavaScript by the millisecond ISO timestamp discarded the id
 * tiebreaker, so tied messages could render in a different order from
 * pagination and unread cursors.
 */
export function flattenMessagePagesChronologically(
  pages: Array<Pick<MessagesResponse, "items">>
): MessageDTO[] {
  const seen = new Set<string>();
  const newestFirst: MessageDTO[] = [];
  for (const page of pages) {
    for (const message of page.items) {
      if (seen.has(message.id)) continue;
      seen.add(message.id);
      newestFirst.push(message);
    }
  }
  return newestFirst.reverse();
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
    queryFn: ({ pageParam, signal }) =>
      api.get<InboxResponse>("/conversations", {
        signal,
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

export function useConversation(id: string | null, enabled = true) {
  return useQuery<ConversationDTO, ConversationApiError>({
    queryKey: id ? conversationKeys.detail(id) : ["conversation", "detail", "_none"],
    enabled: !!id && enabled,
    retry: shouldRetryConversationQuery,
    queryFn: ({ signal }) => api.get<ConversationDTO>(`/conversations/${id}`, { signal }),
  });
}

export function useMessages(conversationId: string | null, enabled = true) {
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
    enabled: !!conversationId && enabled,
    retry: shouldRetryConversationQuery,
    initialPageParam: null,
    queryFn: ({ pageParam, signal }) =>
      api.get<MessagesResponse>(`/conversations/${conversationId}/messages`, {
        signal,
        query: {
          limit: 50,
          ...(pageParam ? { cursor: pageParam } : {}),
        },
      }),
    getNextPageParam: (last) => last.nextCursor,
    select: (data) => {
      const items = flattenMessagePagesChronologically(data.pages);
      const last = data.pages[data.pages.length - 1];
      return { items, hasMore: !!last?.nextCursor };
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

/**
 * `clientKey` is the send's idempotency token, scoped to
 * (conversation, author, key). The server collapses a repeat onto the
 * row the first attempt created — which is what makes a retry after a
 * timeout safe: without it, a flaky network turns one composed message
 * into two copies that every member of a group chat then sees. Callers
 * that offer a retry MUST pass one, and must keep the SAME key for the
 * same composed text (see the composer in `conversation-view.tsx`).
 */
export function useSendText(conversationId: string, authorId: string | null) {
  const qc = useQueryClient();
  return useMutation<
    MessageDTO,
    ConversationApiError,
    { body: string; clientKey?: string; mentions?: ConversationMentionPayload[] },
    { optimisticId: string | null }
  >({
    mutationFn: ({ body, clientKey, mentions }) =>
      api.post<MessageDTO>(`/conversations/${conversationId}/messages`, {
        body: {
          body,
          ...(clientKey ? { clientKey } : {}),
          ...(mentions?.length ? { mentions } : {}),
        },
      }),
    onMutate: async ({ body, clientKey, mentions }) => {
      if (!authorId || !clientKey) return { optimisticId: null };

      const key = conversationKeys.messages(conversationId);
      // Stop an older REST response from replacing the cache immediately
      // after the optimistic row is inserted. `revert: false` preserves any
      // realtime frames that landed while that request was in flight.
      await qc.cancelQueries({ queryKey: key, exact: true }, { silent: true, revert: false });
      const optimistic = createOptimisticTextMessage({
        conversationId,
        authorId,
        body,
        clientKey,
        mentions,
      });
      applyOptimisticMessage(qc, conversationId, optimistic);
      return { optimisticId: optimistic.id };
    },
    onSuccess: (message, variables) => {
      // A server deployed just before `clientKey` was added to MessageDTO may
      // omit it from the response. The mutation still knows the exact key.
      applyIncomingMessage(
        qc,
        conversationId,
        message.clientKey === undefined
          ? { ...message, clientKey: variables.clientKey ?? null }
          : message,
        { optimisticClientKey: variables.clientKey }
      );
    },
    onError: (_error, variables, context) => {
      if (context?.optimisticId) {
        removeOptimisticMessage(qc, conversationId, context.optimisticId);
      } else if (variables.clientKey) {
        removeOptimisticMessage(qc, conversationId, optimisticMessageId(variables.clientKey));
      }
    },
  });
}

export function useSendAttachments(conversationId: string) {
  const qc = useQueryClient();
  return useMutation<
    MessageDTO,
    ConversationApiError,
    {
      attachments: Array<
        | { source: "asset"; assetNodeId: string }
        | { source: "upload"; mediaAssetId: string; name: string }
      >;
      body?: string;
      clientKey?: string;
      mentions?: ConversationMentionPayload[];
    }
  >({
    mutationFn: ({ attachments, body, clientKey, mentions }) =>
      api.post<MessageDTO>(`/conversations/${conversationId}/attachments`, {
        body: { attachments, body, clientKey, mentions },
      }),
    onSuccess: (message) => {
      applyIncomingMessage(qc, conversationId, message);
    },
  });
}

export function useSendTaskCard(conversationId: string) {
  const qc = useQueryClient();
  return useMutation<
    MessageDTO,
    ConversationApiError,
    {
      taskId: string;
      body?: string;
      clientKey?: string;
      mentions?: ConversationMentionPayload[];
    }
  >({
    mutationFn: ({ taskId, body, clientKey, mentions }) =>
      api.post<MessageDTO>(`/conversations/${conversationId}/task-cards`, {
        body: { taskId, body, clientKey, mentions },
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
 * immediately, then revalidate the authoritative database order.
 * Called both by mutation onSuccess (so the sender sees their message
 * instantly) and by the WS push handler (so the other side does too).
 *
 * The revalidation is intentional: two committed transactions can
 * broadcast in the opposite order, while PostgreSQL's `(created_at,
 * id)` order also contains microseconds the JSON Date cannot represent.
 * A cache-only prepend would eventually display a different order from
 * pagination and unread cursors.
 *
 * Idempotent — re-applying the same message id no-ops.
 */
export function applyIncomingMessage(
  qc: QueryClient,
  conversationId: string,
  message: MessageDTO,
  options: { revalidate?: boolean; optimisticClientKey?: string } = {}
) {
  const key = conversationKeys.messages(conversationId);
  qc.setQueryData<InfiniteData<MessagesResponse>>(key, (old) => {
    if (!old) return old;
    const clientKey = message.clientKey ?? options.optimisticClientKey;
    const optimisticId = clientKey ? optimisticMessageId(clientKey) : null;
    const withoutOptimistic = optimisticId
      ? {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            items: page.items.filter((item) => item.id !== optimisticId),
          })),
        }
      : old;
    // Server returns newest-first; the *first* page is the newest
    // batch, so prepend new messages there. Skip duplicates.
    const firstPage = withoutOptimistic.pages[0];
    if (!firstPage) return withoutOptimistic;
    if (withoutOptimistic.pages.some((page) => page.items.some((item) => item.id === message.id))) {
      // Already present — could be an update (proposal status flip).
      // Patch in place by id wherever pagination put it. Looking only
      // at page zero duplicated an older proposal when its status
      // changed or when a buffered frame was replayed.
      return {
        ...withoutOptimistic,
        pages: withoutOptimistic.pages.map((p) => ({
          ...p,
          items: p.items.map((m) => (m.id === message.id ? message : m)),
        })),
      };
    }
    const patchedFirst = { ...firstPage, items: [message, ...firstPage.items] };
    return {
      ...withoutOptimistic,
      pages: [patchedFirst, ...withoutOptimistic.pages.slice(1)],
    };
  });
  if (options.revalidate !== false) {
    qc.invalidateQueries({ queryKey: key });
    // Inbox previews go stale — fire a refetch.
    qc.invalidateQueries({ queryKey: conversationKeys.inbox() });
  }
}

const OPTIMISTIC_MESSAGE_PREFIX = "optimistic:";

export function optimisticMessageId(clientKey: string): string {
  return `${OPTIMISTIC_MESSAGE_PREFIX}${clientKey}`;
}

export function isOptimisticConversationMessage(message: MessageDTO): boolean {
  return message.id.startsWith(OPTIMISTIC_MESSAGE_PREFIX);
}

export function createOptimisticTextMessage({
  conversationId,
  authorId,
  body,
  clientKey,
  mentions = [],
}: {
  conversationId: string;
  authorId: string;
  body: string;
  clientKey: string;
  mentions?: ConversationMentionPayload[];
}): MessageDTO {
  return {
    id: optimisticMessageId(clientKey),
    conversationId,
    authorId,
    clientKey,
    type: "text",
    body,
    payload: mentions.length > 0 ? { kind: "text", mentions } : null,
    createdAt: new Date().toISOString(),
  };
}

export function applyOptimisticMessage(
  qc: QueryClient,
  conversationId: string,
  message: MessageDTO
) {
  const key = conversationKeys.messages(conversationId);
  qc.setQueryData<InfiniteData<MessagesResponse>>(key, (old) => {
    if (!old) return old;
    const firstPage = old.pages[0];
    if (!firstPage) return old;
    if (old.pages.some((page) => page.items.some((item) => item.id === message.id))) return old;
    return {
      ...old,
      pages: [{ ...firstPage, items: [message, ...firstPage.items] }, ...old.pages.slice(1)],
    };
  });
}

export function removeOptimisticMessage(
  qc: QueryClient,
  conversationId: string,
  optimisticId: string
) {
  qc.setQueryData<InfiniteData<MessagesResponse>>(
    conversationKeys.messages(conversationId),
    (old) =>
      old
        ? {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.filter((item) => item.id !== optimisticId),
            })),
          }
        : old
  );
}

function seedFirstMessage(qc: QueryClient, conversationId: string, message: MessageDTO) {
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

// ─── Realtime recovery + access revocation ─────────────────

export interface IncomingConversationMessage {
  conversationId: string;
  message: MessageDTO;
  lastMessageAt: string;
  unreadCount: number;
}

/**
 * A 403/404 is an authorization boundary, not a recoverable loading
 * failure. React Query deliberately keeps stale data after a
 * background error, so callers must explicitly forget both the
 * conversation identity and its message pages.
 */
export function isConversationAccessError(error: unknown): error is ConversationApiError {
  return error instanceof ConversationApiError && (error.status === 403 || error.status === 404);
}

export function clearConversationAccessCache(qc: QueryClient, conversationId: string): void {
  const detailKey = conversationKeys.detail(conversationId);
  const messagesKey = conversationKeys.messages(conversationId);

  // Cancellation consumes the AbortSignal passed by the query
  // functions above, preventing a late successful response from
  // restoring data after access was revoked.
  void qc.cancelQueries({ queryKey: detailKey, exact: true }, { silent: true });
  void qc.cancelQueries({ queryKey: messagesKey, exact: true }, { silent: true });
  qc.removeQueries({ queryKey: detailKey, exact: true });
  qc.removeQueries({ queryKey: messagesKey, exact: true });
  qc.setQueriesData<InfiniteData<InboxResponse>>({ queryKey: conversationKeys.inbox() }, (old) =>
    old
      ? {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            items: page.items.filter((item) => item.id !== conversationId),
          })),
        }
      : old
  );
  void qc.invalidateQueries({ queryKey: conversationKeys.inbox() });
}

export function useClearConversationAccessCache(): (conversationId: string) => void {
  const qc = useQueryClient();
  return useCallback(
    (conversationId: string) => clearConversationAccessCache(qc, conversationId),
    [qc]
  );
}

export interface ConversationRecoveryCoordinator {
  /**
   * Queue a realtime message behind an authoritative REST pass.
   * Resolves only after every frame that arrived during that pass has
   * survived a subsequent pass and has been replayed by id.
   */
  receiveMessage(data: IncomingConversationMessage): Promise<void>;
  /**
   * Recover every active conversation query after the authenticated
   * WS `ready` boundary.
   */
  recoverAll(): Promise<void>;
  dispose(): void;
}

/**
 * Serializes realtime frames with REST recovery.
 *
 * A plain `invalidateQueries` has a lost-update window:
 *
 *   REST starts -> WS frame patches cache -> old REST response lands
 *
 * The response replaces the page and silently erases the frame.
 * During a recovery cycle we therefore buffer frames by
 * `(conversationId,messageId)`, await REST, replay every buffered row,
 * and repeat if a frame arrived while REST was in flight. The final
 * pass necessarily started after the last observed frame, so its
 * `(created_at,id)` order is authoritative even when WS frames arrived
 * in reverse commit order and JSON timestamps lost database
 * microseconds.
 */
export function createConversationRecoveryCoordinator(
  qc: QueryClient
): ConversationRecoveryCoordinator {
  const buffered = new Map<string, IncomingConversationMessage>();
  const pendingConversationIds = new Set<string>();
  let frameVersion = 0;
  let fullRecoveryRequested = false;
  let disposed = false;
  let running: Promise<void> | null = null;

  const replayBuffered = () => {
    const cleared = new Set<string>();
    for (const data of buffered.values()) {
      const detailQuery = qc.getQueryCache().find({
        queryKey: conversationKeys.detail(data.conversationId),
        exact: true,
      });
      const timelineQuery = qc.getQueryCache().find({
        queryKey: conversationKeys.messages(data.conversationId),
        exact: true,
      });
      const accessWasRevoked =
        isConversationAccessError(detailQuery?.state.error) ||
        isConversationAccessError(timelineQuery?.state.error);
      if (accessWasRevoked) {
        // Never turn a 403/404 back into a successful stale query by
        // calling setQueryData. An observed ConversationView consumes
        // the error and latches its privacy boundary; an unobserved
        // cache can be forgotten immediately.
        const hasObserver =
          (detailQuery?.getObserversCount() ?? 0) > 0 ||
          (timelineQuery?.getObserversCount() ?? 0) > 0;
        if (!hasObserver && !cleared.has(data.conversationId)) {
          cleared.add(data.conversationId);
          clearConversationAccessCache(qc, data.conversationId);
        }
        continue;
      }
      if (timelineQuery?.state.error) {
        // A failed authoritative pass leaves ordering unknown. Do not
        // let setQueryData turn that errored query back into success:
        // the retry UI must obtain server order before this timeline
        // can advance its read cursor.
        continue;
      }
      applyIncomingMessage(qc, data.conversationId, data.message, {
        revalidate: false,
      });
    }
  };

  const run = async () => {
    while (!disposed) {
      const versionAtStart = frameVersion;
      const recoverEverything = fullRecoveryRequested;
      fullRecoveryRequested = false;
      const conversationIds = [...pendingConversationIds];
      pendingConversationIds.clear();

      try {
        if (recoverEverything) {
          // Inactive timelines must also become stale. They are not worth
          // fetching eagerly, but the next mount must not trust a
          // pre-disconnect value for the global 60s stale window.
          await qc.invalidateQueries({
            queryKey: conversationKeys.all,
            refetchType: "none",
          });
          await qc.refetchQueries({
            queryKey: conversationKeys.all,
            type: "active",
          });
        } else {
          await Promise.all([
            ...conversationIds.map((conversationId) =>
              qc.refetchQueries({
                queryKey: conversationKeys.messages(conversationId),
                exact: true,
                // If this timeline was open recently but unmounted, keep
                // its cached total order authoritative too. Queries that
                // have never existed are still skipped.
                type: "all",
              })
            ),
            qc.refetchQueries({
              queryKey: conversationKeys.inbox(),
              type: "all",
            }),
          ]);
        }
      } catch {
        // QueryClient normally records refetch failures on the query
        // instead of rejecting. Custom clients may opt into throwing;
        // buffered frames are still safer than silently losing them.
        // The errored query remains stale and its normal retry UI can
        // obtain the authoritative order later.
      }

      if (disposed) return;

      // REST is allowed to replace an InfiniteData value. Replay after
      // it settles, updating an existing id in place or restoring a row
      // that the request's snapshot did not include.
      replayBuffered();

      if (
        !fullRecoveryRequested &&
        pendingConversationIds.size === 0 &&
        frameVersion === versionAtStart
      ) {
        buffered.clear();
        return;
      }
      // A frame arrived while REST was in flight. Keep the complete
      // buffer, and perform another authoritative pass before exposing
      // the cycle as settled.
    }
  };

  const schedule = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (!running) {
      running = run().finally(() => {
        running = null;
        if (!disposed && (fullRecoveryRequested || pendingConversationIds.size > 0)) {
          void schedule();
        }
      });
    }
    return running;
  };

  return {
    receiveMessage(data) {
      const key = `${data.conversationId}\u0000${data.message.id}`;
      buffered.set(key, data);
      pendingConversationIds.add(data.conversationId);
      frameVersion += 1;
      return schedule();
    },
    recoverAll() {
      fullRecoveryRequested = true;
      return schedule();
    },
    dispose() {
      disposed = true;
      buffered.clear();
      pendingConversationIds.clear();
    },
  };
}
