import { z } from "zod/v4";
import {
  DEFAULT_EXPERIENCE_APPEARANCE,
  ExperienceAppearanceSchema,
  type ExperienceAppearance,
} from "@repo/shared/experience-runtime";

export interface AppearanceCheckpoint {
  applied: ExperienceAppearance;
}
export interface Workspace extends AppearanceCheckpoint {
  baseProjectVersion?: number;
  prompt: string;
  undo: AppearanceCheckpoint[];
}
export const DEFAULT_APPEARANCE = DEFAULT_EXPERIENCE_APPEARANCE;
export const WORKSPACE_STORAGE_BUDGET = 2 * 1024 * 1024;
const checkpoint = z.object({ applied: ExperienceAppearanceSchema }).strict();
const storedSchema = z
  .object({
    version: z.literal(3),
    applied: ExperienceAppearanceSchema,
    baseProjectVersion: z.number().int().nonnegative().optional(),
    prompt: z.string().max(2000),
    undo: z.array(checkpoint).max(40),
  })
  .strict();

/** Evict oldest undo entries before the current CSS/SVG draft. */
export function encodeAppearanceWorkspace(workspace: Workspace): {
  raw: string;
  workspace: Workspace;
} {
  const stored = storedSchema.parse({ ...workspace, version: 3, undo: [] });
  let bytes = JSON.stringify(stored).length * 2;
  for (const entry of workspace.undo.slice(-40).toReversed()) {
    const clean = checkpoint.parse(entry);
    const entryBytes = (JSON.stringify(clean).length + 1) * 2;
    if (bytes + entryBytes > WORKSPACE_STORAGE_BUDGET) break;
    bytes += entryBytes;
    stored.undo.unshift(clean);
  }
  return { raw: JSON.stringify(stored), workspace: { ...workspace, undo: stored.undo } };
}

export function decodeAppearanceWorkspace(raw: string): Workspace {
  const { applied, baseProjectVersion, prompt, undo } = storedSchema.parse(JSON.parse(raw));
  return { applied, baseProjectVersion, prompt, undo };
}
