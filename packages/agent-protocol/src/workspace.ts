import { z } from "zod";

import { AgentOsIdSchema, AgentOsNonEmptyIdSchema } from "./ids.js";

export const AgentWorkspaceTypeSchema = z.enum([
  "project_canvas",
  "script_editor",
  "interactive_film",
  "storyboard",
  "video_timeline",
  "asset_library",
]);
export type AgentWorkspaceType = z.infer<typeof AgentWorkspaceTypeSchema>;

export const AgentWorkspaceRefSchema = z
  .object({
    type: AgentWorkspaceTypeSchema,
    entityId: AgentOsIdSchema.optional(),
    selectedEntityIds: z.array(AgentOsNonEmptyIdSchema).max(256).optional(),
    visibleEntityIds: z.array(AgentOsNonEmptyIdSchema).max(512).optional(),
  })
  .strict();
export type AgentWorkspaceRef = z.infer<typeof AgentWorkspaceRefSchema>;
