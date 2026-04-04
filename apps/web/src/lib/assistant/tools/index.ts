import type { AssistantToolContext } from "./types";
import { createExecuteTools } from "./execute.tools";
import { createProposalTools } from "./proposal.tools";
import { createReadTools } from "./read.tools";
import { createUiTools } from "./ui.tools";

export function createGroupedAssistantTools(context: AssistantToolContext) {
  return {
    ...createReadTools(context),
    ...createUiTools(),
    ...createProposalTools(),
    ...createExecuteTools(context),
  };
}
