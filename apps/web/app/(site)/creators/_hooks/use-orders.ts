/**
 * Orders feature data layer.
 *
 * Endpoints:
 *   POST   /aurora/orders                                  submit
 *   POST   /aurora/orders/from-proposal/:cid/:mid          accept proposal
 *   GET    /aurora/orders                                  list (role filter)
 *   GET    /aurora/orders/:id                              detail
 *   POST   /aurora/orders/:id/accept|decline|deliver|...   transitions
 */

"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OrderBindings, OrderCardDTO, OrderDTO, OrderStatus } from "@repo/shared/order";
import type { ServiceTier } from "@repo/shared/creator-service";

import { useCurrentUser } from "@/src/hooks/use-user";

const BASE = "/aurora";

export class OrderApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(
      (typeof body === "string" && body.trim()
        ? body
        : body && typeof body === "object" && "message" in body
          ? String((body as { message: unknown }).message)
          : null) ?? `Order API error ${status}`
    );
    this.name = "OrderApiError";
  }
}

interface CallOpts {
  signal?: AbortSignal;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
}

async function call<T>(method: string, path: string, opts: CallOpts = {}): Promise<T> {
  const url = buildUrl(path, opts.query);
  const init: RequestInit = {
    method,
    cache: "no-store",
    signal: opts.signal,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  };
  const res = await fetch(url, init);
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // Consume once: JSON parsing failure must not discard a plain-text error.
    }
    throw new OrderApiError(res.status, body);
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

export interface SubmitOrderBody {
  serviceId: string;
  packageTier: ServiceTier;
  answers?: { questionId: string; answer: string }[];
  bindings?: OrderBindings;
  note?: string;
  /**
   * Client-minted UUID per submit intent. Resending it on retry /
   * double-click dedupes server-side — same key returns the
   * original order rather than creating a duplicate. Recommended
   * for every UI surface; legacy callers without it are still
   * accepted but lose dedup protection.
   */
  idempotencyKey?: string;
}

interface ListOrdersParams {
  role?: "buyer" | "creator" | "both";
  status?: OrderStatus;
  limit?: number;
}

interface ListResponse {
  items: OrderCardDTO[];
  nextCursor: string | null;
}

// ─── Cache keys ────────────────────────────────────────────

export const orderKeys = {
  all: ["order"] as const,
  lists: () => ["order", "list"] as const,
  list: (params: ListOrdersParams, ownerId?: string | null) =>
    [
      "order",
      "list",
      params.role ?? "both",
      params.status ?? "",
      params.limit ?? "",
      ...(ownerId === undefined ? [] : [ownerId]),
    ] as const,
  detail: (id: string, ownerId?: string | null) =>
    ["order", "detail", id, ...(ownerId === undefined ? [] : [ownerId])] as const,
};

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: orderKeys.lists() });
}

// ─── Queries ───────────────────────────────────────────────

export function useOrders(params: ListOrdersParams = {}) {
  const { user } = useCurrentUser();
  return useInfiniteQuery<
    ListResponse,
    OrderApiError,
    { items: OrderCardDTO[]; hasMore: boolean },
    ReturnType<typeof orderKeys.list>,
    string | null
  >({
    queryKey: orderKeys.list(params, user?.id ?? null),
    enabled: !!user?.id,
    initialPageParam: null,
    queryFn: ({ pageParam, signal }) =>
      api.get<ListResponse>("/orders", {
        signal,
        query: {
          role: params.role ?? "both",
          ...(params.status ? { status: params.status } : {}),
          limit: params.limit ?? 24,
          ...(pageParam ? { cursor: pageParam } : {}),
        },
      }),
    getNextPageParam: (last) => last.nextCursor,
    select: (data) => {
      const items: OrderCardDTO[] = [];
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

export function useOrder(id: string | null) {
  const { user } = useCurrentUser();
  return useQuery<OrderDTO, OrderApiError>({
    queryKey: orderKeys.detail(id ?? "_none", user?.id ?? null),
    enabled: !!id && !!user?.id,
    queryFn: ({ signal }) => api.get<OrderDTO>(`/orders/${id}`, { signal }),
  });
}

// ─── Mutations ─────────────────────────────────────────────

interface OrderMutationContext {
  ownerId: string | null;
}

function applyOrderResult(
  qc: ReturnType<typeof useQueryClient>,
  order: OrderDTO,
  ownerId: string | null
) {
  if (ownerId != null) qc.setQueryData(orderKeys.detail(order.id, ownerId), order);
  invalidateAll(qc);
}

export function useSubmitOrder() {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  return useMutation<OrderDTO, OrderApiError, SubmitOrderBody, OrderMutationContext>({
    mutationFn: (body) => api.post<OrderDTO>("/orders", { body }),
    onMutate: () => ({ ownerId: user?.id ?? null }),
    onSuccess: (order, _variables, context) =>
      applyOrderResult(qc, order, context?.ownerId ?? null),
  });
}

export function useAcceptProposal() {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  return useMutation<
    OrderDTO,
    OrderApiError,
    { conversationId: string; messageId: string },
    OrderMutationContext
  >({
    mutationFn: ({ conversationId, messageId }) =>
      api.post<OrderDTO>(`/orders/from-proposal/${conversationId}/${messageId}`),
    onMutate: () => ({ ownerId: user?.id ?? null }),
    onSuccess: (order, _variables, context) =>
      applyOrderResult(qc, order, context?.ownerId ?? null),
  });
}

export function useAcceptOrder() {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  return useMutation<OrderDTO, OrderApiError, { id: string }, OrderMutationContext>({
    mutationFn: ({ id }) => api.post<OrderDTO>(`/orders/${id}/accept`),
    onMutate: () => ({ ownerId: user?.id ?? null }),
    onSuccess: (order, _variables, context) =>
      applyOrderResult(qc, order, context?.ownerId ?? null),
  });
}

export function useDeclineOrder() {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  return useMutation<OrderDTO, OrderApiError, { id: string; reason: string }, OrderMutationContext>(
    {
      mutationFn: ({ id, reason }) =>
        api.post<OrderDTO>(`/orders/${id}/decline`, { body: { reason } }),
      onMutate: () => ({ ownerId: user?.id ?? null }),
      onSuccess: (order, _variables, context) =>
        applyOrderResult(qc, order, context?.ownerId ?? null),
    }
  );
}

export function useDeliverOrder() {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  return useMutation<OrderDTO, OrderApiError, { id: string }, OrderMutationContext>({
    mutationFn: ({ id }) => api.post<OrderDTO>(`/orders/${id}/deliver`),
    onMutate: () => ({ ownerId: user?.id ?? null }),
    onSuccess: (order, _variables, context) =>
      applyOrderResult(qc, order, context?.ownerId ?? null),
  });
}

export function useAcceptDelivery() {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  return useMutation<OrderDTO, OrderApiError, { id: string }, OrderMutationContext>({
    mutationFn: ({ id }) => api.post<OrderDTO>(`/orders/${id}/accept-delivery`),
    onMutate: () => ({ ownerId: user?.id ?? null }),
    onSuccess: (order, _variables, context) =>
      applyOrderResult(qc, order, context?.ownerId ?? null),
  });
}

export function useRequestRevision() {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  return useMutation<OrderDTO, OrderApiError, { id: string; reason: string }, OrderMutationContext>(
    {
      mutationFn: ({ id, reason }) =>
        api.post<OrderDTO>(`/orders/${id}/request-revision`, {
          body: { reason },
        }),
      onMutate: () => ({ ownerId: user?.id ?? null }),
      onSuccess: (order, _variables, context) =>
        applyOrderResult(qc, order, context?.ownerId ?? null),
    }
  );
}

export function useCancelOrder() {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  return useMutation<OrderDTO, OrderApiError, { id: string; reason: string }, OrderMutationContext>(
    {
      mutationFn: ({ id, reason }) =>
        api.post<OrderDTO>(`/orders/${id}/cancel`, { body: { reason } }),
      onMutate: () => ({ ownerId: user?.id ?? null }),
      onSuccess: (order, _variables, context) =>
        applyOrderResult(qc, order, context?.ownerId ?? null),
    }
  );
}
