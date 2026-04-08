import type { AssistantToolContext } from './types';
import type { AiService } from '../../ai/ai.service';
import type { ScriptAgentService } from '../../pipeline/script-agent.service';
import { createReadTools } from './read.tools';
import { createUiTools } from './ui.tools';
import { createProposalTools } from './proposal.tools';
import { createExecuteTools } from './execute.tools';
import { createScriptAgentTools } from './script-agent.tools';

export function createGroupedAssistantTools(
  context: AssistantToolContext,
  ai?: AiService,
  scriptAgent?: ScriptAgentService,
) {
  return {
    ...createReadTools(context),
    ...createUiTools(),
    ...createProposalTools(),
    ...createExecuteTools(context),
    ...(ai && scriptAgent
      ? createScriptAgentTools(context, ai, scriptAgent)
      : {}),
  };
}

export type { AssistantToolContext } from './types';
