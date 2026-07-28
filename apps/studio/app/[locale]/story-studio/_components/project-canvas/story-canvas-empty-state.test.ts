import { describe, expect, it } from "vitest";
import type { StoryChapter } from "@/lib/story-projects-api";
import { isStoryCanvasProjectBootstrap } from "./story-canvas-empty-state";

describe("isStoryCanvasProjectBootstrap", () => {
  it("uses project onboarding only for the first chapter of a scene-less project", () => {
    const chapters = [chapter("chapter-1", "Chapter 1", 0, 0)];

    expect(isStoryCanvasProjectBootstrap(chapters, "chapter-1")).toBe(true);
  });

  it("does not cover a later empty chapter with project onboarding", () => {
    const chapters = [
      chapter("chapter-1", "Chapter 1", 0, 0),
      chapter("chapter-2", "Chapter 2", 1, 0),
    ];

    expect(isStoryCanvasProjectBootstrap(chapters, "chapter-2")).toBe(false);
  });

  it("leaves an empty chapter blank after story creation has begun", () => {
    const chapters = [
      chapter("chapter-1", "Chapter 1", 0, 4),
      chapter("chapter-2", "Chapter 2", 1, 0),
    ];

    expect(isStoryCanvasProjectBootstrap(chapters, "chapter-2")).toBe(false);
  });

  it("returns no empty state when the current chapter owns a scene", () => {
    const chapters = [chapter("chapter-1", "Chapter 1", 0, 1)];

    expect(isStoryCanvasProjectBootstrap(chapters, "chapter-1")).toBe(false);
  });
});

function chapter(id: string, title: string, rank: number, nodeCount: number): StoryChapter {
  return {
    id,
    projectId: "project-1",
    title,
    rank,
    entryNodeId: nodeCount > 0 ? `node-${rank}` : null,
    nodeCount,
    createdByUserId: "user-1",
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:00.000Z",
  };
}
