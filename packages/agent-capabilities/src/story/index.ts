import type { AgentProjectKindDefinition } from "../types.js";
import { STORY_WORKBENCH_MODE } from "./modes/story.js";

export const STORY_MODE_DEFINITIONS = [STORY_WORKBENCH_MODE] as const;
export type StoryAgentMode = (typeof STORY_MODE_DEFINITIONS)[number]["mode"];

export const STORY_PROJECT_KIND = {
  projectKind: "story",
  modes: STORY_MODE_DEFINITIONS,
} as const satisfies AgentProjectKindDefinition<"story", StoryAgentMode>;

export { STORY_WORKBENCH_MODE };
