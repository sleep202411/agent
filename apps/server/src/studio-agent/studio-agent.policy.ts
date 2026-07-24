import { Injectable } from '@nestjs/common';
import type {
  StudioAgentCapabilityManifest,
  StudioAgentPermissionDecision,
  StudioAgentPermissionPolicy,
  StudioAgentPermissionRule,
} from '@repo/shared/studio-agent';

export interface StudioAgentPolicyEvaluation {
  decision: StudioAgentPermissionDecision;
  source: 'platform' | 'rule' | 'mode';
  ruleId: string | null;
  reason: string;
}

export interface StudioAgentPolicyContext {
  scenarioId: string;
  resourceType: string | null;
  grantedScopes: ReadonlySet<string>;
}

/**
 * Pure policy evaluator. Authentication and domain authorization happen before
 * this layer; it decides whether an already-authorized capability may execute
 * automatically, needs a user approval, or is denied by the selected policy.
 */
@Injectable()
export class StudioAgentPolicyEngine {
  evaluate(
    policy: StudioAgentPermissionPolicy,
    capability: StudioAgentCapabilityManifest,
    context: StudioAgentPolicyContext,
  ): StudioAgentPolicyEvaluation {
    const missingScope = capability.requiredScopes.find(
      (scope) => !context.grantedScopes.has(scope),
    );
    if (missingScope) {
      return {
        decision: 'deny',
        source: 'platform',
        ruleId: null,
        reason: `Capability requires unavailable scope ${missingScope}.`,
      };
    }

    const rule = [...policy.rules]
      .sort(
        (left, right) =>
          right.priority - left.priority ||
          left.ruleId.localeCompare(right.ruleId),
      )
      .find((candidate) => matchesRule(candidate, capability, context));
    if (rule) {
      return {
        decision: rule.decision,
        source: 'rule',
        ruleId: rule.ruleId,
        reason: `Matched permission rule ${rule.ruleId}.`,
      };
    }

    return {
      ...modeDecision(policy.mode, capability),
      source: 'mode',
      ruleId: null,
    };
  }
}

function matchesRule(
  rule: StudioAgentPermissionRule,
  capability: StudioAgentCapabilityManifest,
  context: StudioAgentPolicyContext,
): boolean {
  const { selector } = rule;
  return (
    (selector.scenarioId === null ||
      selector.scenarioId === context.scenarioId) &&
    (selector.capabilityId === null ||
      selector.capabilityId === capability.capabilityId) &&
    (selector.capabilityVersion === null ||
      selector.capabilityVersion === capability.version) &&
    (selector.resourceType === null ||
      selector.resourceType === context.resourceType) &&
    (selector.effect === null || selector.effect === capability.effect) &&
    (selector.risk === null || selector.risk === capability.risk)
  );
}

function modeDecision(
  mode: StudioAgentPermissionPolicy['mode'],
  capability: StudioAgentCapabilityManifest,
): Pick<StudioAgentPolicyEvaluation, 'decision' | 'reason'> {
  if (capability.effect === 'read' && capability.risk === 'low') {
    return {
      decision: 'allow',
      reason: 'Low-risk reads execute without interrupting the creator.',
    };
  }

  switch (mode) {
    case 'ask':
      return {
        decision: 'ask',
        reason: 'The selected policy asks before every effectful action.',
      };
    case 'smart':
      return smartDecision(capability);
    case 'full':
      return {
        decision: 'allow',
        reason: 'The selected policy allows authorized actions automatically.',
      };
    case 'custom':
      return {
        decision: 'ask',
        reason:
          'No custom rule matched, so the safe explicit decision applies.',
      };
  }
}

function smartDecision(
  capability: StudioAgentCapabilityManifest,
): Pick<StudioAgentPolicyEvaluation, 'decision' | 'reason'> {
  // Auto-approve runs every authorized action automatically EXCEPT deletions,
  // which always pause for an explicit confirmation. (Full access is the mode
  // that also auto-approves deletions.)
  return capability.effect === 'delete'
    ? {
        decision: 'ask',
        reason:
          'Deletions always require explicit confirmation under auto-approve.',
      }
    : {
        decision: 'allow',
        reason: 'Auto-approve runs every authorized action except deletions.',
      };
}
