import { describe, expect, it } from "vitest";
import type { StoryPatchProposal, StoryScreenplayProposal } from "@repo/shared/story-agent";
import { storyAgentAutoNextNodeId, storyAuthoringProposalReview } from "./story-authoring-proposal";

const OPERATION_ID = "00000000-0000-4000-8000-000000000001";

describe("storyAuthoringProposalReview", () => {
  it("uses the unconditional route as the canonical continuation", () => {
    expect(
      storyAgentAutoNextNodeId({
        kind: "auto",
        routes: [
          {
            when: {
              kind: "compare",
              variableKey: "courage",
              operator: "at-least",
              value: 3,
            },
            target: { kind: "node", nodeId: "secret" },
          },
          { target: { kind: "node", nodeId: "main" } },
        ],
      })
    ).toBe("main");
  });

  it("projects authored operations into reviewable content and metrics", () => {
    const proposal = {
      operations: [
        {
          operationId: OPERATION_ID,
          summary: "Overview",
          kind: "story_bible.update_overview",
          payload: { logline: "A courier relives one impossible night." },
        },
        {
          operationId: "00000000-0000-4000-8000-000000000002",
          summary: "Opening",
          kind: "story_graph.put_node",
          payload: {
            intent: "create",
            node: {
              kind: "clip",
              nodeId: "opening",
              clipKey: "OPENING",
              name: "Opening",
              interactions: [],
              exit: {
                kind: "choice",
                decisionId: "route",
                prompt: { "en-US": "Which route?" },
                choices: [
                  {
                    choiceId: "left",
                    label: { "en-US": "Left" },
                    nextNodeId: "ending",
                  },
                  {
                    choiceId: "right",
                    label: { "en-US": "Right" },
                    nextNodeId: "ending",
                  },
                ],
              },
            },
          },
        },
        {
          operationId: "00000000-0000-4000-8000-000000000003",
          summary: "Ending",
          kind: "story_graph.put_node",
          payload: {
            intent: "create",
            node: {
              kind: "clip",
              nodeId: "ending",
              clipKey: "ENDING",
              name: "Ending",
              interactions: [],
              exit: { kind: "auto", nextNodeId: null },
            },
          },
        },
      ],
    } as StoryPatchProposal;

    expect(storyAuthoringProposalReview(proposal)).toMatchObject({
      logline: "A courier relives one impossible night.",
      metrics: { scenes: 2, branches: 2, endings: 1, interactions: 0 },
      scenes: [{ nodeId: "opening" }, { nodeId: "ending" }],
    });
  });

  it("projects the screenplay itself before any Plot Tree operations exist", () => {
    const proposal = {
      schemaVersion: "story-screenplay-proposal-v1",
      draftSchemaVersion: "interactive-story-draft-v1",
      baseDraftRevision: 0,
      baseContentHash: "0".repeat(64),
      baseLayoutRevision: 0,
      baseScriptDocumentId: null,
      baseScriptSequence: 0,
      baseScriptHash: "1".repeat(64),
      title: "The Order",
      summary: "A one-scene screenplay.",
      screenplay: {
        schemaVersion: "interactive-screenplay-v1",
        storyLanguage: "en-US",
        title: "The Order",
        logline: "A sealed order changes the city.",
        synopsis: "One guard chooses between duty and mercy.",
        characters: [],
        entrySceneId: "gate",
        scenes: [
          {
            nodeId: "gate",
            clipKey: "GATE",
            heading: "EXT. CITY GATE – NIGHT",
            beat: "The order is opened.",
            action: "The guard opens the order under the rain.",
            dialogue: [{ characterId: null, speaker: "GUARD", text: "Read it." }],
            exit: { kind: "auto", nextNodeId: null },
          },
        ],
      },
    } as StoryScreenplayProposal;

    expect(storyAuthoringProposalReview(proposal)).toMatchObject({
      logline: "A sealed order changes the city.",
      metrics: { scenes: 1, endings: 1 },
      scenes: [
        {
          nodeId: "gate",
          description: "EXT. CITY GATE – NIGHT\n\nThe guard opens the order under the rain.",
        },
      ],
    });
    proposal.screenplay.sourceMode = "preserved";
    proposal.screenplay.scenes[0]!.action = "  原文台词。\n第二段。  ";
    proposal.screenplay.unresolvedNodeIds = ["gate"];
    proposal.screenplay.reviewNotes = ["尚未实现：信任值条件"];
    expect(storyAuthoringProposalReview(proposal)).toMatchObject({
      metrics: { scenes: 1, endings: 0 },
      scenes: [{ description: "  原文台词。\n第二段。  " }],
      productionNotes: ["尚未实现：信任值条件"],
    });
  });
});
