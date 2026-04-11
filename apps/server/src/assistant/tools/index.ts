import type { AssistantToolContext } from './types';
import type { AiService } from '../../ai/ai.service';
import type { ScriptAgentService } from '../../pipeline/script-agent.service';
import { createReadTools } from './read.tools';
import { createUiTools } from './ui.tools';
import { createProposalTools } from './proposal.tools';
import { createExecuteTools } from './execute.tools';
import { createScriptAgentTools } from './script-agent.tools';

export type UserTier = 'free' | 'pro' | 'enterprise';

/**
 * Tools that require a paid plan to execute.
 * Currently disabled — all tools are available to all users.
 * Re-enable when VIP gating is needed.
 */
const PRO_ONLY_TOOLS = new Set<string>([
  // 'analyze_text',
  // 'map_episodes',
  // 'create_episodes_and_assets',
  // 'generate_scripts',
  // 'generate_storyboard',
]);

/**
 * Wrap a tool's execute function with a tier check.
 * If the user doesn't have the required tier, return an error
 * that tells the LLM to inform the user about upgrading.
 */
function wrapWithTierCheck(
  tools: Record<string, unknown>,
  userTier: UserTier,
): Record<string, unknown> {
  if (userTier !== 'free') return tools;

  const wrapped = { ...tools };
  for (const [name, tool] of Object.entries(wrapped)) {
    if (!PRO_ONLY_TOOLS.has(name)) continue;
    const original = tool as { execute?: (...args: unknown[]) => unknown };
    if (!original?.execute) continue;

    (original as Record<string, unknown>).execute = async () => {
      return {
        success: false,
        error: 'UPGRADE_REQUIRED',
        message:
          'This feature requires a Pro subscription. ' +
          'Please inform the user that they need to upgrade their plan to use this feature. ' +
          'Provide a helpful response explaining what the feature does and how to upgrade.',
        originalTool: name,
      };
    };
  }

  return wrapped;
}

export function createGroupedAssistantTools(
  context: AssistantToolContext,
  ai?: AiService,
  scriptAgent?: ScriptAgentService,
  userTier: UserTier = 'pro',
) {
  const allTools = {
    ...createReadTools(context),
    ...createUiTools(),
    ...createProposalTools(),
    ...createExecuteTools(context),
    ...(ai && scriptAgent
      ? createScriptAgentTools(context, ai, scriptAgent)
      : {}),
  };

  return wrapWithTierCheck(allTools as Record<string, unknown>, userTier);
}

export type { AssistantToolContext } from './types';
