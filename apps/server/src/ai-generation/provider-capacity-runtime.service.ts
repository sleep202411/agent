import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { createHash } from 'crypto';
import { REDIS } from '../infra/redis/redis.module';
import type { AiJob, AiJobError, AiProviderCapacitySnapshot } from './types';

type CapacityGateReason =
  | 'provider_cooldown'
  | 'provider_concurrency'
  | 'provider_rate_limit'
  | 'provider_capacity_unavailable';

export type ProviderCapacityGate =
  | {
      ok: true;
      endpointKey: string | null;
      capacity: AiProviderCapacitySnapshot | null;
    }
  | {
      ok: false;
      reason: CapacityGateReason;
      retryAfterMs: number;
      endpointKey: string;
      message: string;
      capacity: AiProviderCapacitySnapshot;
    };

const KEY_PREFIX = 'ai:provider-capacity:v1';
const MIN_REQUEUE_MS = 1_000;
const DEFAULT_REQUEUE_MS = 5_000;
const DEFAULT_LEASE_SECONDS = 10 * 60;
const LEASE_TTL_MARGIN_MS = 60_000;
const FAILURE_WINDOW_SECONDS = 10 * 60;

const ACTIVE_LEASE_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local member = ARGV[4]
local expires_at = now + ttl

redis.call('ZREMRANGEBYSCORE', key, '-inf', now)

local existing = redis.call('ZSCORE', key, member)
if existing then
  redis.call('ZADD', key, expires_at, member)
  redis.call('PEXPIRE', key, ttl + ${LEASE_TTL_MARGIN_MS})
  return {1, 0, redis.call('ZCARD', key)}
end

local count = redis.call('ZCARD', key)
if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retry_after = ttl
  if oldest[2] then
    retry_after = tonumber(oldest[2]) - now
    if retry_after < ${MIN_REQUEUE_MS} then
      retry_after = ${MIN_REQUEUE_MS}
    end
  end
  return {0, retry_after, count}
end

redis.call('ZADD', key, expires_at, member)
redis.call('PEXPIRE', key, ttl + ${LEASE_TTL_MARGIN_MS})
return {1, 0, count + 1}
`;

const RPM_SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])

local count = redis.call('INCR', key)
if count == 1 then
  redis.call('PEXPIRE', key, ttl)
end

if count > limit then
  local retry_after = redis.call('PTTL', key)
  if retry_after < ${MIN_REQUEUE_MS} then
    retry_after = ${MIN_REQUEUE_MS}
  end
  return {0, retry_after, count}
end

return {1, 0, count}
`;

@Injectable()
export class ProviderCapacityRuntimeService {
  private readonly logger = new Logger(ProviderCapacityRuntimeService.name);

  constructor(@Optional() @Inject(REDIS) private readonly redis?: Redis) {}

  async reserveForProviderSubmit(job: AiJob): Promise<ProviderCapacityGate> {
    const descriptor = this.descriptor(job);
    if (!descriptor) {
      return {
        ok: true,
        endpointKey: null,
        capacity: null,
      };
    }
    if (!this.redis) {
      return this.redisUnavailable(descriptor);
    }

    try {
      const cooldownTtl = await this.redis.pttl(this.cooldownKey(descriptor));
      if (cooldownTtl > 0) {
        return {
          ok: false,
          reason: 'provider_cooldown',
          retryAfterMs: clampRetryAfter(cooldownTtl),
          endpointKey: descriptor.endpointKey,
          message: 'Provider endpoint is cooling down after recent failures.',
          capacity: descriptor.capacity,
        };
      }

      const concurrency = await this.tryAcquireConcurrencyLease(
        descriptor,
        job,
      );
      if (!concurrency.ok) return concurrency;

      const rpm = await this.tryConsumeRequestMinute(descriptor);
      if (!rpm.ok) {
        await this.release(job);
        return rpm;
      }

      return {
        ok: true,
        endpointKey: descriptor.endpointKey,
        capacity: descriptor.capacity,
      };
    } catch (err) {
      this.logger.warn(
        `provider capacity reserve failed for job ${job.id}: ${errorMessage(err)}`,
      );
      return this.redisUnavailable(descriptor);
    }
  }

  async heartbeat(job: AiJob): Promise<void> {
    const descriptor = this.descriptor(job);
    if (!descriptor?.capacity.maxConcurrentRequests || !this.redis) return;
    try {
      await this.redis.zadd(
        this.activeKey(descriptor),
        String(Date.now() + this.leaseTtlMs(job)),
        job.id,
      );
      await this.redis.pexpire(
        this.activeKey(descriptor),
        this.leaseTtlMs(job) + LEASE_TTL_MARGIN_MS,
      );
    } catch (err) {
      this.logger.warn(
        `provider capacity heartbeat failed for job ${job.id}: ${errorMessage(err)}`,
      );
    }
  }

  async release(job: AiJob): Promise<void> {
    const descriptor = this.descriptor(job);
    if (!descriptor?.capacity.maxConcurrentRequests || !this.redis) return;
    try {
      await this.redis.zrem(this.activeKey(descriptor), job.id);
    } catch (err) {
      this.logger.warn(
        `provider capacity release failed for job ${job.id}: ${errorMessage(err)}`,
      );
    }
  }

  async recordSuccess(job: AiJob): Promise<void> {
    const descriptor = this.descriptor(job);
    if (!descriptor || !this.redis) return;
    try {
      await this.redis.del(
        this.failureKey(descriptor),
        this.cooldownKey(descriptor),
      );
    } catch (err) {
      this.logger.warn(
        `provider capacity success reset failed for job ${job.id}: ${errorMessage(err)}`,
      );
    }
  }

  async recordFailure(job: AiJob, error: AiJobError): Promise<void> {
    if (!isProviderCapacityFailure(error.code)) return;
    const descriptor = this.descriptor(job);
    if (!descriptor?.capacity.failureThreshold || !this.redis) return;

    try {
      const failureKey = this.failureKey(descriptor);
      const count = await this.redis.incr(failureKey);
      if (count === 1) {
        await this.redis.expire(
          failureKey,
          Math.max(
            FAILURE_WINDOW_SECONDS,
            descriptor.capacity.cooldownSeconds ?? 0,
          ),
        );
      }
      const cooldownSeconds = descriptor.capacity.cooldownSeconds ?? 0;
      if (
        cooldownSeconds > 0 &&
        count >= descriptor.capacity.failureThreshold
      ) {
        await this.redis.set(
          this.cooldownKey(descriptor),
          JSON.stringify({
            jobId: job.id,
            code: error.code,
            message: error.message,
            openedAt: new Date().toISOString(),
            failures: count,
          }),
          'EX',
          cooldownSeconds,
        );
        await this.redis.del(failureKey);
      }
    } catch (err) {
      this.logger.warn(
        `provider capacity failure record failed for job ${job.id}: ${errorMessage(err)}`,
      );
    }
  }

  private async tryAcquireConcurrencyLease(
    descriptor: CapacityDescriptor,
    job: AiJob,
  ): Promise<ProviderCapacityGate> {
    const limit = descriptor.capacity.maxConcurrentRequests;
    if (!limit) {
      return {
        ok: true,
        endpointKey: descriptor.endpointKey,
        capacity: descriptor.capacity,
      };
    }

    const result = (await this.redis!.eval(
      ACTIVE_LEASE_SCRIPT,
      1,
      this.activeKey(descriptor),
      Date.now(),
      limit,
      this.leaseTtlMs(job),
      job.id,
    )) as unknown[];
    const allowed = Number(result[0]) === 1;
    if (allowed) {
      return {
        ok: true,
        endpointKey: descriptor.endpointKey,
        capacity: descriptor.capacity,
      };
    }
    return {
      ok: false,
      reason: 'provider_concurrency',
      retryAfterMs: clampRetryAfter(Number(result[1])),
      endpointKey: descriptor.endpointKey,
      message: 'Provider endpoint concurrency limit is full.',
      capacity: descriptor.capacity,
    };
  }

  private async tryConsumeRequestMinute(
    descriptor: CapacityDescriptor,
  ): Promise<ProviderCapacityGate> {
    const limit = descriptor.capacity.maxRequestsPerMinute;
    if (!limit) {
      return {
        ok: true,
        endpointKey: descriptor.endpointKey,
        capacity: descriptor.capacity,
      };
    }

    const now = Date.now();
    const bucket = Math.floor(now / 60_000);
    const ttl = 60_000 - (now % 60_000) + 1_000;
    const result = (await this.redis!.eval(
      RPM_SCRIPT,
      1,
      this.rpmKey(descriptor, bucket),
      limit,
      ttl,
    )) as unknown[];
    const allowed = Number(result[0]) === 1;
    if (allowed) {
      return {
        ok: true,
        endpointKey: descriptor.endpointKey,
        capacity: descriptor.capacity,
      };
    }
    return {
      ok: false,
      reason: 'provider_rate_limit',
      retryAfterMs: clampRetryAfter(Number(result[1])),
      endpointKey: descriptor.endpointKey,
      message: 'Provider endpoint request rate limit is full.',
      capacity: descriptor.capacity,
    };
  }

  private redisUnavailable(
    descriptor: CapacityDescriptor,
  ): ProviderCapacityGate {
    return {
      ok: false,
      reason: 'provider_capacity_unavailable',
      retryAfterMs: DEFAULT_REQUEUE_MS,
      endpointKey: descriptor.endpointKey,
      message: 'Provider capacity controller is unavailable.',
      capacity: descriptor.capacity,
    };
  }

  private descriptor(job: AiJob): CapacityDescriptor | null {
    const capacity = job.routingSnapshot?.policy.providerCapacity;
    if (!capacity || !hasRuntimeCapacity(capacity)) return null;

    const provider =
      job.routingSnapshot?.selectedProvider ?? job.provider ?? 'unknown';
    const endpointId =
      job.routingSnapshot?.selectedProviderEndpointId ??
      job.routingSnapshot?.selectedDeployment ??
      job.deployment ??
      'unknown';
    // Tiered capacity (e.g. the Seedance 4k lane) buckets separately from
    // the endpoint-wide lane so neither throttles the other.
    const endpointKey = capacity.tierKey
      ? `${provider}:${endpointId}:${capacity.tierKey}`
      : `${provider}:${endpointId}`;
    const hash = createHash('sha256')
      .update(endpointKey)
      .digest('hex')
      .slice(0, 24);
    return {
      endpointKey,
      hash,
      capacity,
    };
  }

  private activeKey(descriptor: CapacityDescriptor): string {
    return `${KEY_PREFIX}:${descriptor.hash}:active`;
  }

  private rpmKey(descriptor: CapacityDescriptor, bucket: number): string {
    return `${KEY_PREFIX}:${descriptor.hash}:rpm:${bucket}`;
  }

  private failureKey(descriptor: CapacityDescriptor): string {
    return `${KEY_PREFIX}:${descriptor.hash}:failures`;
  }

  private cooldownKey(descriptor: CapacityDescriptor): string {
    return `${KEY_PREFIX}:${descriptor.hash}:cooldown`;
  }

  private leaseTtlMs(job: AiJob): number {
    const runtimeSeconds =
      job.routingSnapshot?.policy.runtime.maxProviderRuntimeSeconds ??
      DEFAULT_LEASE_SECONDS;
    return Math.max(MIN_REQUEUE_MS, Math.trunc(runtimeSeconds * 1000));
  }
}

interface CapacityDescriptor {
  endpointKey: string;
  hash: string;
  capacity: AiProviderCapacitySnapshot;
}

function hasRuntimeCapacity(capacity: AiProviderCapacitySnapshot): boolean {
  return Boolean(
    capacity.maxConcurrentRequests ||
    capacity.maxRequestsPerMinute ||
    (capacity.failureThreshold && capacity.cooldownSeconds),
  );
}

function isProviderCapacityFailure(code: AiJobError['code']): boolean {
  return (
    code === 'PROVIDER_429' ||
    code === 'PROVIDER_5XX' ||
    code === 'PROVIDER_TIMEOUT'
  );
}

function clampRetryAfter(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_REQUEUE_MS;
  return Math.max(MIN_REQUEUE_MS, Math.min(Math.trunc(value), 15 * 60_000));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
