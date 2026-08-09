import type { AgentModeDefinition } from "../../types.js";

export const PLATFORM_BRIEF_MODE = {
  projectKind: "platform",
  mode: "brief",
  name: "Brief workbench",
  description: "Script + characters for the brief workbench.",
  instructions: `## Workbench: BRIEF

Focus on attachments and characters. You cannot write storyboard shots from this
workbench — direct the user to Storyboard mode for shot breakdown.

Write-intent gate: pure chat / poetic phrases need no tools. Only use tools when
the user asks to read a script, list, or extract/write characters.

When extracting characters: script_readSection / script_store → characters_list
→ characters_upsert.

Note: characters written here are project drafts for Agent OS. Product character
assets live in the StudioCharacter library — do not invent a separate "cast mode".`,
  toolIds: ["characters.list", "characters.upsert"],
} as const satisfies AgentModeDefinition<"brief">;
