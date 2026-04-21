/**
 * Hardens a primary LanguageModelV3 with three composable resilience
 * layers, implemented as AI-SDK v3 middleware so the outer contract stays
 * a plain LanguageModelV3:
 *
 *   [outer] withFallback(secondary) ┐
 *                                   │ any fallback-worthy error → secondary model
 *   [mid]   withCircuitBreaker      ┐
 *                                   │ too many consecutive failures → short-circuit
 *   [inner] withRateLimit           ┐
 *                                   │ bounded concurrency + queue-wait timeout +
 *                                   │   max depth → backpressure
 *                                   ↓
 *   [raw]   primary model (Anthropic / Azure / whatever)
 *
 * Only the Anthropic-tier-limited path needs all three. DeepSeek / Qwen
 * personas run wide-open because their backends self-throttle (see the
 * 500-concurrent DeepSeek load test — zero errors).
 *
 * Design principles:
 *   - Transparent to callers. Wrapping a model preserves LanguageModelV3
 *     so Mastra, AI SDK, and everything downstream treat it normally.
 *   - No per-call config. Behavior comes from a small set of env knobs
 *     (see DEFAULTS) consumed once at startup.
 *   - Stateful bits (the limiter + the breaker) live at module scope and
 *     are reused for every request — otherwise every `createAnthropicModel`
 *     call would spawn a new limiter and concurrency caps would reset.
 *   - Observability: each layer logs its own transitions (queue depth,
 *     circuit open/close, fallback fire) at a level that's useful in
 *     prod without being noisy in dev.
 */
import { wrapLanguageModel } from "ai";
import type { LanguageModelV3, LanguageModelV3Middleware } from "@ai-sdk/provider";

// ─── Error classification ──────────────────────────────────────────────

export class ClaudeQueueTimeoutError extends Error {
  readonly name = "ClaudeQueueTimeoutError";
  constructor(message = "Claude queue wait exceeded timeout") {
    super(message);
  }
}

export class ClaudeOverloadError extends Error {
  readonly name = "ClaudeOverloadError";
  constructor(message = "Claude queue is full (max depth reached)") {
    super(message);
  }
}

export class CircuitOpenError extends Error {
  readonly name = "CircuitOpenError";
  constructor(message = "Claude circuit breaker is open") {
    super(message);
  }
}

export type ErrorClass =
  | "rate_limit" // 429
  | "overloaded" // 529 / 503
  | "network" // fetch failed, ECONNRESET, etc.
  | "timeout" // request-level timeout
  | "queue_timeout" // our queue-wait timeout
  | "circuit_open" // circuit breaker short-circuit
  | "auth" // 401, 402 (credit low) — NOT retryable, NOT counted
  | "bad_request" // 400 — programming error
  | "unknown";

/**
 * Classify an error from an LLM provider fetch. Signals are:
 *   - AI SDK's APICallError carries `statusCode`
 *   - plain fetch errors come through as network / TypeError
 *   - our own wrapper errors are tagged with `name`
 */
export function classifyError(err: unknown): ErrorClass {
  if (!err) return "unknown";
  if (err instanceof ClaudeQueueTimeoutError) return "queue_timeout";
  if (err instanceof ClaudeOverloadError) return "queue_timeout";
  if (err instanceof CircuitOpenError) return "circuit_open";

  const asAny = err as {
    name?: string;
    statusCode?: number;
    status?: number;
    code?: string | number;
    cause?: unknown;
  };
  const status = asAny.statusCode ?? asAny.status;
  if (typeof status === "number") {
    if (status === 429) return "rate_limit";
    if (status === 529 || status === 503 || status === 504) return "overloaded";
    if (status === 401) return "auth";
    if (status === 402) return "auth";
    if (status === 400) return "bad_request";
    if (status >= 500) return "overloaded";
  }

  const code = typeof asAny.code === "string" ? asAny.code : "";
  if (
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    code === "UND_ERR_SOCKET"
  ) {
    return "network";
  }

  const msg = String((err as { message?: string }).message ?? "").toLowerCase();
  if (msg.includes("aborted") || msg.includes("timeout")) return "timeout";
  if (msg.includes("fetch failed") || msg.includes("network")) return "network";

  return "unknown";
}

/** Errors that should trigger the fallback model. */
export function shouldFallback(cls: ErrorClass): boolean {
  switch (cls) {
    case "rate_limit":
    case "overloaded":
    case "network":
    case "timeout":
    case "queue_timeout":
    case "circuit_open":
      return true;
    default:
      return false;
  }
}

/**
 * Errors that count as circuit-breaker failures. We exclude `circuit_open`
 * itself (that's what the breaker IS) and `auth` / `bad_request` (user- /
 * config-level problems, not transient provider health issues).
 */
export function shouldCountAsCircuitFailure(cls: ErrorClass): boolean {
  switch (cls) {
    case "rate_limit":
    case "overloaded":
    case "network":
    case "timeout":
    case "queue_timeout":
      return true;
    default:
      return false;
  }
}

// ─── Layer 4: Rate limiter ──────────────────────────────────────────────

/**
 * Semaphore with two safety valves:
 *   - waitTimeoutMs: reject queued acquire() after N ms so caller can
 *     fallback instead of blocking the user indefinitely
 *   - maxDepth: reject new acquires if the pending queue is already huge
 *     so a sustained overload doesn't let the queue grow unboundedly
 */
export class RateLimiter {
  private active = 0;
  private readonly waiters: Array<{
    resolve: () => void;
    reject: (e: Error) => void;
    timer: NodeJS.Timeout | null;
  }> = [];

  constructor(
    private readonly concurrency: number,
    private readonly waitTimeoutMs: number,
    private readonly maxDepth: number
  ) {}

  async acquire(): Promise<void> {
    if (this.active < this.concurrency) {
      this.active += 1;
      return;
    }
    if (this.waiters.length >= this.maxDepth) {
      throw new ClaudeOverloadError(
        `Claude queue depth ${this.waiters.length} >= max ${this.maxDepth}`
      );
    }
    return new Promise<void>((resolve, reject) => {
      const entry = { resolve, reject, timer: null as NodeJS.Timeout | null };
      entry.timer = setTimeout(() => {
        const idx = this.waiters.indexOf(entry);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(
          new ClaudeQueueTimeoutError(
            `Claude queue wait ${this.waitTimeoutMs}ms expired (active=${this.active}, pending=${this.waiters.length})`
          )
        );
      }, this.waitTimeoutMs);
      this.waiters.push(entry);
    });
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      if (next.timer) clearTimeout(next.timer);
      // active stays unchanged — slot transfers directly to next waiter
      next.resolve();
      return;
    }
    this.active = Math.max(0, this.active - 1);
  }

  stats(): { active: number; pending: number; concurrency: number } {
    return {
      active: this.active,
      pending: this.waiters.length,
      concurrency: this.concurrency,
    };
  }
}

function rateLimitMiddleware(limiter: RateLimiter, log: Logger): LanguageModelV3Middleware {
  const runWithLimiter = async <T>(fn: () => PromiseLike<T>): Promise<T> => {
    const pre = limiter.stats();
    if (pre.active >= pre.concurrency) {
      log.info(
        `claude: queue wait (active=${pre.active}/${pre.concurrency}, pending=${pre.pending})`
      );
    }
    await limiter.acquire();
    try {
      return await fn();
    } finally {
      limiter.release();
    }
  };

  return {
    specificationVersion: "v3",
    wrapGenerate: async ({ doGenerate }) => runWithLimiter(doGenerate),
    wrapStream: async ({ doStream }) => runWithLimiter(doStream),
  };
}

// ─── Layer 3: Circuit breaker ───────────────────────────────────────────

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private consecutiveFailures = 0;
  private openedAt = 0;
  private readonly listeners: Array<(state: CircuitState) => void> = [];

  constructor(
    private readonly threshold: number,
    private readonly cooldownMs: number
  ) {}

  onStateChange(fn: (state: CircuitState) => void): void {
    this.listeners.push(fn);
  }

  /** Throws CircuitOpenError when the breaker is currently OPEN. */
  checkBeforeCall(): void {
    if (this.state === "OPEN") {
      if (Date.now() - this.openedAt >= this.cooldownMs) {
        this.setState("HALF_OPEN");
      } else {
        throw new CircuitOpenError();
      }
    }
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    if (this.state === "HALF_OPEN") this.setState("CLOSED");
  }

  recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.state === "HALF_OPEN") {
      this.openedAt = Date.now();
      this.setState("OPEN");
      return;
    }
    if (this.state === "CLOSED" && this.consecutiveFailures >= this.threshold) {
      this.openedAt = Date.now();
      this.setState("OPEN");
    }
  }

  currentState(): CircuitState {
    return this.state;
  }

  private setState(next: CircuitState): void {
    if (next === this.state) return;
    this.state = next;
    for (const fn of this.listeners) fn(next);
  }
}

function circuitBreakerMiddleware(breaker: CircuitBreaker, log: Logger): LanguageModelV3Middleware {
  breaker.onStateChange((state) => {
    log.warn(`claude: circuit breaker → ${state}`);
  });
  const runWithBreaker = async <T>(fn: () => PromiseLike<T>): Promise<T> => {
    breaker.checkBeforeCall();
    try {
      const result = await fn();
      breaker.recordSuccess();
      return result;
    } catch (err) {
      const cls = classifyError(err);
      if (shouldCountAsCircuitFailure(cls)) breaker.recordFailure();
      throw err;
    }
  };
  return {
    specificationVersion: "v3",
    wrapGenerate: async ({ doGenerate }) => runWithBreaker(doGenerate),
    wrapStream: async ({ doStream }) => runWithBreaker(doStream),
  };
}

// ─── Layer 2: Provider fallback ─────────────────────────────────────────

/**
 * On fallback-worthy error from the primary, invoke the secondary model
 * instead. The response gets a `providerMetadata.storyos.usedFallback`
 * tag so downstream consumers (UI, metrics) can distinguish a fallback
 * turn from a normal Claude turn.
 *
 * For the stream path we can't annotate individual chunks cleanly here
 * without teeing the ReadableStream, so we just log + fall back silently.
 * UI badging for streamed fallbacks is a future add; logs still record it.
 */
function fallbackMiddleware(fallback: LanguageModelV3, log: Logger): LanguageModelV3Middleware {
  return {
    specificationVersion: "v3",
    wrapGenerate: async ({ doGenerate, params }) => {
      try {
        return await doGenerate();
      } catch (err) {
        const cls = classifyError(err);
        if (!shouldFallback(cls)) throw err;
        log.warn(
          `claude → ${fallback.provider}/${fallback.modelId} fallback (reason=${cls}): ${toMessage(err)}`
        );
        const result = await fallback.doGenerate(params);
        return {
          ...result,
          providerMetadata: {
            ...(result.providerMetadata ?? {}),
            storyos: { usedFallback: true, fallbackReason: cls },
          },
        };
      }
    },
    wrapStream: async ({ doStream, params }) => {
      try {
        return await doStream();
      } catch (err) {
        const cls = classifyError(err);
        if (!shouldFallback(cls)) throw err;
        log.warn(
          `claude → ${fallback.provider}/${fallback.modelId} fallback (stream, reason=${cls}): ${toMessage(err)}`
        );
        return await fallback.doStream(params);
      }
    },
  };
}

// ─── Composition ───────────────────────────────────────────────────────

export interface HardenConfig {
  /** Max simultaneous in-flight requests to the primary provider. */
  maxConcurrency?: number;
  /** How long a queued acquire() waits before giving up and throwing. */
  queueTimeoutMs?: number;
  /** Reject new calls outright once pending queue hits this depth. */
  queueMaxDepth?: number;
  /** Consecutive failures before the breaker trips to OPEN. */
  circuitFailureThreshold?: number;
  /** Cooldown before the breaker half-opens again. */
  circuitCooldownMs?: number;
}

const DEFAULTS: Required<HardenConfig> = {
  // Tier 2: 1000 RPM ≈ 17/s. With ~1-2s per call incl. prompt caching,
  // ~20 in-flight matches steady throughput with 20% headroom below the cap.
  maxConcurrency: Number(process.env.STORYOS_CLAUDE_MAX_CONCURRENCY ?? 20),
  // 8s is long enough that bursts drain naturally but short enough that
  // chat doesn't feel frozen before falling back.
  queueTimeoutMs: Number(process.env.STORYOS_CLAUDE_QUEUE_TIMEOUT_MS ?? 8_000),
  // Past ~100 queued we're in sustained overload; better to reject fast
  // and let fallback absorb than build a 10-minute backlog.
  queueMaxDepth: Number(process.env.STORYOS_CLAUDE_QUEUE_MAX_DEPTH ?? 100),
  circuitFailureThreshold: Number(process.env.STORYOS_CLAUDE_CIRCUIT_THRESHOLD ?? 5),
  circuitCooldownMs: Number(process.env.STORYOS_CLAUDE_CIRCUIT_COOLDOWN_MS ?? 60_000),
};

// Stateful layers shared across every call through this process.
let sharedLimiter: RateLimiter | null = null;
let sharedBreaker: CircuitBreaker | null = null;

function getSharedState(config: Required<HardenConfig>): {
  limiter: RateLimiter;
  breaker: CircuitBreaker;
} {
  if (!sharedLimiter) {
    sharedLimiter = new RateLimiter(
      config.maxConcurrency,
      config.queueTimeoutMs,
      config.queueMaxDepth
    );
  }
  if (!sharedBreaker) {
    sharedBreaker = new CircuitBreaker(config.circuitFailureThreshold, config.circuitCooldownMs);
  }
  return { limiter: sharedLimiter, breaker: sharedBreaker };
}

/**
 * Wrap `primary` with rate-limit → circuit breaker → fallback, composed
 * so the outermost layer catches everything and redirects to `fallback`
 * when the primary is unhealthy.
 */
export function hardenAnthropicModel(
  primary: LanguageModelV3,
  fallback: LanguageModelV3,
  config: HardenConfig = {}
): LanguageModelV3 {
  const merged: Required<HardenConfig> = { ...DEFAULTS, ...config };
  const { limiter, breaker } = getSharedState(merged);
  const log = makeLogger();

  log.info(
    `claude hardening: concurrency=${merged.maxConcurrency} ` +
      `queueTimeout=${merged.queueTimeoutMs}ms maxDepth=${merged.queueMaxDepth} ` +
      `circuitThreshold=${merged.circuitFailureThreshold} ` +
      `cooldown=${merged.circuitCooldownMs}ms fallback=${fallback.provider}/${fallback.modelId}`
  );

  return wrapLanguageModel({
    model: primary,
    // First entry = OUTERMOST (see ai/dist/index.js::wrapLanguageModel).
    middleware: [
      fallbackMiddleware(fallback, log),
      circuitBreakerMiddleware(breaker, log),
      rateLimitMiddleware(limiter, log),
    ],
  });
}

// ─── Minimal logger ─────────────────────────────────────────────────────
// Deliberately not using pino/winston here — agent code already pipes
// console.* into its structured logger, and taking a dep on a logger from
// a utility module creates an awkward import graph.

type Logger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
};

function makeLogger(): Logger {
  return {
    info: (msg) => console.log(`[hardening] ${msg}`),
    warn: (msg) => console.warn(`[hardening] ${msg}`),
  };
}

function toMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// ─── Testing surface ────────────────────────────────────────────────────
// Exposed only for unit-level tests; production callers go through
// `hardenAnthropicModel`. Resetting shared state is how tests avoid cross-
// test contamination.

export function _resetSharedStateForTests(): void {
  sharedLimiter = null;
  sharedBreaker = null;
}
