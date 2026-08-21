import { describe, expect, it } from "vitest";
import type { StoryPatchProposal } from "@repo/shared/story-agent";
import { storyAuthoringProposalReview } from "./story-authoring-proposal";

const OPERATION_ID = "00000000-0000-4000-8000-000000000001";

describe("storyAuthoringProposalReview", () => {
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
});
