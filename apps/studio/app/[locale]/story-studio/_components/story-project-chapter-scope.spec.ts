import { describe, expect, it } from "vitest";
import { resolveStoryChapterId } from "./story-project-chapter-scope-state";

const chapters = new Set(["chapter-1", "chapter-2"]);

describe("resolveStoryChapterId", () => {
  it("keeps a valid chapter from the URL as the project-shell authority", () => {
    expect(
      resolveStoryChapterId({
        requestedChapterId: "chapter-2",
        activeChapterId: "chapter-1",
        chapterIds: chapters,
        fallbackChapterId: "chapter-1",
      })
    ).toBe("chapter-2");
  });

  it("falls back without allowing a stale chapter from another project", () => {
    expect(
      resolveStoryChapterId({
        requestedChapterId: "foreign-chapter",
        activeChapterId: "stale-chapter",
        chapterIds: chapters,
        fallbackChapterId: "chapter-1",
      })
    ).toBe("chapter-1");
  });

  it("fails closed when the project has no valid active chapter", () => {
    expect(
      resolveStoryChapterId({
        requestedChapterId: null,
        activeChapterId: null,
        chapterIds: new Set(),
        fallbackChapterId: null,
      })
    ).toBeNull();
  });
});
