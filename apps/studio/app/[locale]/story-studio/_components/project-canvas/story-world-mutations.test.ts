import { describe, expect, it } from "vitest";
import type { InteractiveStoryDraftContent, StoryGraphNode } from "@/lib/story-projects-api";
import {
  createStoryCharacter,
  deleteStoryCharacter,
  StoryWorldMutationError,
  type StoryWorldMutationErrorCode,
  updateStoryCharacter,
} from "./story-world-mutations";

describe("story world mutations", () => {
  it("creates immutable character records with deterministic stable identifiers", () => {
    const original = draft({
      storyBible: {
        characters: [character("character:2")],
      },
    });

    const result = createStoryCharacter(original, { locale: " zh-CN " });

    expect(result.created).toEqual({
      id: "character:2-2",
      name: { "zh-CN": "" },
      summary: "",
      images: [],
      voice: null,
    });
    expect(result.content.storyBible.characters).toHaveLength(2);
    expect(original.storyBible.characters).toEqual([character("character:2")]);
  });

  it("rejects duplicate, empty, malformed, and over-capacity character creation", () => {
    const content = draft({ storyBible: { characters: [character("hero")] } });

    expectMutationCode(
      () => createStoryCharacter(content, { locale: "en-US", id: "hero" }),
      "DUPLICATE_CHARACTER_ID"
    );
    expectMutationCode(
      () => createStoryCharacter(content, { locale: "en-US", id: "" }),
      "INVALID_STABLE_ID"
    );
    expectMutationCode(() => createStoryCharacter(content, { locale: "x" }), "INVALID_LOCALE");
    expectMutationCode(
      () =>
        createStoryCharacter(
          draft({
            storyBible: {
              characters: Array.from({ length: 100 }, (_, index) =>
                character(`character:${index + 1}`)
              ),
            },
          }),
          { locale: "en-US" }
        ),
      "CHARACTER_LIMIT_REACHED"
    );
  });

  it("updates only mutable character fields without mutating the source", () => {
    const original = draft({ storyBible: { characters: [character("hero"), character("guide")] } });
    const next = updateStoryCharacter(original, "hero", {
      name: { "en-US": "Mira", "zh-CN": "米拉" },
      summary: "Seeks the truth.",
      images: [
        { mediaAssetId: "asset-1", url: "https://media.example/hero-front.png", label: "Front" },
      ],
      voice: {
        mediaAssetId: "asset-2",
        url: "https://media.example/hero-voice.mp3",
        durationMs: 4200,
      },
    });

    expect(next.storyBible.characters[0]).toEqual({
      id: "hero",
      name: { "en-US": "Mira", "zh-CN": "米拉" },
      summary: "Seeks the truth.",
      images: [
        { mediaAssetId: "asset-1", url: "https://media.example/hero-front.png", label: "Front" },
      ],
      voice: {
        mediaAssetId: "asset-2",
        url: "https://media.example/hero-voice.mp3",
        durationMs: 4200,
      },
    });
    expect(next.storyBible.characters[1]).toBe(original.storyBible.characters[1]);
    expect(original.storyBible.characters[0]).toEqual(character("hero"));
    expect(updateStoryCharacter(next, "hero", {})).toBe(next);
    expectMutationCode(() => updateStoryCharacter(next, "missing", {}), "CHARACTER_NOT_FOUND");
  });

  it("validates every character patch branch and ignores out-of-contract identity fields", () => {
    const content = draft({ storyBible: { characters: [character("hero")] } });

    expectMutationCode(
      () =>
        updateStoryCharacter(content, "hero", {
          images: [{ mediaAssetId: "asset-1", url: "https://media.example/x.png", label: "   " }],
        }),
      "INVALID_CHARACTER"
    );
    expectMutationCode(
      () => updateStoryCharacter(content, "hero", { summary: "s".repeat(4_001) }),
      "INVALID_CHARACTER"
    );
    expectMutationCode(
      () => updateStoryCharacter(content, "hero", { name: { "en-US": "n".repeat(4_001) } }),
      "INVALID_CHARACTER"
    );
    expectMutationCode(
      () =>
        updateStoryCharacter(content, "hero", {
          images: [{ mediaAssetId: "   ", url: "https://media.example/x.png", label: "Look" }],
        }),
      "INVALID_CHARACTER"
    );
    expectMutationCode(
      () =>
        updateStoryCharacter(content, "hero", {
          images: Array.from({ length: 7 }, (_, index) => ({
            mediaAssetId: `asset-${index}`,
            url: `https://media.example/${index}.png`,
            label: `Look ${index}`,
          })),
        }),
      "INVALID_CHARACTER"
    );
    expectMutationCode(
      () =>
        updateStoryCharacter(content, "hero", {
          voice: { mediaAssetId: "asset-9", url: "https://media.example/v.mp3", durationMs: 5_001 },
        }),
      "INVALID_CHARACTER"
    );

    const next = updateStoryCharacter(content, "hero", {
      id: "intruder",
      role: "Lead",
    } as never);
    expect(next.storyBible.characters[0]?.id).toBe("hero");
  });

  it("always deletes a character in a pure branching tree", () => {
    const content = draft({
      storyBible: { characters: [character("hero"), character("guide")] },
      nodes: [
        {
          kind: "clip",
          nodeId: "decision",
          clipKey: "DECISION",
          exit: {
            kind: "choice",
            decisionId: "choose",
            prompt: { "en-US": "Choose" },
            choices: [
              {
                choiceId: "advance",
                label: { "en-US": "Advance" },
                nextNodeId: "decision",
              },
            ],
          },
        },
      ],
    });

    const next = deleteStoryCharacter(content, "hero");
    expect(next.storyBible.characters.map(({ id }) => id)).toEqual(["guide"]);
    expect(content.storyBible.characters.map(({ id }) => id)).toEqual(["hero", "guide"]);
    expectMutationCode(() => deleteStoryCharacter(content, "missing"), "CHARACTER_NOT_FOUND");
  });

  it("fails loudly instead of deleting multiple characters with a duplicate target ID", () => {
    const content = draft({
      storyBible: { characters: [character("hero"), character("hero")] },
    });

    expectMutationCode(() => deleteStoryCharacter(content, "hero"), "DUPLICATE_CHARACTER_ID");
    expect(content.storyBible.characters).toHaveLength(2);
  });
});

interface DraftOverrides {
  storyBible?: Partial<InteractiveStoryDraftContent["storyBible"]>;
  nodes?: StoryGraphNode[];
}

function draft(overrides: DraftOverrides = {}): InteractiveStoryDraftContent {
  return {
    storyBible: {
      logline: "",
      synopsis: "",
      worldview: "",
      characters: [],
      endings: [],
      ...overrides.storyBible,
    },
    graph: { entryNodeId: null, nodes: overrides.nodes ?? [] },
    productionNotes: [],
  };
}

function character(id: string): InteractiveStoryDraftContent["storyBible"]["characters"][number] {
  return {
    id,
    name: { "en-US": "" },
    summary: "",
    images: [],
    voice: null,
  };
}

function expectMutationCode(action: () => unknown, code: StoryWorldMutationErrorCode): void {
  try {
    action();
    throw new Error(`Expected mutation ${code} to fail.`);
  } catch (error) {
    expect(error).toBeInstanceOf(StoryWorldMutationError);
    expect(error).toMatchObject({ code });
  }
}
