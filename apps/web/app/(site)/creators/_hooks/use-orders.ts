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

const BASE = "/aurora";

export class OrderApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(
      (body && typeof body === "object" && "message" in body
        ? String((body as { message: unknown }).message)
        : null) ?? `Order API error ${status}`
    );
    this.name = "OrderApiError";
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
  list: (params: ListOrdersParams) =>
    ["order", "list", params.role ?? "both", params.status ?? "", params.limit ?? ""] as const,
  detail: (id: string) => ["order", "detail", id] as const,
};

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: orderKeys.lists() });
}

// ─── Queries ───────────────────────────────────────────────

export function useOrders(params: ListOrdersParams = {}) {
  return useInfiniteQuery<
    ListResponse,
    OrderApiError,
    { items: OrderCardDTO[]; hasMore: boolean },
    ReturnType<typeof orderKeys.list>,
    string | null
  >({
    queryKey: orderKeys.list(params),
    initialPageParam: null,
    queryFn: ({ pageParam }) =>
      api.get<ListResponse>("/orders", {
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
  return useQuery<OrderDTO, OrderApiError>({
    queryKey: id ? orderKeys.detail(id) : ["order", "detail", "_none"],
    enabled: !!id,
    queryFn: () => api.get<OrderDTO>(`/orders/${id}`),
  });
}

// ─── Mutations ─────────────────────────────────────────────

function applyOrderResult(qc: ReturnType<typeof useQueryClient>, order: OrderDTO) {
  qc.setQueryData(orderKeys.detail(order.id), order);
  invalidateAll(qc);
}

export function useSubmitOrder() {
  const qc = useQueryClient();
  return useMutation<OrderDTO, OrderApiError, SubmitOrderBody>({
    mutationFn: (body) => api.post<OrderDTO>("/orders", { body }),
    onSuccess: (order) => applyOrderResult(qc, order),
  });
}

export function useAcceptProposal() {
  const qc = useQueryClient();
  return useMutation<OrderDTO, OrderApiError, { conversationId: string; messageId: string }>({
    mutationFn: ({ conversationId, messageId }) =>
      api.post<OrderDTO>(`/orders/from-proposal/${conversationId}/${messageId}`),
    onSuccess: (order) => applyOrderResult(qc, order),
  });
}

export function useAcceptOrder() {
  const qc = useQueryClient();
  return useMutation<OrderDTO, OrderApiError, { id: string }>({
    mutationFn: ({ id }) => api.post<OrderDTO>(`/orders/${id}/accept`),
    onSuccess: (order) => applyOrderResult(qc, order),
  });
}

export function useDeclineOrder() {
  const qc = useQueryClient();
  return useMutation<OrderDTO, OrderApiError, { id: string; reason: string }>({
    mutationFn: ({ id, reason }) =>
      api.post<OrderDTO>(`/orders/${id}/decline`, { body: { reason } }),
    onSuccess: (order) => applyOrderResult(qc, order),
  });
}

export function useDeliverOrder() {
  const qc = useQueryClient();
  return useMutation<OrderDTO, OrderApiError, { id: string }>({
    mutationFn: ({ id }) => api.post<OrderDTO>(`/orders/${id}/deliver`),
    onSuccess: (order) => applyOrderResult(qc, order),
  });
}

export function useAcceptDelivery() {
  const qc = useQueryClient();
  return useMutation<OrderDTO, OrderApiError, { id: string }>({
    mutationFn: ({ id }) => api.post<OrderDTO>(`/orders/${id}/accept-delivery`),
    onSuccess: (order) => applyOrderResult(qc, order),
  });
}

export function useRequestRevision() {
  const qc = useQueryClient();
  return useMutation<OrderDTO, OrderApiError, { id: string; reason: string }>({
    mutationFn: ({ id, reason }) =>
      api.post<OrderDTO>(`/orders/${id}/request-revision`, {
        body: { reason },
      }),
    onSuccess: (order) => applyOrderResult(qc, order),
  });
}

export function useCancelOrder() {
  const qc = useQueryClient();
  return useMutation<OrderDTO, OrderApiError, { id: string; reason: string }>({
    mutationFn: ({ id, reason }) =>
      api.post<OrderDTO>(`/orders/${id}/cancel`, { body: { reason } }),
    onSuccess: (order) => applyOrderResult(qc, order),
  });
}
