/**
 * REST fetchers for the in-app notification inbox.
 *
 * Endpoints live under `/aurora/notifications/*` (Nest, RESTful, real
 * HTTP status codes — no Java-style body.code envelope). We use plain
 * `fetch` rather than the legacy api-client because that client is
 * built around envelope unwrap; here we want native status semantics
 * (200 / 401 / 404) and the JSON body is the data, not a wrapper.
 *
 * Auth: cookie-based — satoken rides with the request automatically
 * for same-origin calls. No bearer header.
 */

import type { NotificationDTO, NotificationFilter } from "@repo/shared/notifications";

const BASE = "/aurora/notifications";

export interface ListResult {
  items: NotificationDTO[];
  nextCursor: string | null;
}

async function jsonFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    credentials: "include",
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    // Surface enough detail for the UI to show a meaningful message
    // without parsing every error shape — body is best-effort JSON.
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // Proxies may return text rather than the Nest error envelope.
    }
    throw new NotificationApiError(res.status, body);
  }
  return (await res.json()) as T;
}

export class NotificationApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown
  ) {
    const detail = body && typeof body === "object" && "message" in body ? body.message : body;
    const message = Array.isArray(detail) ? detail.join("; ") : detail;
    super(
      typeof message === "string" && message.trim() ? message : `Notification API error ${status}`
    );
    this.name = "NotificationApiError";
  }
}

export function listNotifications(
  opts: { limit?: number; cursor?: string; filter?: NotificationFilter } = {},
  signal?: AbortSignal
): Promise<ListResult> {
  const qs = new URLSearchParams();
  if (opts.limit) qs.set("limit", String(opts.limit));
  if (opts.cursor) qs.set("cursor", opts.cursor);
  if (opts.filter) qs.set("filter", opts.filter);
  const path = qs.toString() ? `${BASE}?${qs.toString()}` : BASE;
  return jsonFetch<ListResult>(path, { signal });
}

export function fetchUnreadCount(signal?: AbortSignal): Promise<{ count: number }> {
  return jsonFetch<{ count: number }>(`${BASE}/unread-count`, { signal });
}

export function markNotificationRead(id: string): Promise<NotificationDTO> {
  return jsonFetch<NotificationDTO>(`${BASE}/${encodeURIComponent(id)}/read`, {
    method: "POST",
    keepalive: true,
  });
}

export function markAllNotificationsRead(): Promise<{ count: number }> {
  return jsonFetch<{ count: number }>(`${BASE}/read-all`, { method: "POST" });
}
