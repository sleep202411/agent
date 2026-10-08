import { z } from "zod/v4";
import {
  DEFAULT_EXPERIENCE_APPEARANCE,
  ExperienceAppearanceSchema,
  GameUIProjectSchema,
  migrateStoredExperienceAppearance,
  type ExperienceAppearance,
  type GameUIProject,
} from "@repo/shared/experience-runtime";

export interface AppearanceCheckpoint {
  applied: ExperienceAppearance;
  gameUi: GameUIProject | null;
}
export interface Workspace extends AppearanceCheckpoint {
  baseProjectVersion?: number;
  prompt: string;
  undo: AppearanceCheckpoint[];
}
export const DEFAULT_APPEARANCE = DEFAULT_EXPERIENCE_APPEARANCE;
export const WORKSPACE_STORAGE_BUDGET = 2 * 1024 * 1024;
const gameProject = z.custom<GameUIProject>(
  (value) => GameUIProjectSchema.safeParse(value).success
);
const checkpoint = z
  .object({ applied: ExperienceAppearanceSchema, gameUi: z.string().nullable() })
  .strict();
const storedSchema = z
  .object({
    version: z.literal(2),
    applied: ExperienceAppearanceSchema,
    gameUi: z.string().nullable(),
    baseProjectVersion: z.number().int().nonnegative().optional(),
    prompt: z.string().max(2000),
    undo: z.array(checkpoint).max(40),
    gameUIs: z
      .record(z.string(), gameProject)
      .refine((value) => Object.keys(value).length <= 41, "Too many game UI versions."),
  })
  .strict();
const gameKey = (project: GameUIProject) =>
  `${project.artifact.sourceHash}:${project.artifact.artifactHash}`;

/** Store each source/build once. Evict oldest undo entries before the current draft. */
export function encodeAppearanceWorkspace(workspace: Workspace): {
  raw: string;
  workspace: Workspace;
} {
  const gameUIs: Record<string, GameUIProject> = {};
  const reference = (value: AppearanceCheckpoint) => {
    if (value.gameUi) {
      const key = gameKey(value.gameUi);
      if (
        gameUIs[key] &&
        gameUIs[key] !== value.gameUi &&
        JSON.stringify(gameUIs[key]) !== JSON.stringify(value.gameUi)
      )
        throw new Error("Conflicting game UI versions in the draft.");
      gameUIs[key] = value.gameUi;
      return { applied: value.applied, gameUi: key };
    }
    return { applied: value.applied, gameUi: null };
  };
  const current = reference(workspace);
  const stored = {
    version: 2 as const,
    ...current,
    prompt: workspace.prompt,
    baseProjectVersion: workspace.baseProjectVersion,
    undo: [] as z.infer<typeof checkpoint>[],
    gameUIs,
  };
  // Incremental budget accounting avoids repeatedly serializing all large historical builds.
  let bytes = JSON.stringify(stored).length * 2;
  const kept: AppearanceCheckpoint[] = [];
  for (const entry of workspace.undo.slice(-40).toReversed()) {
    const key = entry.gameUi ? gameKey(entry.gameUi) : null;
    const added =
      key && !gameUIs[key]
        ? (JSON.stringify(key).length + JSON.stringify(entry.gameUi).length + 2) * 2
        : 0;
    const ref = { applied: entry.applied, gameUi: key };
    const entryBytes = (JSON.stringify(ref).length + 1) * 2;
    if (bytes + added + entryBytes > WORKSPACE_STORAGE_BUDGET) break;
    reference(entry);
    bytes += added + entryBytes;
    kept.unshift(entry);
    stored.undo.unshift(ref);
  }
  storedSchema.parse(stored);
  return { raw: JSON.stringify(stored), workspace: { ...workspace, undo: kept } };
}

export function decodeAppearanceWorkspace(raw: string): Workspace {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object") throw new Error("Invalid appearance draft.");
  if ("version" in value) {
    const stored = storedSchema.parse(value);
    const restore = (ref: z.infer<typeof checkpoint>): AppearanceCheckpoint => {
      const gameUi = ref.gameUi ? stored.gameUIs[ref.gameUi] : null;
      if (ref.gameUi && (!gameUi || gameKey(gameUi) !== ref.gameUi))
        throw new Error("The draft references a missing game UI version.");
      return { applied: ref.applied, gameUi: gameUi ?? null };
    };
    return {
      ...restore(stored),
      prompt: stored.prompt,
      baseProjectVersion: stored.baseProjectVersion,
      undo: stored.undo.map(restore),
    };
  }
  // One-time import of browser drafts from the retired workspace. Chat stays in Harness.
  const legacy = z
    .object({
      applied: z.unknown(),
      candidate: z.unknown().optional(),
      gameUi: gameProject.nullish(),
      prompt: z.string().max(2000),
      baseProjectVersion: z.number().int().nonnegative().optional(),
      messages: z
        .array(
          z.object({
            kind: z.string().optional(),
            before: z.unknown().optional(),
            beforeGameUi: gameProject.nullish(),
          })
        )
        .optional(),
    })
    .parse(value);
  return {
    applied: migrateStoredExperienceAppearance(legacy.candidate ?? legacy.applied),
    gameUi: legacy.gameUi ?? null,
    prompt: legacy.prompt,
    baseProjectVersion: legacy.baseProjectVersion,
    undo: (legacy.messages ?? [])
      .filter((entry) => entry.kind === "updated" && entry.before !== undefined)
      .slice(-40)
      .map((entry) => ({
        applied: migrateStoredExperienceAppearance(entry.before),
        gameUi: entry.beforeGameUi ?? null,
      })),
  };
}
