import { describe, expect, it } from "vitest";

import { storyGenerationBatchArtifactFromToolEvent } from "./langgraph-run-service.js";

describe("storyGenerationBatchArtifactFromToolEvent", () => {
  it("stores only the stable domain correlation for a confirmed batch", () => {
    expect(
      storyGenerationBatchArtifactFromToolEvent({
        type: "ToolCompleted",
        toolId: "story.generation.confirmBatch",
        toolCallId: "confirm-1",
        data: {
          result: {
            id: "11111111-1111-4111-8111-111111111111",
            projectId: "33333333-3333-4333-8333-333333333333",
            chapterId: "44444444-4444-4444-8444-444444444444",
            confirmedAt: "2026-08-26T12:00:00.000Z",
            status: "queued",
            counts: { ready: 3 },
            items: [{ id: "not-copied" }],
          },
        },
      })
    ).toEqual({
      artifactId: "11111111-1111-4111-8111-111111111111",
      artifact: {
        kind: "story_generation_batch",
        generationBatchId: "11111111-1111-4111-8111-111111111111",
        storyProjectId: "33333333-3333-4333-8333-333333333333",
        storyChapterId: "44444444-4444-4444-8444-444444444444",
        schemaVersion: "story-generation-batch-artifact/v1",
      },
    });
  });

  it("does not create an Artifact for a quote or an unconfirmed response", () => {
    expect(
      storyGenerationBatchArtifactFromToolEvent({
        type: "ToolCompleted",
        toolId: "story.generation.quoteAssets",
        toolCallId: "quote-1",
        data: { result: { id: "11111111-1111-4111-8111-111111111111" } },
      })
    ).toBeNull();
    expect(
      storyGenerationBatchArtifactFromToolEvent({
        type: "ToolCompleted",
        toolId: "story.generation.confirmBatch",
        toolCallId: "confirm-1",
        data: {
          result: {
            id: "11111111-1111-4111-8111-111111111111",
            projectId: "33333333-3333-4333-8333-333333333333",
            chapterId: "44444444-4444-4444-8444-444444444444",
            confirmedAt: null,
          },
        },
      })
    ).toBeNull();
  });
});
