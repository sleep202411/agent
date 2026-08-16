import { describe, expect, it } from "vitest";
import {
  buildStoryWorldCreateIdempotencyKey,
  buildStoryWorldCreateRequest,
  INITIAL_STORY_WORLD_CREATION_DRAFT,
} from "./story-world-creation";

describe("story world creation", () => {
  it("builds an adventure request with a normalized optional first frame", () => {
    expect(
      buildStoryWorldCreateRequest("fal:happy-oyster", {
        ...INITIAL_STORY_WORLD_CREATION_DRAFT,
        prompt: "  A rain-soaked late-Ming city  ",
        firstFrameUrl: "  https://media.example/world.png  ",
        perspective: "first_person",
      })
    ).toEqual({
      providerKey: "fal:happy-oyster",
      prompt: "A rain-soaked late-Ming city",
      eventStyle: "normal",
      reference: {
        firstFrameUrl: "https://media.example/world.png",
        imageUrls: [],
      },
      mode: "adventure",
      perspective: "first_person",
    });
  });

  it("always emits the exploration contract", () => {
    expect(
      buildStoryWorldCreateRequest("fal:happy-oyster", {
        ...INITIAL_STORY_WORLD_CREATION_DRAFT,
        prompt: "Explore the storm",
      })
    ).toMatchObject({ mode: "adventure", perspective: "third_person" });
  });

  it("keeps one logical node definition on one paid creation key", async () => {
    const first = buildStoryWorldCreateRequest("fal:happy-oyster", {
      ...INITIAL_STORY_WORLD_CREATION_DRAFT,
      prompt: "A rain-soaked late-Ming city",
    });
    const semanticallyEqual = {
      reference: { imageUrls: [] },
      perspective: "third_person" as const,
      prompt: "A rain-soaked late-Ming city",
      mode: "adventure" as const,
      eventStyle: "normal" as const,
      providerKey: "fal:happy-oyster" as const,
    };

    const [firstKey, equalKey] = await Promise.all([
      buildStoryWorldCreateIdempotencyKey("project-1", "world-1", first),
      buildStoryWorldCreateIdempotencyKey("project-1", "world-1", semanticallyEqual),
    ]);
    expect(equalKey).toBe(firstKey);

    const changedKey = await buildStoryWorldCreateIdempotencyKey("project-1", "world-1", {
      ...first,
      prompt: "A different world definition",
    });
    expect(changedKey).not.toBe(firstKey);
  });
});
