import { readFileSync } from 'fs';
import { join } from 'path';

export const assistantAgentTypes = ['general', 'script'] as const;

export type AssistantAgentType = (typeof assistantAgentTypes)[number];

const promptCache = new Map<string, string>();

/**
 * Load a prompt from a markdown file.
 * Files are read once and cached for the lifetime of the process.
 * Returns empty string if file not found.
 */
function loadPromptFile(filename: string): string {
  if (promptCache.has(filename)) {
    return promptCache.get(filename)!;
  }

  const filePath = join(__dirname, filename);
  let content = '';
  try {
    content = readFileSync(filePath, 'utf-8').trim();
  } catch {
    // File not found — return empty
  }

  promptCache.set(filename, content);
  return content;
}

/**
 * Replace {{variable}} placeholders in a prompt template.
 */
function interpolate(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = vars[key];
    return val !== undefined ? String(val) : `{{${key}}}`;
  });
}

/**
 * Load agent-specific prompt (e.g. script.md, ad.md).
 */
export function loadAgentPrompt(agentType: AssistantAgentType): string {
  return loadPromptFile(`${agentType}.md`);
}

/**
 * Load and interpolate a pipeline prompt.
 */
export function loadPipelinePrompt(
  name: string,
  vars?: Record<string, string | number>,
): string {
  const template = loadPromptFile(`pipeline-${name}.md`);
  return vars ? interpolate(template, vars) : template;
}

/**
 * Load and interpolate the assistant system prompt.
 */
export function loadAssistantSystemPrompt(
  vars: Record<string, string | number>,
): string {
  const template = loadPromptFile('assistant-system.md');
  return interpolate(template, vars);
}
