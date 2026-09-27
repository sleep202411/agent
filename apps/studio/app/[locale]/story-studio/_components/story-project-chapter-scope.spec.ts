import { describe, expect, it } from "vitest";
import { nextChapterUrlSync, resolveStoryChapterId } from "./story-project-chapter-scope-state";

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

  it("writes each chapter URL once and still follows the next chapter", () => {
    const first = nextChapterUrlSync({
      pendingHref: null,
      pathname: "/story-studio/projects/project/canvas",
      search: "focus=node-1",
      requestedChapterId: null,
      resolvedChapterId: "chapter-1",
    });
    expect(first.replaceHref).toBe(
      "/story-studio/projects/project/canvas?focus=node-1&chapter=chapter-1"
    );

    const repeat = nextChapterUrlSync({
      pendingHref: first.pendingHref,
      pathname: "/story-studio/projects/project/canvas",
      search: "focus=node-1",
      requestedChapterId: null,
      resolvedChapterId: "chapter-1",
    });
    expect(repeat.replaceHref).toBeNull();

    const whileLoading = nextChapterUrlSync({
      pendingHref: first.pendingHref,
      pathname: "/story-studio/projects/project/canvas",
      search: "focus=node-1",
      requestedChapterId: null,
      resolvedChapterId: null,
    });
    expect(whileLoading).toEqual({ pendingHref: first.pendingHref, replaceHref: null });

    const caughtUp = nextChapterUrlSync({
      pendingHref: whileLoading.pendingHref,
      pathname: "/story-studio/projects/project/canvas",
      search: "focus=node-1&chapter=chapter-1",
      requestedChapterId: "chapter-1",
      resolvedChapterId: "chapter-1",
    });
    expect(caughtUp).toEqual({ pendingHref: null, replaceHref: null });

    const nextChapter = nextChapterUrlSync({
      pendingHref: caughtUp.pendingHref,
      pathname: "/story-studio/projects/project/canvas",
      search: "chapter=chapter-1",
      requestedChapterId: "chapter-1",
      resolvedChapterId: "chapter-2",
    });
    expect(nextChapter.replaceHref).toBe("/story-studio/projects/project/canvas?chapter=chapter-2");
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
