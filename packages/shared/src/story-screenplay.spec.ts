import { describe, expect, it } from "vitest";
import {
  STORY_AGENT_TARGET_DRAFT_SCHEMA_VERSION,
  STORY_SCREENPLAY_PROPOSAL_SCHEMA_VERSION,
  STORY_SCREENPLAY_SCHEMA_VERSION,
  StoryScreenplayProposalSchema,
  buildStoryScreenplayDocument,
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
});
