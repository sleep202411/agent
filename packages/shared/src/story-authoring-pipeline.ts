import { z } from "zod";
import {
  StoryAgentCharacterSchema,
  StoryAgentClipKeySchema,
  StoryAgentEndingSchema,
  StoryAgentLocalizedTextSchema,
  StoryAgentStableIdSchema,
  StoryAgentTextBodyLocalizedTextSchema,
} from "./story-agent.js";

// Stage keys + progress schema live in story-agent.ts (the DTO home) to avoid a
// cycle; re-export here so pipeline consumers have one import surface.
export {
  STORY_AUTHORING_STAGE_KEYS,
  StoryAuthoringStageProgressSchema,
  type StoryAuthoringStageKey,
  type StoryAuthoringStageProgress,
} from "./story-agent.js";

/**
 * Contracts for the deterministic authoring pipeline that replaces the single
 * whole-document author. Each stage (baton) emits one declarative product; a
 * deterministic assembler turns the four products into StoryPatchOperations.
 *
 * The point is correctness by construction: the skeleton is validated for
 * referential integrity BEFORE any prose is written, so a dangling edge cannot
 * survive into the proposal. `validateStorySkeleton` is that gate — pure,
 * deterministic, no model involved.
 */

// ── Stage 1 · 世界观架构师 ────────────────────────────────────────────────
// The story bible: premise + cast + endings. Reuses the shared leaf schemas so
// there is no third parallel definition of these shapes.

export const StoryBibleDraftSchema = z
  .object({
    logline: z.string().max(1_000),
    synopsis: z.string().max(20_000),
    worldview: z.string().max(20_000),
    characters: z.array(StoryAgentCharacterSchema).max(100),
    endings: z.array(StoryAgentEndingSchema).min(1).max(100),
  })
  .strict();
export type StoryBibleDraft = z.infer<typeof StoryBibleDraftSchema>;

// ── Stage 2 · 剧情结构师 ──────────────────────────────────────────────────
// A SMALL skeleton: every node id, its kind, a one-line beat, and its intended
// single successor (null = the beat ends the story via an ending, wired later).
// Prose and branching are NOT here — keeping this artifact tiny is what makes
// its referential integrity checkable and repairable cheaply.

export const StorySkeletonNodeSchema = z
  .object({
    id: StoryAgentStableIdSchema,
    kind: z.enum(["clip", "text"]),
    /** Uppercase stable key; required for clip nodes, absent for text nodes. */
    clipKey: StoryAgentClipKeySchema.optional(),
    /** One-line beat summary the scene writer later expands into prose. */
    beat: z.string().trim().min(1).max(500),
    /**
     * The beats this one is ALLOWED to flow into — a superset the branch stage
     * draws from. Branching may pick any subset of these as targets and may not
     * invent others, so branching cannot introduce a dangling edge. Empty =
     * terminal (resolves to an ending during the branch stage).
     */
    nextIds: z.array(StoryAgentStableIdSchema).max(6),
  })
  .strict();
export type StorySkeletonNode = z.infer<typeof StorySkeletonNodeSchema>;

export const StorySkeletonSchema = z
  .object({
    entryId: StoryAgentStableIdSchema,
    nodes: z.array(StorySkeletonNodeSchema).min(1).max(200),
  })
  .strict();
export type StorySkeleton = z.infer<typeof StorySkeletonSchema>;

// ── Stage 3 · 分支编排师 ──────────────────────────────────────────────────
// Turns skeleton beats into concrete exits. A branching beat fans into choices
// (each targeting another skeleton node or an ending); a linear beat continues;
// a terminal beat resolves to an ending.

const StoryBranchChoiceSchema = z
  .object({
    choiceId: StoryAgentStableIdSchema,
    label: StoryAgentLocalizedTextSchema,
    /** Target skeleton node id. */
    nextNodeId: StoryAgentStableIdSchema,
  })
  .strict();

export const StoryNodeBranchSchema = z.object({ nodeId: StoryAgentStableIdSchema }).and(
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("auto"), nextNodeId: StoryAgentStableIdSchema }).strict(),
    z
      .object({
        kind: z.literal("choice"),
        decisionId: StoryAgentStableIdSchema,
        prompt: StoryAgentLocalizedTextSchema,
        choices: z.array(StoryBranchChoiceSchema).min(2).max(6),
      })
      .strict(),
    z.object({ kind: z.literal("ending"), endingId: StoryAgentStableIdSchema }).strict(),
  ])
);
export type StoryNodeBranch = z.infer<typeof StoryNodeBranchSchema>;

export const StoryBranchPlanSchema = z
  .object({
    branches: z.array(StoryNodeBranchSchema).max(200),
  })
  .strict();
export type StoryBranchPlan = z.infer<typeof StoryBranchPlanSchema>;

// ── Stage 4 · 场景撰写师 ──────────────────────────────────────────────────
// Per-node prose. Fills bodies of already-wired nodes; cannot introduce ids.

export const StorySceneProseNodeSchema = z
  .object({
    nodeId: StoryAgentStableIdSchema,
    title: StoryAgentLocalizedTextSchema.optional(),
    /** Text-node prose, or a clip node's shot description. */
    body: StoryAgentTextBodyLocalizedTextSchema,
  })
  .strict();

export const StorySceneProseSchema = z
  .object({ scenes: z.array(StorySceneProseNodeSchema).max(200) })
  .strict();
export type StorySceneProse = z.infer<typeof StorySceneProseSchema>;

// ── Deterministic skeleton validator ──────────────────────────────────────

export interface StorySkeletonValidationIssue {
  code:
    | "DUPLICATE_NODE_ID"
    | "DUPLICATE_CLIP_KEY"
    | "CLIP_KEY_REQUIRED"
    | "CLIP_KEY_ON_TEXT"
    | "ENTRY_NOT_FOUND"
    | "DANGLING_NEXT"
    | "UNREACHABLE_NODE";
  detail: string;
}

/**
 * Enforces the referential invariants the executor's `assertAgentDraftIntegrity`
 * would later enforce, but on the tiny skeleton BEFORE prose exists — so the
 * structure stage can repair against these errors cheaply and a dangling edge
 * can never reach the proposal. Returns [] when the skeleton is sound.
 */
export function validateStorySkeleton(skeleton: StorySkeleton): StorySkeletonValidationIssue[] {
  const issues: StorySkeletonValidationIssue[] = [];
  const ids = new Set<string>();
  const clipKeys = new Set<string>();

  for (const node of skeleton.nodes) {
    if (ids.has(node.id)) {
      issues.push({
        code: "DUPLICATE_NODE_ID",
        detail: `Node id "${node.id}" is used more than once.`,
      });
    }
    ids.add(node.id);

    if (node.kind === "clip") {
      if (!node.clipKey) {
        issues.push({
          code: "CLIP_KEY_REQUIRED",
          detail: `Clip node "${node.id}" needs a clipKey.`,
        });
      } else if (clipKeys.has(node.clipKey)) {
        issues.push({
          code: "DUPLICATE_CLIP_KEY",
          detail: `Clip key "${node.clipKey}" is used more than once.`,
        });
      } else {
        clipKeys.add(node.clipKey);
      }
    } else if (node.clipKey) {
      issues.push({
        code: "CLIP_KEY_ON_TEXT",
        detail: `Text node "${node.id}" must not carry a clipKey.`,
      });
    }
  }

  if (!ids.has(skeleton.entryId)) {
    issues.push({
      code: "ENTRY_NOT_FOUND",
      detail: `Entry node "${skeleton.entryId}" is not in the node set.`,
    });
  }

  for (const node of skeleton.nodes) {
    for (const next of node.nextIds) {
      if (!ids.has(next)) {
        issues.push({
          code: "DANGLING_NEXT",
          detail: `Node "${node.id}" flows into missing node "${next}".`,
        });
      }
    }
  }

  // Reachability from the entry across every declared edge: an orphan beat is
  // authored waste and usually a sign the model dropped an intended edge.
  if (ids.has(skeleton.entryId)) {
    const byId = new Map(skeleton.nodes.map((node) => [node.id, node]));
    const reachable = new Set<string>();
    const queue = [skeleton.entryId];
    while (queue.length > 0) {
      const id = queue.pop()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      for (const next of byId.get(id)?.nextIds ?? []) {
        if (ids.has(next)) queue.push(next);
      }
    }
    for (const node of skeleton.nodes) {
      if (!reachable.has(node.id)) {
        issues.push({
          code: "UNREACHABLE_NODE",
          detail: `Node "${node.id}" is not reachable from the entry.`,
        });
      }
    }
  }

  return issues;
}
