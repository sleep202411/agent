/**
 * GET /aurora/quota — snapshot for the current user.
 *
 * The frontend's <QuotaProvider/> calls this once on auth-resolve and
 * then subscribes to the (Phase 3) WS gateway for live deltas. Phase
 * 2 still does an HTTP-only flow; the response shape is stable.
 *
 * Public-shaped JSON intentionally uses string "Infinity" so JSON
 * round-trips cleanly. Frontend converts back via `parseLimit()`.
 */
import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../auth';
import type { AuthUser } from '../auth';
import { QuotaService } from './quota.service';
import { normalizeTier } from './tiers.config';
import type { QuotaPeek, QuotaSnapshot } from './quota.types';

type WireSnapshot = Omit<QuotaSnapshot, 'limit' | 'remaining'> & {
  limit: number | 'Infinity';
  remaining: number | 'Infinity';
};

interface WirePeek {
  tier: QuotaPeek['tier'];
  dimensions: Record<string, WireSnapshot>;
  chatPerMinute: { limit: number; remaining: number; resetAt: string };
}

function toWire(peek: QuotaPeek): WirePeek {
  const dims: Record<string, WireSnapshot> = {};
  for (const [k, v] of Object.entries(peek.dimensions)) {
    dims[k] = {
      ...v,
      limit: Number.isFinite(v.limit) ? v.limit : 'Infinity',
      remaining: Number.isFinite(v.remaining) ? v.remaining : 'Infinity',
    };
  }
  return {
    tier: peek.tier,
    dimensions: dims,
    chatPerMinute: peek.chatPerMinute,
  };
}

@Controller('quota')
export class QuotaController {
  constructor(private readonly svc: QuotaService) {}

  @Get()
  async getQuota(@CurrentUser() user: AuthUser) {
    const tier = normalizeTier(user.userLevel);
    const peek = await this.svc.peek(user.userId, tier);
    return { code: 200, data: toWire(peek) };
  }
}
