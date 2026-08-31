import { describe, expect, it } from "vitest";
import {
  STORY_AGENT_TARGET_DRAFT_SCHEMA_VERSION,
  STORY_ASSET_PROPOSAL_SCHEMA_VERSION,
  STORY_NOOP_PROPOSAL_SCHEMA_VERSION,
  STORY_PLOT_PROPOSAL_SCHEMA_VERSION,
  STORY_SCREENPLAY_PROPOSAL_SCHEMA_VERSION,
  STORY_SCREENPLAY_SCHEMA_VERSION,
  STORY_STORYBOARD_PROPOSAL_SCHEMA_VERSION,
  StoryAgentRunDtoSchema,
  StoryAgentRunProposalSchema,
  StoryAssetProposalSchema,
  StoryNoopProposalSchema,
  StoryPlotProposalSchema,
  StoryScreenplayProposalSchema,
  StoryStoryboardProposalSchema,
  buildStoryScreenplayDocument,
  isStoryAssetProposal,
  isStoryNoopProposal,
  isStoryPlotProposal,
  isStoryStoryboardProposal,
  storyScreenplayDocument,
} from "./story-agent.js";

const HASH = "a".repeat(64);

function proposal() {
  return {
    schemaVersion: STORY_SCREENPLAY_PROPOSAL_SCHEMA_VERSION,
    draftSchemaVersion: STORY_AGENT_TARGET_DRAFT_SCHEMA_VERSION,
    baseDraftRevision: 0,
    baseContentHash: HASH,
    baseLayoutRevision: 0,
    baseScriptDocumentId: null,
    baseScriptSequence: 0,
    baseScriptHash: HASH,
    title: "Night Gate",
    summary: "A guard chooses who may leave the city.",
    screenplay: {
      schemaVersion: STORY_SCREENPLAY_SCHEMA_VERSION,
      storyLanguage: "en-US",
      title: "Night Gate",
      logline: "One gate decides a city's fate.",
      synopsis: "A guard receives an impossible order before dawn.",
      characters: [],
      entrySceneId: "opening",
      scenes: [
        {
          nodeId: "opening",
          clipKey: "OPENING",
          heading: "EXT. CITY GATE – NIGHT",
          beat: "The sealed order arrives.",
          action: "Rain needles the empty road as the guard breaks the wax seal.",
          dialogue: [
            {
              characterId: null,
              speaker: "MESSENGER",
              text: "No one leaves before sunrise.",
            },
          ],
          exit: { kind: "auto", nextNodeId: null },
        },
      ],
    },
  };
}

describe("StoryScreenplayProposalSchema", () => {
  it("accepts a complete reviewable screenplay pinned to an exact Script head", () => {
    expect(StoryScreenplayProposalSchema.parse(proposal()).screenplay.scenes).toHaveLength(1);
  });

  it("rejects exits that target a scene absent from the screenplay", () => {
    const invalid = proposal();
    invalid.screenplay.scenes[0].exit.nextNodeId = "missing";
    expect(StoryScreenplayProposalSchema.safeParse(invalid).success).toBe(false);
  });

  it("builds the one creator-visible document used by review and Script", () => {
    const value = proposal();
    const document = buildStoryScreenplayDocument(value.screenplay);
    expect(document.blocks).toEqual([
      { kind: "heading", level: 1, text: "Night Gate" },
      { kind: "paragraph", text: "One gate decides a city's fate." },
      { kind: "heading", level: 2, text: "Synopsis" },
      {
        kind: "paragraph",
        text: "A guard receives an impossible order before dawn.",
      },
      { kind: "heading", level: 2, text: "1. EXT. CITY GATE – NIGHT" },
      {
        kind: "paragraph",
        text: "Rain needles the empty road as the guard breaks the wax seal.",
      },
      { kind: "paragraph", text: "MESSENGER" },
      { kind: "paragraph", text: "No one leaves before sunrise." },
    ]);

    expect(
      storyScreenplayDocument(StoryScreenplayProposalSchema.parse({ ...value, document }))
    ).toEqual(document);
  });

  it("projects old durable proposals through the same canonical builder", () => {
    const parsed = StoryScreenplayProposalSchema.parse(proposal());
    expect(storyScreenplayDocument(parsed)).toEqual(
      buildStoryScreenplayDocument(parsed.screenplay)
    );
  });

  it("keeps the former combined production plan readable for durable v1 rows", () => {
    const legacy = {
      ...proposal(),
      productionPlan: {
        schemaVersion: "story-production-plan-v1" as const,
        assetSpecs: [],
        storyboardSequences: [
          {
            plotNodeId: "opening",
            title: "Opening",
            description: "The opening scene.",
            durationMs: 1_000,
            clips: [
              {
                stableKey: "shot.opening",
                kind: "image" as const,
                title: "Opening",
                description: "The opening frame.",
                startMs: 0,
                durationMs: 1_000,
                imagePrompt: "A rain-swept gate at night.",
              },
            ],
            cues: [],
          },
        ],
      },
    };
    expect(StoryScreenplayProposalSchema.parse(legacy).productionPlan).toEqual(
      legacy.productionPlan
    );
  });
});

describe("independent story stage proposals", () => {
  const SCRIPT_DOCUMENT_ID = "00000000-0000-4000-8000-000000000001";

  function downstreamBase() {
    const base = proposal();
    return {
      draftSchemaVersion: base.draftSchemaVersion,
      baseDraftRevision: base.baseDraftRevision,
      baseContentHash: base.baseContentHash,
      baseLayoutRevision: base.baseLayoutRevision,
      baseScriptDocumentId: SCRIPT_DOCUMENT_ID,
      baseScriptSequence: 4,
      baseScriptHash: base.baseScriptHash,
      title: base.title,
      summary: base.summary,
    };
  }

  function storyboardPlan() {
    return {
      storyboardSequences: [
        {
          plotNodeId: "opening",
          title: "Opening",
          description: "The sealed order arrives.",
          durationMs: 1_000,
          clips: [
            {
              stableKey: "shot.opening",
              kind: "image" as const,
              title: "Opening",
              description: "The rain-swept gate.",
              startMs: 0,
              durationMs: 1_000,
              imagePrompt: "A rain-swept gate at night.",
            },
          ],
          cues: [],
        },
      ],
    };
  }

  it("uses distinct discriminants and guards for Plot, Assets, and Storyboard", () => {
    const screenplay = proposal().screenplay;
    const document = buildStoryScreenplayDocument(screenplay);
    const assetPlan = { assetSpecs: [] };
    const values = [
      StoryPlotProposalSchema.parse({
        schemaVersion: STORY_PLOT_PROPOSAL_SCHEMA_VERSION,
        ...downstreamBase(),
        screenplay,
        document,
      }),
      StoryAssetProposalSchema.parse({
        schemaVersion: STORY_ASSET_PROPOSAL_SCHEMA_VERSION,
        ...downstreamBase(),
        screenplay,
        assetPlan,
      }),
      StoryStoryboardProposalSchema.parse({
        schemaVersion: STORY_STORYBOARD_PROPOSAL_SCHEMA_VERSION,
        ...downstreamBase(),
        screenplay,
        assetPlan,
        storyboardPlan: storyboardPlan(),
      }),
    ];

    expect(values.map((value) => StoryAgentRunProposalSchema.parse(value))).toEqual(values);
    expect(isStoryPlotProposal(values[0]!)).toBe(true);
    expect(isStoryAssetProposal(values[1]!)).toBe(true);
    expect(isStoryStoryboardProposal(values[2]!)).toBe(true);
  });

  it("requires downstream stages to pin a real Script document", () => {
    const result = StoryAssetProposalSchema.safeParse({
      schemaVersion: STORY_ASSET_PROPOSAL_SCHEMA_VERSION,
      ...downstreamBase(),
      baseScriptDocumentId: null,
      screenplay: proposal().screenplay,
      assetPlan: { assetSpecs: [] },
    });
    expect(result.success).toBe(false);
  });

  it("represents a current-workflow request as a truthful Noop proposal", () => {
    const value = StoryNoopProposalSchema.parse({
      schemaVersion: STORY_NOOP_PROPOSAL_SCHEMA_VERSION,
      ...downstreamBase(),
    });
    expect(StoryAgentRunProposalSchema.parse(value)).toEqual(value);
    expect(isStoryNoopProposal(value)).toBe(true);
  });

  it("allows Noop only as an unconfirmed terminal run with unchanged revisions", () => {
    const now = "2026-08-25T12:00:00.000Z";
    const proposal = StoryNoopProposalSchema.parse({
      schemaVersion: STORY_NOOP_PROPOSAL_SCHEMA_VERSION,
      ...downstreamBase(),
    });
    const run = {
      id: "00000000-0000-4000-8000-000000000010",
      kind: "apply" as const,
      status: "succeeded" as const,
      workspaceId: "00000000-0000-4000-8000-000000000011",
      projectId: "00000000-0000-4000-8000-000000000012",
      chapterId: "00000000-0000-4000-8000-000000000013",
      initiator: { id: "user-1" },
      agentOsManaged: false,
      confirmedByUserId: null,
      cancelledByUserId: null,
      proposal,
      authoringStages: null,
      undoOfRunId: null,
      baseDraftRevision: proposal.baseDraftRevision,
      baseLayoutRevision: proposal.baseLayoutRevision,
      resultDraftRevision: proposal.baseDraftRevision,
      resultLayoutRevision: proposal.baseLayoutRevision,
      affectedNodeIds: [],
      createdNodeIds: [],
      revealStartedAt: null,
      lockExpiresAt: null,
      error: null,
      createdAt: now,
      expiresAt: now,
      confirmedAt: null,
      startedAt: now,
      completedAt: now,
      cancelledAt: null,
      updatedAt: now,
    };

    expect(StoryAgentRunDtoSchema.safeParse(run).success).toBe(true);
    expect(
      StoryAgentRunDtoSchema.safeParse({
        ...run,
        status: "proposed",
        startedAt: null,
        completedAt: null,
        resultDraftRevision: null,
        resultLayoutRevision: null,
      }).success
    ).toBe(false);
    expect(
      StoryAgentRunDtoSchema.safeParse({
        ...run,
        resultDraftRevision: run.baseDraftRevision + 1,
      }).success
    ).toBe(false);
  });

  it("does not re-arm an already confirmed Script proposal into authoring", () => {
    const now = "2026-08-25T12:00:00.000Z";
    const scriptProposal = StoryScreenplayProposalSchema.parse(proposal());
    const result = StoryAgentRunDtoSchema.safeParse({
      id: "00000000-0000-4000-8000-000000000020",
      kind: "apply",
      status: "authoring",
      workspaceId: "00000000-0000-4000-8000-000000000021",
      projectId: "00000000-0000-4000-8000-000000000022",
      chapterId: "00000000-0000-4000-8000-000000000023",
      initiator: { id: "user-1" },
      agentOsManaged: false,
      confirmedByUserId: "user-1",
      cancelledByUserId: null,
      proposal: scriptProposal,
      authoringStages: [{ key: "foundation", status: "running" }],
      undoOfRunId: null,
      baseDraftRevision: scriptProposal.baseDraftRevision,
      baseLayoutRevision: scriptProposal.baseLayoutRevision,
      resultDraftRevision: null,
      resultLayoutRevision: null,
      affectedNodeIds: [],
      createdNodeIds: [],
      revealStartedAt: null,
      lockExpiresAt: null,
      error: null,
      createdAt: now,
      expiresAt: now,
      confirmedAt: now,
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
      updatedAt: now,
    });
    expect(result.success).toBe(false);
  });
});
