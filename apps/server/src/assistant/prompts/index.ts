import { readFileSync } from 'fs';
import { join } from 'path';

export const assistantAgentTypes = [
  'general',
  'script',
  'storyboard',
  'character',
  'scene',
  'ad',
] as const;

export type AssistantAgentType = (typeof assistantAgentTypes)[number];

const promptCache = new Map<AssistantAgentType, string>();

/**
 * Load agent-specific prompt from a markdown file.
 * Files are read once and cached for the lifetime of the process.
 * Returns empty string for agents without a prompt file (e.g. general).
 */
export function loadAgentPrompt(agentType: AssistantAgentType): string {
  if (promptCache.has(agentType)) {
    return promptCache.get(agentType)!;
  }

  const filePath = join(__dirname, `${agentType}.md`);
  let content = '';
  try {
    content = readFileSync(filePath, 'utf-8').trim();
  } catch {
    // No prompt file for this agent type (e.g. general) — use base prompt only
  }

  promptCache.set(agentType, content);
  return content;
}
