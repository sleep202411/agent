/**
 * Liveness + readiness endpoints for load balancers / K8s.
 *
 * `/healthz` — process is alive enough to answer HTTP. If this stops
 *             returning 200, restart the pod.
 *
 * `/ready`   — the process is alive AND has every dependency it needs
 *             to serve real traffic (provider creds present, Web PubSub
 *             configured, future: Redis/PG/OSS reachable). LB should
 *             stop routing to a pod whose `/ready` returns 503 but
 *             keep the pod itself running (it may recover).
 */
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type Redis from 'ioredis';
import { Public } from '../../auth';
import { PrismaService } from '../db/db.module';
import { REDIS } from '../redis/redis.module';
import { OutputStorageService } from '../storage/storage.types';

interface ReadinessProbe {
  name: string;
  ok: boolean;
  detail?: string;
}

@Controller()
export class HealthController {
  constructor(
    private readonly storage: OutputStorageService,
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Public()
  @Get('healthz')
  @HttpCode(HttpStatus.OK)
  liveness() {
    return { status: 'ok' };
  }

  @Public()
  @Get('ready')
  async readiness(@Res({ passthrough: true }) res: Response) {
    const [storageOk, dbOk, redisOk] = await Promise.all([
      this.storage.isHealthy(),
      this.probeDb(),
      this.probeRedis(),
    ]);
    // Realtime readiness validates the self-hosted WS plane — the only transport
    // now that Web PubSub is decommissioned (P5). When enabled it needs its
    // token-signing secret; when disabled (local dev) realtime simply isn't
    // gated.
    //
    // Microsoft Foundry / AZURE_OPENAI_* is intentionally NOT a readiness
    // gate: generation no longer registers that provider. Requiring its
    // secrets would 503 healthy cells after ops rotates them away.
    const selfHostedRealtime =
      (process.env.REALTIME_TRANSPORT ?? '').trim().toLowerCase() ===
      'self-hosted';
    const checks: ReadinessProbe[] = [
      {
        name: 'realtime',
        ok: selfHostedRealtime ? Boolean(process.env.REALTIME_WS_SECRET) : true,
        detail: selfHostedRealtime
          ? 'REALTIME_WS_SECRET required for the self-hosted realtime WS plane'
          : 'realtime disabled (REALTIME_TRANSPORT != self-hosted)',
      },
      {
        name: 'output_storage',
        ok: storageOk,
        detail: storageOk
          ? `${this.storage.providerId} output storage reachable`
          : `${this.storage.providerId} output storage unreachable`,
      },
      {
        name: 'postgres',
        ok: dbOk,
        detail: 'DATABASE_URL must point to a reachable Postgres',
      },
      {
        name: 'redis',
        ok: redisOk,
        detail: 'REDIS_URL must point to a reachable Redis',
      },
    ];

    const allOk = checks.every((c) => c.ok);
    if (!allOk) res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: allOk ? 'ready' : 'unready',
      checks,
    };
  }

  private async probeDb(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  private async probeRedis(): Promise<boolean> {
    try {
      const pong = await this.redis.ping();
      return pong === 'PONG';
    } catch {
      return false;
    }
  }
}
