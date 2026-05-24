/**
 * mastraFetch — every server→agent HTTP call goes through here.
 *
 * Why this exists: Node's global `fetch` (undici-backed) keeps a per-origin
 * connection pool that aggressively reuses TCP connections. With a
 * Kubernetes ClusterIP Service in front of the agent Deployment, iptables
 * does DNAT per *connection*, not per request — so once a keep-alive
 * connection lands on agent pod A, every subsequent request on that
 * connection also routes to pod A. Under burst load (verified 2026-05-22
 * with 47 concurrent submits) this pins ~100% of traffic to a single
 * agent pod even though the Deployment has 4 replicas, choking the
 * effective concurrency cap to 1/4 of what's configured.
 *
 * The fix is to disable keep-alive on this hot path. Each request opens a
 * fresh TCP connection, iptables DNATs it independently, and traffic
 * spreads across the agent pods.
 *
 * Cost: the extra TCP+TLS-less handshake per request (Service ClusterIP is
 * plain HTTP inside the cluster, no TLS) — a few milliseconds. Cheap vs
 * the alternative (queue-timeout cliffs, hard-timeout aborts).
 *
 * Scope: ONLY use this for server→agent traffic. Outbound calls to the
 * public internet (Anthropic, Java, OpenAI) should keep the default fetch
 * since their LBs do request-level load-balancing properly.
 */
import { Agent, fetch as undiciFetch } from 'undici';

/**
 * No-keep-alive dispatcher. `keepAliveTimeout: 1` forces undici to drop
 * the socket immediately after the response, so the next request opens
 * a fresh connection.
 */
const noKeepAliveDispatcher = new Agent({
  keepAliveTimeout: 1,
  keepAliveMaxTimeout: 1,
  pipelining: 0,
  connections: null,
});

/**
 * Drop-in fetch replacement that routes through `noKeepAliveDispatcher`.
 * Cast through `unknown` so callers can keep treating the result as a
 * standard fetch `Response` — undici's Response is structurally
 * compatible (same body / headers / status / streaming surface).
 */
export function mastraFetch(
  url: string | URL,
  init?: Parameters<typeof undiciFetch>[1],
): Promise<Response> {
  return undiciFetch(url, {
    ...init,
    dispatcher: noKeepAliveDispatcher,
  }) as unknown as Promise<Response>;
}
