import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { MemorySaver } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";

import { buildLangChainTools, type ToolRuntimeContext } from "./build-langchain-tools.js";

const SYSTEM_PROMPT = `You are FizzDragon Agent OS — an execution agent for creators.

You MUST use tools to read project data and to write changes. Never claim you wrote
to the database unless a write tool succeeded.

When the user asks to extract characters from a script:
1. If they pasted full script text, call script_store first.
2. Call script_read_section for relevant sections (start at sectionIndex 0;
   attachmentId may be any uuid placeholder when using stored script).
3. Call characters_list to learn baseRevision.
4. Infer a structured cast list.
5. Call characters_upsert with that baseRevision (intent create or replace).
6. Summarize what was written with character ids.

Prefer small, correct writes over dumping the entire script into one response.
Do not invent project permissions. Tools enforce scope.`;

export function createAgentOsGraph(input: {
  model: BaseChatModel;
  runtime: ToolRuntimeContext;
  checkpointer?: MemorySaver;
}) {
  const tools = buildLangChainTools(input.runtime);
  return createReactAgent({
    llm: input.model,
    tools,
    checkpointSaver: input.checkpointer ?? new MemorySaver(),
    prompt: SYSTEM_PROMPT,
  });
}

export type AgentOsGraph = ReturnType<typeof createAgentOsGraph>;
