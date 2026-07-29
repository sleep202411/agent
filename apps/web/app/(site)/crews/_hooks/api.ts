/**
 * Fetch helpers for the crew Nest endpoints at `/aurora/crews/*`.
 *
 * RESTful contract: real HTTP status codes (4xx/5xx → throw), JSON body
 * on success, JSON `{ message, issues?, ...extras }` on failures — see
 * `CrewApiError` for how the two message halves merge. We use bare
 * `fetch()` rather than the legacy api-client because that client wraps
 * Java's `{code, msg, data}` envelope; here we want the actual response
 * body to be the data, and status semantics to be native.
 */

const BASE = "/aurora";

/**
 * The one string `ZodValidationPipe` puts in `message` for every schema
 * rejection in the server (`apps/server/src/common/zod.pipe.ts`). It
 * carries no information — the actionable text (`'A submission needs a
 * url or a note'`, `'deadline must be YYYY-MM-DD'`, …) is in `issues[]`.
 */
const GENERIC_VALIDATION_MESSAGE = "Validation failed";

interface CrewApiIssue {
  path?: string;
  message: string;
}

/**
 * Error thrown for every non-2xx crew response, carrying the raw status
 * and body for callers that want to branch on them.
 *
 * `.message` is what the UI shows (`err.message` lands in a toast or in
 * the submit dialog's inline error), so it has to be the server's own
 * words — see root `AGENTS.md § Error reporting`.
 *
 * Why the merge happens here and not in the pipe: `{ message, issues }`
 * is the server-wide error contract, not a crew invention — other
 * producers (`studio-agent.capability-executor.ts`,
 * `admin-auth.service.ts`) emit the same shape, and
 * `src/lib/assistant/assistant-client.ts` already composes the two
 * halves for its own surface. Rewriting the pipe's top-level `message`
 * would change every endpoint in the server and hand that client the
 * detail twice. The detail is being dropped on this side of the wire,
 * so this is where it gets picked back up.
 */
export class CrewApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(describeError(status, body));
    this.name = "CrewApiError";
  }
}

function describeError(status: number, body: unknown): string {
  if (!body || typeof body !== "object") return `Crew API error ${status}`;
  const { message, issues } = body as { message?: unknown; issues?: unknown };
  const headline = typeof message === "string" && message.length > 0 ? message : null;
  const detail = describeIssues(issues);

  if (!detail) return headline ?? `Crew API error ${status}`;
  // The pipe's constant adds nothing in front of the real reason; any
  // other headline is the producer's own sentence and stays.
  if (!headline || headline === GENERIC_VALIDATION_MESSAGE) return detail;
  return `${headline}: ${detail}`;
}

/** `[{ path: 'url', message: 'A submission needs a url or a note' }]`
 *  → `"url: A submission needs a url or a note"`. The field prefix is
 *  what makes a bare Zod string ("Too big: expected string to have
 *  <=1024 characters") legible on a multi-field form. */
function describeIssues(issues: unknown): string | null {
  if (!Array.isArray(issues)) return null;
  const parts = issues
    .filter((i): i is CrewApiIssue => !!i && typeof i === "object" && "message" in i)
    .map((i) => (i.path ? `${i.path}: ${i.message}` : i.message))
    .filter((line) => line.length > 0);
  return parts.length > 0 ? parts.join("; ") : null;
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
  put: <T>(path: string, opts?: CallOptions) => call<T>("PUT", path, opts),
  patch: <T>(path: string, opts?: CallOptions) => call<T>("PATCH", path, opts),
  delete: <T>(path: string, opts?: CallOptions) => call<T>("DELETE", path, opts),
};
