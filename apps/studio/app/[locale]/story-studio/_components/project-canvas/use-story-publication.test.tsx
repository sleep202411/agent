import { describe, expect, it } from "vitest";
import { isStoryPublicationPending } from "./use-story-publication";

describe("story publication state", () => {
  it("marks only active save, build, and publish phases pending", () => {
    expect(isStoryPublicationPending({ status: "saving" })).toBe(true);
    expect(isStoryPublicationPending({ status: "building" })).toBe(true);
    expect(isStoryPublicationPending({ status: "publishing" })).toBe(true);
    expect(isStoryPublicationPending({ status: "closed" })).toBe(false);
  });
});
