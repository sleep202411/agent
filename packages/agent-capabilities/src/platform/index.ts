import { PLATFORM_BRIEF_MODE } from "./modes/brief.js";
import { PLATFORM_CANVAS_MODE } from "./modes/canvas.js";
import { PLATFORM_STORYBOARD_MODE } from "./modes/storyboard.js";
import type { AgentProjectKindDefinition } from "../types.js";

export const PLATFORM_MODE_DEFINITIONS = [
  PLATFORM_STORYBOARD_MODE,
  PLATFORM_CANVAS_MODE,
  PLATFORM_BRIEF_MODE,
] as const;

export type PlatformAgentMode = (typeof PLATFORM_MODE_DEFINITIONS)[number]["mode"];

export const PLATFORM_PROJECT_KIND = {
  projectKind: "platform",
  modes: PLATFORM_MODE_DEFINITIONS,
} as const satisfies AgentProjectKindDefinition<"platform", PlatformAgentMode>;

export { PLATFORM_BRIEF_MODE, PLATFORM_CANVAS_MODE, PLATFORM_STORYBOARD_MODE };
