/**
 * Fetch helpers for the crew Nest endpoints at `/aurora/crews/*`.
 *
 * RESTful contract: real HTTP status codes (4xx/5xx → throw), JSON body
 * on success, JSON `{ message, ...extras }` on failures. We use bare
 * `fetch()` rather than the legacy api-client because that client wraps
 * Java's `{code, msg, data}` envelope; here we want the actual response
 * body to be the data, and status semantics to be native.
 */

const BASE = "/aurora";

export class CrewApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(
      (body && typeof body === "object" && "message" in body
        ? String((body as { message: unknown }).message)
        : null) ?? `Crew API error ${status}`
    );
    this.name = "CrewApiError";
  }
}

interface CallOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  query?: Record<string, string | number | undefined>;
}

async function call<T>(method: string, path: string, opts: CallOptions = {}): Promise<T> {
  const url = buildUrl(path, opts.query);
  const init: RequestInit = {
    method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers ?? {}),
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  };
  const res = await fetch(url, init);

  // 204 No Content has no parseable body.
  if (res.status === 204) return undefined as T;

  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = await res.text().catch(() => null);
    }
    throw new CrewApiError(res.status, body);
  }
  return (await res.json()) as T;
}

function buildUrl(path: string, query?: CallOptions["query"]): string {
  const url = `${BASE}${path}`;
  if (!query) return url;
  const entries = Object.entries(query).filter(([, v]) => v !== undefined && v !== "");
  if (entries.length === 0) return url;
  const qs = new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
  return `${url}?${qs}`;
}

export const crewApi = {
  get: <T>(path: string, opts?: CallOptions) => call<T>("GET", path, opts),
  post: <T>(path: string, opts?: CallOptions) => call<T>("POST", path, opts),
  patch: <T>(path: string, opts?: CallOptions) => call<T>("PATCH", path, opts),
  delete: <T>(path: string, opts?: CallOptions) => call<T>("DELETE", path, opts),
};
