/**
 * Creator-services feature data layer.
 *
 * Backend:
 *   GET    /aurora/creator-services            list (public + owner)
 *   GET    /aurora/creator-services/:id        detail
 *   POST   /aurora/creator-services            create (auth)
 *   PATCH  /aurora/creator-services/:id        update (owner)
 *   POST   /aurora/creator-services/:id/publish | pause | resume
 *   DELETE /aurora/creator-services/:id        archive
 *
 * Cache key shape:
 *   ["creator-service", "list", queryFingerprint, viewerId]
 *   ["creator-service", "detail", id, viewerId]
 *
 * Mutations invalidate the list (any list — easier than diffing query
 * keys) plus the specific detail row. Owner-side optimistic updates
 * aren't worth the complexity for Phase 1a — list refetch is fast.
 */

"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreatorServiceCardDTO,
  CreatorServiceDTO,
  CreatorServiceStatus,
  ServiceCategory,
} from "@repo/shared/creator-service";

import { useCurrentUser } from "@/src/hooks/use-user";

// ─── Fetch helpers ──────────────────────────────────────────

const BASE = "/aurora";

export class ServiceApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(
      (typeof body === "string" && body.trim()
        ? body
        : body && typeof body === "object" && "message" in body
          ? String((body as { message: unknown }).message)
          : null) ?? `Service API error ${status}`
    );
    this.name = "ServiceApiError";
  }
}

interface CallOpts {
  signal?: AbortSignal;
  credentials?: RequestCredentials;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
}

async function call<T>(method: string, path: string, opts: CallOpts = {}): Promise<T> {
  const url = buildUrl(path, opts.query);
  const init: RequestInit = {
    method,
    credentials: opts.credentials ?? "include",
    cache: "no-store",
    signal: opts.signal,
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
    throw new ServiceApiError(res.status, body);
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

const serviceApi = {
  get: <T>(path: string, opts?: CallOpts) => call<T>("GET", path, opts),
  post: <T>(path: string, opts?: CallOpts) => call<T>("POST", path, opts),
  patch: <T>(path: string, opts?: CallOpts) => call<T>("PATCH", path, opts),
  delete: <T>(path: string, opts?: CallOpts) => call<T>("DELETE", path, opts),
};

// ─── Wire input shapes ─────────────────────────────────────

/**
 * Mirror of the server's `PackageInputSchema`. Kept loose-typed on
 * scope[] / etc. so form drafts can pass partials before validation.
 */
export interface ServicePackageInput {
  tier: "basic" | "standard" | "premium";
  title: string;
  description: string;
  currency: string;
  price: number;
  deliveryDays: number;
  revisions: number;
  scope: string[];
}

/**
 * Wire shape for a single requirement question. Mirrors
 * QuestionInputSchema on the server — `id` is optional so a
 * brand-new (client-only) question lets the server mint the
 * stable id.
 */
export interface ServiceRequirementQuestionInput {
  id?: string;
  prompt: string;
  helpText: string;
  required: boolean;
  displayOrder: number;
}

export interface CreateServiceBody {
  title: string;
  summary: string;
  coverPath?: string;
  category: ServiceCategory;
  tags?: string[];
  packages?: ServicePackageInput[];
  requirementQuestions?: ServiceRequirementQuestionInput[];
}

export interface UpdateServiceBody {
  title?: string;
  summary?: string;
  coverPath?: string;
  category?: ServiceCategory;
  tags?: string[];
  packages?: ServicePackageInput[];
  requirementQuestions?: ServiceRequirementQuestionInput[];
  expectedVersion?: number;
}

export interface ListServicesParams {
  creatorId?: string;
  category?: ServiceCategory;
  q?: string;
  status?: CreatorServiceStatus;
  limit?: number;
}

interface ListResponse {
  items: CreatorServiceCardDTO[];
  nextCursor: string | null;
}

// ─── Cache keys ────────────────────────────────────────────

export const serviceKeys = {
  all: ["creator-service"] as const,
  lists: () => ["creator-service", "list"] as const,
  list: (params: ListServicesParams, viewerId?: string | null) =>
    [
      "creator-service",
      "list",
      fingerprint(params),
      ...(viewerId === undefined ? [] : [viewerId]),
    ] as const,
  details: () => ["creator-service", "detail"] as const,
  detail: (id: string, viewerId?: string | null) =>
    ["creator-service", "detail", id, ...(viewerId === undefined ? [] : [viewerId])] as const,
};

function fingerprint(p: ListServicesParams): string {
  // Stable string so React Query caches identical queries together.
  return [p.creatorId ?? "", p.category ?? "", p.status ?? "", p.q ?? "", p.limit ?? ""].join("|");
}

// ─── Queries ───────────────────────────────────────────────

/**
 * Infinite-scroll list. Default: plaza ("all listed services").
 * Pass `{ creatorId }` to scope to one creator (used by ServicesTab).
 */
export function useCreatorServices(params: ListServicesParams = {}) {
  const { user, isLoading } = useCurrentUser();
  return useInfiniteQuery<
    ListResponse,
    ServiceApiError,
    { items: CreatorServiceCardDTO[]; hasMore: boolean },
    ReturnType<typeof serviceKeys.list>,
    string | null
  >({
    queryKey: serviceKeys.list(params, user?.id ?? null),
    enabled: !isLoading,
    initialPageParam: null,
    queryFn: ({ pageParam, signal }) =>
      serviceApi.get<ListResponse>("/creator-services", {
        signal,
        credentials: user ? "include" : "omit",
        query: {
          ...(params.creatorId ? { creatorId: params.creatorId } : {}),
          ...(params.category ? { category: params.category } : {}),
          ...(params.status ? { status: params.status } : {}),
          ...(params.q ? { q: params.q } : {}),
          limit: params.limit ?? 24,
          ...(pageParam ? { cursor: pageParam } : {}),
        },
      }),
    getNextPageParam: (last) => last.nextCursor,
    select: (data) => {
      const items: CreatorServiceCardDTO[] = [];
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

/** Detail by id (plaza card click-through or owner edit prefill). */
export function useCreatorService(id: string | null) {
  const { user, isLoading } = useCurrentUser();
  return useQuery<CreatorServiceDTO, ServiceApiError>({
    queryKey: serviceKeys.detail(id ?? "_none", user?.id ?? null),
    enabled: !!id && !isLoading,
    queryFn: ({ signal }) =>
      serviceApi.get<CreatorServiceDTO>(`/creator-services/${id}`, {
        signal,
        credentials: user ? "include" : "omit",
      }),
  });
}

// ─── Mutations ─────────────────────────────────────────────

function invalidateServiceCaches(qc: ReturnType<typeof useQueryClient>) {
  // Coarse invalidation — list payloads are small (≤ 60 cards) so a
  // refetch is cheap and avoids the per-key diff logic.
  qc.invalidateQueries({ queryKey: serviceKeys.lists() });
}

type ServiceMutationContext = { ownerId: string | null };

export function useCreateService() {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  return useMutation<CreatorServiceDTO, ServiceApiError, CreateServiceBody, ServiceMutationContext>(
    {
      mutationFn: (body) => serviceApi.post<CreatorServiceDTO>("/creator-services", { body }),
      onMutate: () => ({ ownerId: user?.id ?? null }),
      onSuccess: (created, _variables, context) =>
        applyServiceWriteResult(qc, created, context?.ownerId ?? null),
    }
  );
}

/**
 * All state-transition hooks take the service id at call time
 * (`mutateAsync({ id, ... })`) rather than at hook-construction time.
 *
 * The id-at-construction pattern broke for the create→publish flow
 * inside the dialog: a fresh create only learns the id from the
 * mutation response, so the publish step ended up using a raw
 * `fetch()` that bypassed the React Query cache. The call-time
 * pattern lets the dialog chain `create.mutateAsync(...)` then
 * `publish.mutateAsync({ id: created.id })` through the same cache
 * machinery used everywhere else.
 */
function applyServiceWriteResult(
  qc: ReturnType<typeof useQueryClient>,
  updated: CreatorServiceDTO,
  ownerId: string | null
) {
  if (ownerId) qc.setQueryData(serviceKeys.detail(updated.id, ownerId), updated);
  qc.invalidateQueries({ queryKey: serviceKeys.detail(updated.id) });
  invalidateServiceCaches(qc);
}

export function useUpdateService() {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  return useMutation<
    CreatorServiceDTO,
    ServiceApiError,
    { id: string; body: UpdateServiceBody },
    ServiceMutationContext
  >({
    mutationFn: ({ id, body }) =>
      serviceApi.patch<CreatorServiceDTO>(`/creator-services/${id}`, { body }),
    onMutate: () => ({ ownerId: user?.id ?? null }),
    onSuccess: (updated, _variables, context) =>
      applyServiceWriteResult(qc, updated, context?.ownerId ?? null),
  });
}

export function usePublishService() {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  return useMutation<CreatorServiceDTO, ServiceApiError, { id: string }, ServiceMutationContext>({
    mutationFn: ({ id }) =>
      serviceApi.post<CreatorServiceDTO>(`/creator-services/${id}/publish`, {
        body: {},
      }),
    onMutate: () => ({ ownerId: user?.id ?? null }),
    onSuccess: (updated, _variables, context) =>
      applyServiceWriteResult(qc, updated, context?.ownerId ?? null),
  });
}

export function usePauseService() {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  return useMutation<CreatorServiceDTO, ServiceApiError, { id: string }, ServiceMutationContext>({
    mutationFn: ({ id }) => serviceApi.post<CreatorServiceDTO>(`/creator-services/${id}/pause`),
    onMutate: () => ({ ownerId: user?.id ?? null }),
    onSuccess: (updated, _variables, context) =>
      applyServiceWriteResult(qc, updated, context?.ownerId ?? null),
  });
}

export function useResumeService() {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  return useMutation<CreatorServiceDTO, ServiceApiError, { id: string }, ServiceMutationContext>({
    mutationFn: ({ id }) => serviceApi.post<CreatorServiceDTO>(`/creator-services/${id}/resume`),
    onMutate: () => ({ ownerId: user?.id ?? null }),
    onSuccess: (updated, _variables, context) =>
      applyServiceWriteResult(qc, updated, context?.ownerId ?? null),
  });
}

export function useArchiveService() {
  const qc = useQueryClient();
  return useMutation<void, ServiceApiError, string>({
    mutationFn: (id) => serviceApi.delete(`/creator-services/${id}`),
    onSuccess: (_void, id) => {
      qc.removeQueries({ queryKey: serviceKeys.detail(id) });
      invalidateServiceCaches(qc);
    },
  });
}
