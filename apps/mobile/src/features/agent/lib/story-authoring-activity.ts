/**
 * Host activity for a Story authoring run — same stage keys and copy mapping
 * as PC `StoryProjectAgentPanel` (`storyStudio.authoringRun.activity.*`).
 */

import type { MessageKey } from "@/i18n";

import {
  STORY_AUTHORING_STAGE_KEYS,
  type StoryAgentRunDto,
  type StoryAuthoringStageKey,
} from "../api/story-agent-runs-api";

const STAGE_ACTIVITY_KEYS = {
  foundation: "agent.activity.authoring.foundation",
  structure: "agent.activity.authoring.structure",
  branch: "agent.activity.authoring.branch",
  scene: "agent.activity.authoring.scene",
  assets: "agent.activity.authoring.assets",
  storyboard: "agent.activity.authoring.storyboard",
  validate: "agent.activity.authoring.validate",
} as const satisfies Record<StoryAuthoringStageKey, MessageKey>;

const APPLYING_ACTIVITY_KEYS = {
  savingScript: "agent.activity.authoring.savingScript",
  savingPlot: "agent.activity.authoring.savingPlot",
  savingAssets: "agent.activity.authoring.savingAssets",
  savingStoryboard: "agent.activity.authoring.savingStoryboard",
  savingUpdate: "agent.activity.authoring.savingUpdate",
} as const satisfies Record<string, MessageKey>;

/** Same schema-version discriminators as `@repo/shared/story-agent`. */
function applyingActivityKey(run: StoryAgentRunDto): MessageKey {
  switch (run.proposal.schemaVersion) {
    case "story-screenplay-proposal-v1":
      return APPLYING_ACTIVITY_KEYS.savingScript;
    case "story-plot-proposal-v1":
      return APPLYING_ACTIVITY_KEYS.savingPlot;
    case "story-asset-proposal-v1":
      return APPLYING_ACTIVITY_KEYS.savingAssets;
    case "story-storyboard-proposal-v1":
      return APPLYING_ACTIVITY_KEYS.savingStoryboard;
    default:
      return APPLYING_ACTIVITY_KEYS.savingUpdate;
  }
}

function isAuthoringStageKey(value: string): value is StoryAuthoringStageKey {
  return (STORY_AUTHORING_STAGE_KEYS as readonly string[]).includes(value);
}

function activeAuthoringStageKey(run: StoryAgentRunDto): StoryAuthoringStageKey {
  const running = run.authoringStages?.find((stage) => stage.status === "running")?.key;
  if (running && isAuthoringStageKey(running)) return running;
  const pending = run.authoringStages?.find((stage) => stage.status === "pending")?.key;
  if (pending && isAuthoringStageKey(pending)) return pending;
  return STORY_AUTHORING_STAGE_KEYS[0];
}

/**
 * Stage copy for the current Agent OS turn, only when the Story run is the
 * pending external job (PC `resolveAgentOsActivityStatus` host correlation).
 */
export function storyAuthoringActivityMessageKey(input: {
  run: StoryAgentRunDto | null;
  pendingExternalJobId: string | null;
  agentStatus: string;
}): MessageKey | null {
  if (
    input.agentStatus === "completed" ||
    input.agentStatus === "failed" ||
    input.agentStatus === "cancelled"
  ) {
    return null;
  }
  const run = input.run;
  const jobId = input.pendingExternalJobId?.trim() ?? "";
  if (!run?.agentOsManaged || !jobId || run.id !== jobId) return null;
  if (run.status === "authoring") return STAGE_ACTIVITY_KEYS[activeAuthoringStageKey(run)];
  if (run.status === "applying") return applyingActivityKey(run);
  return null;
}

export type StoryProposalStage = "script" | "plot" | "assets" | "storyboard" | "patch";

export function storyProposalStageFromSchema(schemaVersion: string): StoryProposalStage {
  switch (schemaVersion) {
    case "story-screenplay-proposal-v1":
      return "script";
    case "story-plot-proposal-v1":
      return "plot";
    case "story-asset-proposal-v1":
      return "assets";
    case "story-storyboard-proposal-v1":
      return "storyboard";
    default:
      return "patch";
  }
}

export function storyAgentRunIdFromApproval(approval: {
  toolId: string;
  arguments: unknown;
}): string | null {
  if (approval.toolId !== "story.applyProposal") return null;
  if (
    !approval.arguments ||
    typeof approval.arguments !== "object" ||
    Array.isArray(approval.arguments)
  ) {
    return null;
  }
  const storyRunId = (approval.arguments as Record<string, unknown>).storyAgentRunId;
  return typeof storyRunId === "string" && storyRunId.trim() ? storyRunId.trim() : null;
}

export function storyProposalDecisionMessageKey(stage: StoryProposalStage): MessageKey {
  switch (stage) {
    case "script":
      return "agent.proposal.decision.script";
    case "plot":
      return "agent.proposal.decision.plot";
    case "assets":
      return "agent.proposal.decision.assets";
    case "storyboard":
      return "agent.proposal.decision.storyboard";
    default:
      return "agent.proposal.decision.patch";
  }
}

export function storyProposalAssetCount(proposal: StoryAgentRunDto["proposal"]): number {
  const specs = proposal.assetPlan?.assetSpecs;
  return Array.isArray(specs) ? specs.length : 0;
}

export function storyProposalAssetKindCounts(proposal: StoryAgentRunDto["proposal"]): {
  total: number;
  characters: number;
  locations: number;
  props: number;
} {
  const specs = Array.isArray(proposal.assetPlan?.assetSpecs) ? proposal.assetPlan.assetSpecs : [];
  let characters = 0;
  let locations = 0;
  let props = 0;
  for (const spec of specs) {
    if (spec?.kind === "character") characters += 1;
    else if (spec?.kind === "location") locations += 1;
    else if (spec?.kind === "prop") props += 1;
  }
  return { total: specs.length, characters, locations, props };
}

export function storyProposalPlotMetrics(proposal: StoryAgentRunDto["proposal"]): {
  nodes: number;
  branches: number;
  endings: number;
} {
  const scenes = Array.isArray(proposal.screenplay?.scenes) ? proposal.screenplay.scenes : [];
  let branches = 0;
  let endings = 0;
  for (const scene of scenes) {
    if (!scene || typeof scene !== "object") continue;
    const exit = (scene as Record<string, unknown>).exit;
    if (!exit || typeof exit !== "object") continue;
    const record = exit as Record<string, unknown>;
    if (record.kind === "choice" && Array.isArray(record.choices)) {
      branches += record.choices.length;
    }
    if (record.kind === "auto" && record.nextNodeId == null) endings += 1;
  }
  return { nodes: scenes.length, branches, endings };
}

export type StoryProposalStoryboardClipRow = {
  title: string;
  kind: "image" | "video";
  durationMs: number;
};

export type StoryProposalStoryboardSequenceRow = {
  key: string;
  title: string;
  description: string;
  durationMs: number;
  clips: StoryProposalStoryboardClipRow[];
};

export function storyProposalStoryboardSequences(
  proposal: StoryAgentRunDto["proposal"]
): StoryProposalStoryboardSequenceRow[] {
  const raw = proposal.storyboardPlan?.storyboardSequences;
  if (!Array.isArray(raw)) return [];
  return raw.map((sequence, index) => {
    const record =
      sequence && typeof sequence === "object" ? (sequence as Record<string, unknown>) : {};
    const clipsRaw = Array.isArray(record.clips) ? record.clips : [];
    const clips = clipsRaw.map((clip, clipIndex) => {
      const item = clip && typeof clip === "object" ? (clip as Record<string, unknown>) : {};
      const title =
        typeof item.title === "string" && item.title.trim()
          ? item.title.trim()
          : `Clip ${clipIndex + 1}`;
      return {
        title,
        kind: item.kind === "video" ? ("video" as const) : ("image" as const),
        durationMs: typeof item.durationMs === "number" ? item.durationMs : 0,
      };
    });
    const plotNodeId = typeof record.plotNodeId === "string" ? record.plotNodeId.trim() : "";
    const title =
      typeof record.title === "string" && record.title.trim()
        ? record.title.trim()
        : plotNodeId || `Sequence ${index + 1}`;
    return {
      key: plotNodeId || `seq-${index}`,
      title,
      description: typeof record.description === "string" ? record.description.trim() : "",
      durationMs: typeof record.durationMs === "number" ? record.durationMs : 0,
      clips,
    };
  });
}

export function storyProposalStoryboardMetrics(proposal: StoryAgentRunDto["proposal"]): {
  sequences: number;
  clips: number;
  seconds: number;
  assetSpecs: number;
} {
  const sequences = storyProposalStoryboardSequences(proposal);
  const clips = sequences.reduce((total, sequence) => total + sequence.clips.length, 0);
  const durationMs = sequences.reduce((total, sequence) => total + sequence.durationMs, 0);
  return {
    sequences: sequences.length,
    clips,
    seconds: Math.round(durationMs / 1000),
    assetSpecs: storyProposalAssetCount(proposal),
  };
}

/** H5 `proposalDecision.questionMobile` — assets interpolates `{count}`. */
export function storyProposalDecisionQuestion(
  t: (key: MessageKey) => string,
  stage: StoryProposalStage,
  assetCount: number
): string {
  const copy = t(storyProposalDecisionMessageKey(stage));
  if (stage !== "assets") return copy;
  return copy.replace(/\{count\}/g, String(assetCount));
}
