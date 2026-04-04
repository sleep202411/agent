import type { AssistantToolContext } from './types';
import { createReadTools } from './read.tools';
import { createUiTools } from './ui.tools';
import { createProposalTools } from './proposal.tools';
import { createExecuteTools } from './execute.tools';

export function createGroupedAssistantTools(context: AssistantToolContext) {
  return {
    ...createReadTools(context),
    ...createUiTools(),
    ...createProposalTools(),
    ...createExecuteTools(context),
  };
}

export type { AssistantToolContext } from './types';
