/**
 * The one thing the two apps genuinely do differently: how bytes reach
 * Java.
 *
 * `apps/web` routes every `/user/*` call through a cell-specific path
 * prefix (`NEXT_PUBLIC_API_CONTENT_PREFIX`, e.g. `/content/user/...`) so
 * nginx can send it straight to the content service; `apps/studio`
 * rewrites `/user/*` in `next.config.ts` and calls it bare.
 *
 * Everything above the wire — endpoints, param names, the envelope, the
 * token positions — stays in this package, so a transport is deliberately
 * dumb: it performs the request and hands back the parsed JSON object.
 */

export interface AuthRequest {
  method: "GET" | "POST";
  /** Java path, always leading-slash, never prefixed. */
  path: string;
  query?: Record<string, string>;
  /** `application/x-www-form-urlencoded` body — the Java auth contract. */
  form?: Record<string, string>;
  /** JSON body, for the non-auth `/user/update/user/info` call. */
  json?: unknown;
  /** `multipart/form-data` single-file body, for the avatar upload. */
  file?: { field: string; value: File };
}

export interface AuthResponse {
  status: number;
  /**
   * The parsed JSON object. Every endpoint in this contract answers with
   * the `{ code, msg, … }` envelope, so anything else — HTML, an empty
   * body, a bare array — is a failure, not a response (see
   * `AuthTransportError`).
   */
  body: Record<string, unknown>;
}

export interface AuthTransport {
  request(input: AuthRequest): Promise<AuthResponse>;
}

/**
 * A request that never produced a usable response.
 *
 * `reason` separates "the connection failed us" from "something answered
 * with bytes we cannot read", which are different bugs with different
 * fixes and must not share one error message. `network` covers the whole
 * connection, headers and body alike — a response that dies mid-stream
 * is the user's signal, not the server's output. A gateway HTML error
 * page and a body-less 200 are the second kind, and used to be reported
 * as a SUCCESSFUL sign-in with a missing token.
 */
export class AuthTransportError extends Error {
  readonly reason: "network" | "invalid_response";
  /** HTTP status, when there was one. */
  readonly status?: number;

  constructor(reason: "network" | "invalid_response", status?: number) {
    super(reason);
    this.name = "AuthTransportError";
    this.reason = reason;
    this.status = status;
  }
}

export interface FetchTransportOptions {
  /**
   * Map a Java path onto this app's URL space. `apps/web` passes its
   * cell prefix resolver here; `apps/studio` omits it.
   */
  resolvePath?: (path: string) => string;
  /** Extra headers per request — `accept-language` in both apps. */
  headers?: () => Record<string, string>;
  /** Escape hatch for tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * Reference transport. Both apps use it; only `resolvePath` differs.
 *
 * `credentials: "include"` is required — the session rides the `satoken`
 * cookie, and the authenticated steps (invite bind, profile save) are
 * made moments after login on the same origin.
 */
export function createFetchTransport(options: FetchTransportOptions = {}): AuthTransport {
  const doFetch = options.fetchImpl ?? fetch;
  const resolvePath = options.resolvePath ?? ((path: string) => path);

  return {
    async request({ method, path, query, form, json, file }) {
      const url = new URL(resolvePath(path), currentOrigin());
      for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);

      const headers: Record<string, string> = { ...(options.headers?.() ?? {}) };
      let body: BodyInit | undefined;

      if (form) {
        headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
        body = new URLSearchParams(form).toString();
      } else if (json !== undefined) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(json);
      } else if (file) {
        // No explicit Content-Type: the browser has to add the multipart
        // boundary itself.
        const data = new FormData();
        data.append(file.field, file.value);
        body = data;
      }

      let response: Response;
      try {
        response = await doFetch(url.toString(), {
          method,
          headers,
          body,
          credentials: "include",
        });
      } catch {
        // Offline, DNS, CORS, aborted — nothing answered at all.
        throw new AuthTransportError("network");
      }

      // Body first, parse second — `response.json()` collapses two
      // different failures into one rejection. A connection that drops
      // after the headers (flaky mobile, a proxy killing an in-flight
      // response) fails the STREAM, and telling that user "the server
      // sent something we couldn't read" sends them hunting a server
      // bug instead of their signal. Reading the text separates them:
      // only the stream read can fail for network reasons, and only
      // `JSON.parse` can fail for syntax ones.
      let raw: string;
      try {
        raw = await response.text();
      } catch {
        throw new AuthTransportError("network", response.status);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // An nginx/Front Door HTML error page, a 204, an empty body.
        // Swallowing this used to leave `{ status: 200, body: null }`,
        // which reads downstream as a business SUCCESS with no token —
        // i.e. the dialog closing on a signed-out user.
        throw new AuthTransportError("invalid_response", response.status);
      }
      if (!isJsonObject(parsed)) {
        throw new AuthTransportError("invalid_response", response.status);
      }
      return { status: response.status, body: parsed };
    },
  };
}

/** The envelope is an object; `null`, arrays and scalars are not it. */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function currentOrigin(): string {
  return typeof window === "undefined" ? "http://localhost" : window.location.origin;
}
