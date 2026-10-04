import { describe, expect, it } from "vitest";
import { ApiRequestError } from "@/lib/api";
import { isStoryPublicationPending, storyPublicationIssues } from "./use-story-publication";

describe("story publication state", () => {
  it("marks only active save, prepare, and submit phases pending", () => {
    expect(isStoryPublicationPending({ status: "saving" })).toBe(true);
    expect(isStoryPublicationPending({ status: "preparing" })).toBe(true);
    expect(isStoryPublicationPending({ status: "submitting" })).toBe(true);
    expect(isStoryPublicationPending({ status: "closed" })).toBe(false);
  });

  it("keeps the failing chapter context when build diagnostics refer to another chapter", () => {
    const error = new ApiRequestError(
      "STORY_BUILD_NOT_PUBLISHABLE",
      "Missing video",
      422,
      JSON.stringify({
        chapterId: "chapter-two",
        chapterTitle: "Chapter Two",
        diagnostics: [{ message: "Missing video", nodeId: "clip:scene-two" }],
      })
    );
    expect(storyPublicationIssues(error)).toEqual([
      {
        message: "Missing video",
        nodeId: "clip:scene-two",
        chapterId: "chapter-two",
        chapterTitle: "Chapter Two",
      },
    ]);
  });

  it("uses each diagnostic's chapter when a response includes multiple chapters", () => {
    const error = new ApiRequestError(
      "STORY_BUILD_NOT_PUBLISHABLE",
      "Invalid nodes",
      422,
      JSON.stringify({
        chapterId: "chapter-two",
        diagnostics: [
          {
            message: "First issue",
            nodeId: "clip:a",
            chapterId: "chapter-one",
            chapterTitle: "Chapter One",
          },
          { message: "Second issue", nodeId: "clip:b", chapterId: "chapter-two" },
        ],
      })
    );
    expect(storyPublicationIssues(error).map((issue) => issue.chapterId)).toEqual([
      "chapter-one",
      "chapter-two",
    ]);
  });
});
