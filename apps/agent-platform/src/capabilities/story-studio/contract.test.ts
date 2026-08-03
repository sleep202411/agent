import { describe, expect, it } from "vitest";

import { storyChangeSetSchema } from "./contract.js";

const BASE = {
  schemaVersion: "story-change-set/v2",
  chapterId: "0197f4a2-0800-7000-8000-000000000002",
  baseDraftRevision: 7,
  baseContentHash: "a".repeat(64),
  baseLayoutRevision: 3,
  title: "Introduce Xinyi",
  summary: "Add the arrival scene and connect the opening choice to it.",
} as const;

describe("storyChangeSetSchema", () => {
  it("models the real localized Story draft and coordinated graph operations", () => {
    const result = storyChangeSetSchema.parse({
      ...BASE,
      operations: [
        {
          kind: "story_graph.put_node",
          payload: {
            intent: "replace",
            node: {
              kind: "clip",
              nodeId: "intro_night",
              clipKey: "INTRO_NIGHT",
              name: "Night introduction",
              exit: {
                kind: "choice",
                decisionId: "intro_decision",
                prompt: { "en-US": "Follow the stranger?" },
                choices: [
                  {
                    choiceId: "follow",
                    label: { "en-US": "Follow" },
                    nextNodeId: "xinyi_arrival",
                  },
                ],
              },
            },
          },
        },
        {
          kind: "story_graph.put_node",
          payload: {
            intent: "create",
            node: {
              kind: "clip",
              nodeId: "xinyi_arrival",
              clipKey: "XINYI_ARRIVAL",
              name: "Arrival",
              description: "Xinyi steps out of the rain.",
              exit: { kind: "auto", nextNodeId: null },
            },
          },
        },
      ],
    });

    expect(result.operations).toHaveLength(2);
    expect(result.operations[0]).not.toHaveProperty("operationId");
    expect(result.operations[0]).not.toHaveProperty("summary");
  });

  it("requires both Story draft and layout compare-and-swap tokens", () => {
    expect(() =>
      storyChangeSetSchema.parse({
        ...BASE,
        baseLayoutRevision: undefined,
        operations: [
          {
            kind: "production.replace_notes",
            payload: { productionNotes: ["Use a cold palette."] },
          },
        ],
      })
    ).toThrow(/baseLayoutRevision/);
  });

  it("rejects model-authored media bindings and bookkeeping fields", () => {
    expect(() =>
      storyChangeSetSchema.parse({
        ...BASE,
        operations: [
          {
            kind: "story_graph.put_node",
            operationId: "0197f4a2-0800-7000-8000-000000000003",
            summary: "Injected bookkeeping",
            payload: {
              intent: "create",
              node: {
                kind: "clip",
                nodeId: "arrival",
                clipKey: "ARRIVAL",
                description: "Arrival.",
                music: {
                  mediaAssetId: "0197f4a2-0800-7000-8000-000000000004",
                },
                exit: { kind: "auto", nextNodeId: null },
              },
            },
          },
        ],
      })
    ).toThrow();
  });

  it("still rejects the op-vs-kind confusion the description now pre-empts", () => {
    // The schema annotations exist to make the FIRST attempt validate, but
    // they must never weaken the schema itself: an operation keyed `op`
    // remains invalid.
    expect(() =>
      storyChangeSetSchema.parse({
        ...BASE,
        operations: [
          {
            op: "story_graph.put_node",
            payload: {
              intent: "create",
              node: {
                kind: "clip",
                nodeId: "arrival",
                clipKey: "ARRIVAL",
                description: "Arrival.",
                exit: { kind: "auto", nextNodeId: null },
              },
            },
          },
        ],
      })
    ).toThrow();
  });

  it("rejects a no-op story overview command", () => {
    expect(() =>
      storyChangeSetSchema.parse({
        ...BASE,
        operations: [
          {
            kind: "story_bible.update_overview",
            payload: {},
          },
        ],
      })
    ).toThrow(/At least one overview field/);
  });
});
