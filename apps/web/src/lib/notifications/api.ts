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

import type { NotificationDTO } from "@repo/shared/notifications";

const BASE = "/aurora/notifications";

export interface ListResult {
  items: NotificationDTO[];
  nextCursor: string | null;
}

async function jsonFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    // Surface enough detail for the UI to show a meaningful message
    // without parsing every error shape — body is best-effort JSON.
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = await res.text().catch(() => null);
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
    super(`Notification API error ${status}`);
    this.name = "NotificationApiError";
  }
}

export function listNotifications(
  opts: { limit?: number; cursor?: string } = {}
): Promise<ListResult> {
  const qs = new URLSearchParams();
  if (opts.limit) qs.set("limit", String(opts.limit));
  if (opts.cursor) qs.set("cursor", opts.cursor);
  const path = qs.toString() ? `${BASE}?${qs.toString()}` : BASE;
  return jsonFetch<ListResult>(path);
}

export function fetchUnreadCount(): Promise<{ count: number }> {
  return jsonFetch<{ count: number }>(`${BASE}/unread-count`);
}

export function markNotificationRead(id: string): Promise<NotificationDTO> {
  return jsonFetch<NotificationDTO>(`${BASE}/${encodeURIComponent(id)}/read`, {
    method: "POST",
  });
}

export function markAllNotificationsRead(): Promise<{ count: number }> {
  return jsonFetch<{ count: number }>(`${BASE}/read-all`, { method: "POST" });
}
