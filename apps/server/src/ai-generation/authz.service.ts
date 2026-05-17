import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth';
import {
  AI_TIER_RANK,
  type FoundryModelDefinition,
  type AiUserTier,
} from './types';

function parseDeniedLevels(): Set<string> {
  // Backstop denylist — anyone in here is blocked from Foundry no
  // matter what model.minTier says. Default empty; per-model `minTier`
  // does the real gating. Useful for emergency lockouts.
  const raw = process.env.FOUNDRY_DENIED_LEVELS ?? '';
  return new Set(
    raw
      .split(',')
      .map((level) => level.trim().toUpperCase())
      .filter(Boolean),
  );
}

function isExpired(expireTime?: string | null): boolean {
  if (!expireTime) return false;
  const timestamp = Date.parse(expireTime);
  if (!Number.isFinite(timestamp)) return false;
  return timestamp <= Date.now();
}

function tierRank(level: string | null | undefined): number {
  const upper = (level ?? 'FREE').toUpperCase() as AiUserTier;
  return AI_TIER_RANK[upper] ?? 0;
}

export type AiAccessReason =
  | 'membership_required'
  | 'membership_expired'
  | 'denied';

export interface AiAccessDecision {
  allowed: boolean;
  reason?: AiAccessReason;
  /** Minimum tier this model needs (echoed back for UI tooltip). */
  requiredTier?: AiUserTier | null;
}

@Injectable()
export class AiGenerationAuthzService {
  /**
   * Pure tier check used by the model-list endpoint so the UI can
   * render lock badges. Side-effect free.
   */
  decideModelAccess(
    user: AuthUser,
    model: FoundryModelDefinition,
  ): AiAccessDecision {
    const required = model.membership.minTier ?? null;
    if (parseDeniedLevels().has((user.userLevel ?? '').toUpperCase())) {
      return { allowed: false, reason: 'denied', requiredTier: required };
    }
    if (isExpired(user.expireTime)) {
      return {
        allowed: false,
        reason: 'membership_expired',
        requiredTier: required,
      };
    }
    if (required === null) {
      return { allowed: true, requiredTier: null };
    }
    if (tierRank(user.userLevel) < AI_TIER_RANK[required]) {
      return {
        allowed: false,
        reason: 'membership_required',
        requiredTier: required,
      };
    }
    return { allowed: true, requiredTier: required };
  }

  /** Throws if the user can't submit to this specific model. */
  assertCanUseModel(user: AuthUser, model: FoundryModelDefinition): void {
    const decision = this.decideModelAccess(user, model);
    if (decision.allowed) return;
    throw new ForbiddenException({
      code:
        decision.reason === 'membership_expired'
          ? 'MEMBERSHIP_EXPIRED'
          : 'MEMBERSHIP_REQUIRED',
      msg:
        decision.reason === 'membership_expired'
          ? 'Your membership has expired. Please renew to continue generating.'
          : decision.requiredTier
            ? `This model is available to ${decision.requiredTier}+ members.`
            : 'Foundry generation is available to members only.',
      requiredTier: decision.requiredTier,
    });
  }

  /**
   * Walk the input and reject any field value that maps to a schema
   * option whose `tier` exceeds the user's. UI also gates these, but
   * we never trust the client.
   */
  assertCanUseOptions(
    user: AuthUser,
    model: FoundryModelDefinition,
    normalizedInput: Record<string, unknown>,
  ): void {
    const userRank = tierRank(user.userLevel);
    for (const [fieldName, field] of Object.entries(
      model.input_schema.properties,
    )) {
      const value = normalizedInput[fieldName];
      if (value === undefined || value === null) continue;
      const ui = (
        field as {
          'x-ui'?: {
            options?: Array<{ value: unknown; tier?: string | null }>;
          };
        }
      )['x-ui'];
      const option = ui?.options?.find((o) => o.value === value);
      if (!option?.tier) continue;
      const required = option.tier.toUpperCase() as AiUserTier;
      const requiredRank = AI_TIER_RANK[required];
      if (requiredRank == null) continue; // unknown tier name, skip
      if (userRank >= requiredRank) continue;
      throw new ForbiddenException({
        code: 'MEMBERSHIP_REQUIRED',
        msg: `Option "${String(value)}" on field "${fieldName}" requires ${required}+ membership.`,
        requiredTier: required,
        field: fieldName,
      });
    }
  }
}
