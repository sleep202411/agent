import { z } from "zod";
import {
  StoryAgentCharacterSchema,
  StoryAgentClipKeySchema,
  StoryAgentLocalizedTextSchema,
  StoryAgentStableIdSchema,
  StoryScreenplayDialogueLineSchema,
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
 * whole-document author. Each stage (baton) emits one declarative product; the
 * first four batons assemble the reviewable screenplay, and only after the
 * creator approves it are the Plot operations and production specs derived.
 *
 * The point is correctness by construction: the skeleton is validated for
 * referential integrity BEFORE any scene copy is written, so a dangling edge cannot
 * survive into the proposal. `validateStorySkeleton` is that gate — pure,
 * deterministic, no model involved.
 */

// ── Stage 1 · 影视基础设定 ────────────────────────────────────────────────
// The film foundation: premise + cast. Playback ends naturally on a terminal clip.

export const StoryBibleDraftSchema = z
  .object({
    logline: z.string().max(1_000),
    synopsis: z.string().max(20_000),
    characters: z.array(StoryAgentCharacterSchema).max(100),
  })
  .strict();
export type StoryBibleDraft = z.infer<typeof StoryBibleDraftSchema>;

// ── Stage 2 · 剧情结构师 ──────────────────────────────────────────────────
// A SMALL skeleton: every clip id, stable clip key, one-line beat, and allowed
// successors. An empty successor set is the natural end of playback.
// Scene copy and branching are NOT here — keeping this artifact tiny is what makes
// its referential integrity checkable and repairable cheaply.

export const StorySkeletonNodeSchema = z
  .object({
    id: StoryAgentStableIdSchema,
    clipKey: StoryAgentClipKeySchema,
    /** One-line beat summary the scene writer later expands into production copy. */
    beat: z.string().trim().min(1).max(500),
    /**
     * The beats this one is ALLOWED to flow into — a superset the branch stage
     * draws from. Branching may pick any subset of these as targets and may not
     * invent others, so branching cannot introduce a dangling edge. Empty =
     * terminal clip.
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
// Turns skeleton beats into concrete exits. A branching clip fans into choices,
// a linear clip continues, and a terminal clip uses auto + null.

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
    z
      .object({
        kind: z.literal("auto"),
        /** Null is the natural terminal of an interactive-film clip. */
        nextNodeId: StoryAgentStableIdSchema.nullable(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("choice"),
        decisionId: StoryAgentStableIdSchema,
        prompt: StoryAgentLocalizedTextSchema,
        choices: z.array(StoryBranchChoiceSchema).min(2).max(6),
      })
      .strict(),
  ])
);
export type StoryNodeBranch = z.infer<typeof StoryNodeBranchSchema>;

export const StoryBranchPlanSchema = z
  .object({
    branches: z.array(StoryNodeBranchSchema).max(200),
  })
  .strict();
export type StoryBranchPlan = z.infer<typeof StoryBranchPlanSchema>;

/** Constrain generated exits to the topology already chosen by the skeleton. */
export function storyBranchPlanSchemaForSkeleton(
  skeleton: StorySkeleton
): z.ZodType<StoryBranchPlan> {
  const branches = skeleton.nodes.map((node) => {
    const base = { nodeId: z.literal(node.id) };
    if (node.nextIds.length === 0) {
      return z.object({ ...base, kind: z.literal("auto"), nextNodeId: z.null() }).strict();
    }
    const target = z.enum(node.nextIds as [string, ...string[]]);
    return z.discriminatedUnion("kind", [
      z.object({ ...base, kind: z.literal("auto"), nextNodeId: target }).strict(),
      z
        .object({
          ...base,
          kind: z.literal("choice"),
          decisionId: StoryAgentStableIdSchema,
          prompt: StoryAgentLocalizedTextSchema,
          choices: z
            .array(StoryBranchChoiceSchema.extend({ nextNodeId: target }))
            .min(2)
            .max(6),
        })
        .strict(),
    ]);
  });
  return z.object({ branches: z.array(z.union(branches)).length(skeleton.nodes.length) }).strict();
}

// ── Stage 4 · 场景撰写师 ──────────────────────────────────────────────────
// Per-clip editorial copy. It cannot introduce ids or graph edges.

export const StorySceneProseNodeSchema = z
  .object({
    nodeId: StoryAgentStableIdSchema,
    name: z.string().trim().max(120).optional(),
    /** Screenplay scene heading, e.g. "INT. FORBIDDEN CITY – NIGHT". */
    heading: z.string().trim().min(1).max(240),
    /** Complete playable action for the scene, not a graph-card synopsis. */
    action: z.string().trim().min(1).max(12_000),
    dialogue: z.array(StoryScreenplayDialogueLineSchema).max(120),
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

    if (clipKeys.has(node.clipKey)) {
      issues.push({
        code: "DUPLICATE_CLIP_KEY",
        detail: `Clip key "${node.clipKey}" is used more than once.`,
      });
    } else {
      clipKeys.add(node.clipKey);
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
