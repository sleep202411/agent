/**
 * Project-scoped agent state — server-authoritative, Redis-backed.
 *
 * Two key invariants:
 *
 * 1. **At most one running turn per project at a time.** The submit
 *    endpoint must `transition` from {idle, failed, cancelled} → running
 *    *before* doing any work. The Lua block makes that compare-and-set
 *    atomic across Nest instances / tabs / retries.
 *
 * 2. **Every state change publishes a WS event.** Subscribers
 *    (chat-events gateway → browser) get realtime updates without
 *    polling. The shape matches `AgentStateChangedEvent` from
 *    @repo/shared so the contract is documented in one place.
 */
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import type { AgentState, AgentStateKind } from '@repo/shared';

@Injectable()
export class AgentStateService implements OnModuleDestroy {
  private readonly logger = new Logger(AgentStateService.name);
  private readonly redis: Redis | null = null;

  constructor() {
    const url = process.env.REDIS_URL;
    if (!url) {
      this.logger.warn(
        'REDIS_URL unset — AgentStateService is a no-op (state always reads idle)',
      );
      return;
    }
    this.redis = new Redis(url, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) =>
        times > 10 ? null : Math.min(times * 500, 5000),
      lazyConnect: true,
    });
    this.redis.on('error', (err) =>
      this.logger.warn(`redis error: ${err.message}`),
    );
    void this.redis
      .connect()
      .catch((err) => this.logger.warn(`redis connect: ${err.message}`));
  }

  async onModuleDestroy() {
    await this.redis?.quit().catch(() => {});
  }

  private k(projectId: string): string {
    return `project:${projectId}:agent_state`;
  }

  private channel(projectId: string): string {
    // Reuse the existing chat-events channel so chat-events.gateway
    // receives state events alongside message_added / message_updated
    // without us having to subscribe to a second channel.
    return `chat:events:${projectId}`;
  }

  async get(projectId: string): Promise<AgentState> {
    if (!this.redis) return { kind: 'idle' };
    try {
      const raw = await this.redis.get(this.k(projectId));
      if (!raw) return { kind: 'idle' };
      return JSON.parse(raw) as AgentState;
    } catch (err) {
      this.logger.warn(
        `get(${projectId}) failed, defaulting to idle: ${err instanceof Error ? err.message : err}`,
      );
      return { kind: 'idle' };
    }
  }

  /**
   * Unconditional set + publish. Use this for the consume-completion
   * paths (running → idle / failed) where we already hold the gate
   * and just need to release. For first-acquire ("can I start a new
   * turn?") use `transition`, which is CAS-guarded.
   */
  async set(projectId: string, next: AgentState): Promise<AgentState> {
    const stamped: AgentState = {
      ...next,
      enteredAt: next.enteredAt ?? Date.now(),
    };
    if (!this.redis) return stamped;
    const value = JSON.stringify(stamped);
    try {
      await this.redis.set(this.k(projectId), value, 'EX', AGENT_STATE_TTL_SEC);
      await this.redis.publish(
        this.channel(projectId),
        JSON.stringify({
          type: 'agent_state_changed',
          data: { projectId, state: stamped },
        }),
      );
    } catch (err) {
      this.logger.warn(
        `set(${projectId}) failed: ${err instanceof Error ? err.message : err}`,
      );
    }
    return stamped;
  }

  /**
   * Refresh TTL on the existing state without changing it. Cheap heartbeat
   * called from consume() while it's actively reading chunks, so a live
   * supervisor turn keeps its lock fresh past the 15-min `AGENT_STATE_TTL_SEC`.
   *
   * No-op if the key doesn't exist (defensive — better to fail silent than
   * to revive a deleted state).
   */
  async touch(projectId: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.expire(this.k(projectId), AGENT_STATE_TTL_SEC);
    } catch (err) {
      this.logger.debug(
        `touch(${projectId}) expire failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /**
   * Compare-and-set: only update state if current `kind` is in
   * `allowedFrom`. Returns `{ ok: true, state }` on success or
   * `{ ok: false, current }` on conflict so the caller can serve a
   * meaningful 409 to the client.
   */
  async transition(
    projectId: string,
    allowedFrom: AgentStateKind[],
    next: AgentState,
  ): Promise<
    { ok: true; state: AgentState } | { ok: false; current: AgentState }
  > {
    const stamped: AgentState = {
      ...next,
      enteredAt: next.enteredAt ?? Date.now(),
    };
    if (!this.redis) {
      // Best-effort fallback when Redis is unconfigured: pretend the
      // gate succeeded (degraded behaviour, but better than blocking
      // every submit in dev environments without Redis).
      return { ok: true, state: stamped };
    }
    let raw: string;
    try {
      raw = (await this.redis.eval(
        TRANSITION_LUA,
        1,
        this.k(projectId),
        JSON.stringify(allowedFrom),
        JSON.stringify(stamped),
        String(AGENT_STATE_TTL_SEC),
      )) as string;
    } catch (err) {
      this.logger.warn(
        `transition(${projectId}) eval failed, defaulting to allow: ${err instanceof Error ? err.message : err}`,
      );
      return { ok: true, state: stamped };
    }
    const result = JSON.parse(raw) as
      | { ok: true; state: AgentState }
      | { ok: false; current: AgentState };
    if (result.ok) {
      try {
        await this.redis.publish(
          this.channel(projectId),
          JSON.stringify({
            type: 'agent_state_changed',
            data: { projectId, state: result.state },
          }),
        );
      } catch (err) {
        this.logger.warn(
          `publish on transition failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    return result;
  }
}

/**
 * Lock TTL — was 86_400 (1 day). Dropped to 900 (15 min) on 2026-05-22 after
 * a 30-student session left 20 projects stuck in `running` for hours because
 * the upstream Mastra fetch hung (no AbortController, no idle detection).
 *
 * Safe to shorten because:
 *  - longest legitimate supervisor turn measured ≈ 8 min (chain of 5-8 persona
 *    calls @ 60-120s each)
 *  - consume() now heartbeats this TTL every 30s while actively reading
 *    chunks (see `touch()` below + agent-stream.service.ts), so a live turn
 *    keeps its lock fresh past 15 min
 *  - mastra-proxy.controller.ts now wraps the fetch in a 10-min hard
 *    AbortController, so any truly-stuck fetch resolves into the catch
 *    branch within 10 min and releases the lock via `set(... 'failed')`
 *  - even if both safety nets above fail, the lock self-expires in 15 min
 *    instead of leaving the user blocked for a day
 */
const AGENT_STATE_TTL_SEC = 900;

/**
 * Atomic compare-and-set. Lives in Lua so two simultaneous submits
 * can't both observe `idle` and both overwrite to `running`.
 *
 * KEYS[1] = state key
 * ARGV[1] = JSON array of allowed kinds, e.g. ["idle","failed","cancelled"]
 * ARGV[2] = JSON of next state
 * ARGV[3] = TTL seconds (string)
 *
 * Returns JSON string: `{ ok: true, state }` on success or
 * `{ ok: false, current }` on conflict.
 */
const TRANSITION_LUA = `
local current_raw = redis.call('GET', KEYS[1])
local current = nil
local current_kind = 'idle'
if current_raw then
  current = cjson.decode(current_raw)
  current_kind = current.kind
end
local allowed = cjson.decode(ARGV[1])
for _, k in ipairs(allowed) do
  if k == current_kind then
    redis.call('SET', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[3]))
    return cjson.encode({ ok = true, state = cjson.decode(ARGV[2]) })
  end
end
local result_current = current
if not result_current then
  result_current = { kind = 'idle' }
end
return cjson.encode({ ok = false, current = result_current })
`;
