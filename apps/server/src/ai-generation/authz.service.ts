import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  EntitlementService,
  isKnownEntitlementPlanKey,
  type EntitlementPlanKey,
  type EntitlementSnapshot,
} from '../entitlements';
import type { AiModelDefinition } from './types';

function parseDeniedPlans(): Set<EntitlementPlanKey> {
  // Backstop denylist for emergency lockouts. Product access is plan-based;
  // unknown configuration must fail closed instead of becoming a dead entry.
  const raw = process.env.AI_GENERATION_DENIED_PLANS ?? '';
  const plans = raw
    .split(',')
    .map((plan) => plan.trim().toLowerCase())
    .filter(Boolean);
  const denied = new Set<EntitlementPlanKey>();
  for (const plan of plans) {
    if (!isKnownEntitlementPlanKey(plan)) {
      throw new Error(`Unknown AI_GENERATION_DENIED_PLANS key: ${plan}`);
    }
    denied.add(plan);
  }
  return denied;
}

export type AiAccessReason =
  | 'membership_required'
  | 'membership_expired'
  | 'denied';

export interface AiAccessDecision {
  allowed: boolean;
  reason?: AiAccessReason;
  /** Minimum product plan this model needs (echoed back for UI tooltip). */
  requiredPlan?: EntitlementPlanKey | null;
}

@Injectable()
export class AiGenerationAuthzService {
  constructor(private readonly entitlements: EntitlementService) {}

  /**
   * Pure entitlement check used by the model-list endpoint so the UI can
   * render lock badges. Side-effect free.
   */
  decideModelAccess(
    entitlement: EntitlementSnapshot,
    model: AiModelDefinition,
  ): AiAccessDecision {
    const required = this.entitlements.requiredPlan(
      model.entitlement_policy?.requiredPlan ?? model.entitlement.requiredPlan,
    );
    if (parseDeniedPlans().has(entitlement.planKey)) {
      return { allowed: false, reason: 'denied', requiredPlan: required };
    }
    if (entitlement.status === 'expired') {
      return {
        allowed: false,
        reason: 'membership_expired',
        requiredPlan: required,
      };
    }
    if (required === null) {
      return { allowed: true, requiredPlan: null };
    }
    if (!this.entitlements.hasPlan(entitlement, required)) {
      return {
        allowed: false,
        reason: 'membership_required',
        requiredPlan: required,
      };
    }
    return { allowed: true, requiredPlan: required };
  }

  /** Throws if the user can't submit to this specific model. */
  assertCanUseModel(
    entitlement: EntitlementSnapshot,
    model: AiModelDefinition,
  ): void {
    const decision = this.decideModelAccess(entitlement, model);
    if (decision.allowed) return;
    throw new ForbiddenException({
      code:
        decision.reason === 'membership_expired'
          ? 'MEMBERSHIP_EXPIRED'
          : 'MEMBERSHIP_REQUIRED',
      msg:
        decision.reason === 'membership_expired'
          ? 'Your membership has expired. Please renew to continue generating.'
          : decision.requiredPlan
            ? `This model is available to ${decision.requiredPlan}+ members.`
            : 'AI generation is available to members only.',
      requiredPlan: decision.requiredPlan,
    });
  }

  /**
   * Walk the input and reject any field value that maps to a schema
   * option whose required plan exceeds the user's. UI also gates these, but
   * we never trust the client.
   */
  assertCanUseOptions(
    entitlement: EntitlementSnapshot,
    model: AiModelDefinition,
    normalizedInput: Record<string, unknown>,
  ): void {
    for (const [fieldName, field] of Object.entries(
      model.input_schema.properties,
    )) {
      const value = normalizedInput[fieldName];
      if (value === undefined || value === null) continue;
      const ui = (
        field as {
          'x-ui'?: {
            options?: Array<{
              value: unknown;
              requiredPlan?: string | null;
            }>;
          };
        }
      )['x-ui'];
      const option = ui?.options?.find((o) => o.value === value);
      if (!option?.requiredPlan) continue;
      const required = this.entitlements.requiredPlan(option.requiredPlan);
      if (!required || this.entitlements.hasPlan(entitlement, required)) {
        continue;
      }
      const optionValue =
        typeof value === 'string' || typeof value === 'number'
          ? value
          : JSON.stringify(value);
      throw new ForbiddenException({
        code: 'MEMBERSHIP_REQUIRED',
        msg: `Option "${optionValue}" on field "${fieldName}" requires ${required}+ membership.`,
        requiredPlan: required,
        field: fieldName,
      });
    }
  }
}
