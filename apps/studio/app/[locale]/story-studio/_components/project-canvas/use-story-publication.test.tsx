import { describe, expect, it } from "vitest";
import { isStoryPublicationPending } from "./use-story-publication";

describe("story publication state", () => {
  it("marks only active save, prepare, and submit phases pending", () => {
    expect(isStoryPublicationPending({ status: "saving" })).toBe(true);
    expect(isStoryPublicationPending({ status: "preparing" })).toBe(true);
    expect(isStoryPublicationPending({ status: "submitting" })).toBe(true);
    expect(isStoryPublicationPending({ status: "closed" })).toBe(false);
  });
});
