/**
 * Persona registry for the StoryOS supervisor.
 *
 * The supervisor (storyos agent) routes questions to sub-personas via
 * `ask_*` tool calls. This registry maps tool names to the display
 * metadata used by chat-bubble attribution UI, so users see which
 * crew role produced a given answer.
 *
 * Kept frontend-only — the backend owns the logical routing and doesn't
 * need this mapping. When adding a new persona here, make sure the
 * corresponding `ask_<name>` tool exists in
 * `apps/agent/src/mastra/tools/personas/ask-tools.ts`.
 */
export type AssistantPersonaKey =
  | "scriptwriter"
  | "characterDesigner"
  | "sceneDesigner"
  | "artDirector"
  | "storyboardDesigner"
  | "episodePlanner";

export interface AssistantPersonaMeta {
  key: AssistantPersonaKey;
  /** i18n key under the `ai.personas` namespace. */
  nameKey: string;
  /** Short emoji glyph for compact indicators. Replace with an icon set later. */
  icon: string;
  /** Accent tone used for bubbles / badges. */
  tone: "violet" | "amber" | "teal" | "rose" | "sky" | "lime";
}

export const ASSISTANT_PERSONAS: Record<AssistantPersonaKey, AssistantPersonaMeta> = {
  scriptwriter: { key: "scriptwriter", nameKey: "scriptwriter", icon: "✍️", tone: "violet" },
  characterDesigner: {
    key: "characterDesigner",
    nameKey: "characterDesigner",
    icon: "🎭",
    tone: "amber",
  },
  sceneDesigner: { key: "sceneDesigner", nameKey: "sceneDesigner", icon: "🏞️", tone: "teal" },
  artDirector: { key: "artDirector", nameKey: "artDirector", icon: "🎨", tone: "rose" },
  storyboardDesigner: {
    key: "storyboardDesigner",
    nameKey: "storyboardDesigner",
    icon: "🎬",
    tone: "sky",
  },
  episodePlanner: { key: "episodePlanner", nameKey: "episodePlanner", icon: "📖", tone: "lime" },
};

const TOOL_TO_PERSONA: Record<string, AssistantPersonaKey> = {
  ask_scriptwriter: "scriptwriter",
  ask_character_designer: "characterDesigner",
  ask_scene_designer: "sceneDesigner",
  ask_art_director: "artDirector",
  ask_storyboard_designer: "storyboardDesigner",
  ask_episode_planner: "episodePlanner",
};

export function getPersonaFromToolName(toolName: string): AssistantPersonaMeta | null {
  const key = TOOL_TO_PERSONA[toolName];
  return key ? ASSISTANT_PERSONAS[key] : null;
}

export function isAskPersonaTool(toolName: string): boolean {
  return toolName in TOOL_TO_PERSONA;
}

/**
 * Tailwind accent classes per tone. Kept in a single spot so the badge,
 * icon chip, and border stay in sync visually. Intentionally uses static
 * class strings (no dynamic `bg-${tone}-…`) so Tailwind's JIT can pick
 * them up.
 */
export const PERSONA_TONE_CLASSES: Record<AssistantPersonaMeta["tone"], string> = {
  violet: "bg-violet-500/10 text-violet-300 border-violet-400/30",
  amber: "bg-amber-500/10 text-amber-300 border-amber-400/30",
  teal: "bg-teal-500/10 text-teal-300 border-teal-400/30",
  rose: "bg-rose-500/10 text-rose-300 border-rose-400/30",
  sky: "bg-sky-500/10 text-sky-300 border-sky-400/30",
  lime: "bg-lime-500/10 text-lime-300 border-lime-400/30",
};
