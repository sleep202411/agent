import { describe, expect, it } from "vitest";
import {
  createStoryCanvasMutationBarrier,
  isStoryChapterProjectionPairReady,
  permitsStoryCanvasMutation,
  resolveStoryCanvasEditPolicy,
  resolveStoryCanvasProjectionSurface,
  resolveStoryProjectionReadiness,
  storyProjectionQueryKey,
  type StoryCanvasBasePermissions,
} from "./story-canvas-edit-policy";

const FULL_ACCESS: StoryCanvasBasePermissions = {
  canEditContent: true,
  canEditLayout: true,
  canManageProduction: true,
  canPreview: true,
  canPublish: true,
};

describe("Story Canvas edit policy", () => {
  it("allows authoring from project capabilities when both projections are ready", () => {
    expect(
      resolveStoryCanvasEditPolicy({
        basePermissions: FULL_ACCESS,
        projectionReadiness: "ready",
        hasDraftConflict: false,
        hasLayoutConflict: false,
      })
    ).toEqual({
      ...FULL_ACCESS,
      readOnlyReason: null,
    });
  });

  it.each([
    ["loading", "projection-loading"],
    ["unavailable", "projection-unavailable"],
  ] as const)(
    "keeps mutations closed while canonical projections are %s",
    (projectionReadiness, readOnlyReason) => {
      expect(
        resolveStoryCanvasEditPolicy({
          basePermissions: FULL_ACCESS,
          projectionReadiness,
          hasDraftConflict: false,
          hasLayoutConflict: false,
        })
      ).toEqual({
        canEditContent: false,
        canEditLayout: false,
        canManageProduction: false,
        canPreview: true,
        canPublish: false,
        readOnlyReason,
      });
    }
  );

  it("keeps layout conflicts isolated from content, production, and publishing", () => {
    expect(
      resolveStoryCanvasEditPolicy({
        basePermissions: FULL_ACCESS,
        projectionReadiness: "ready",
        hasDraftConflict: false,
        hasLayoutConflict: true,
      })
    ).toEqual({
      canEditContent: true,
      canEditLayout: false,
      canManageProduction: true,
      canPreview: true,
      canPublish: true,
      readOnlyReason: "layout-conflict",
    });
  });

  it("blocks draft-dependent writes during a draft revision conflict", () => {
    expect(
      resolveStoryCanvasEditPolicy({
        basePermissions: FULL_ACCESS,
        projectionReadiness: "ready",
        hasDraftConflict: true,
        hasLayoutConflict: false,
      })
    ).toEqual({
      canEditContent: false,
      canEditLayout: false,
      canManageProduction: false,
      canPreview: true,
      canPublish: false,
      readOnlyReason: "draft-conflict",
    });
  });

  it("never broadens the member's project capabilities", () => {
    expect(
      resolveStoryCanvasEditPolicy({
        basePermissions: {
          canEditContent: false,
          canEditLayout: false,
          canManageProduction: false,
          canPreview: true,
          canPublish: false,
        },
        projectionReadiness: "ready",
        hasDraftConflict: false,
        hasLayoutConflict: false,
      })
    ).toEqual({
      canEditContent: false,
      canEditLayout: false,
      canManageProduction: false,
      canPreview: true,
      canPublish: false,
      readOnlyReason: "permission",
    });
  });
});

describe("Story Canvas final mutation barrier", () => {
  it("reads the latest policy snapshot from callbacks created before a render", () => {
    const barrier = createStoryCanvasMutationBarrier({
      canEditContent: true,
      canEditLayout: true,
      canManageProduction: true,
    });
    const staleDragStop = () => barrier.permits("layout");

    expect(staleDragStop()).toBe(true);
    barrier.update({
      canEditContent: false,
      canEditLayout: false,
      canManageProduction: false,
    });
    expect(staleDragStop()).toBe(false);
  });

  it("keeps the three mutation scopes independent", () => {
    const state = {
      canEditContent: true,
      canEditLayout: false,
      canManageProduction: true,
    };

    expect(permitsStoryCanvasMutation(state, "content")).toBe(true);
    expect(permitsStoryCanvasMutation(state, "layout")).toBe(false);
    expect(permitsStoryCanvasMutation(state, "production")).toBe(true);
  });
});

describe("Story projection readiness", () => {
  const fresh = {
    workbenchFetchedAfterMount: true,
    workbenchError: false,
    layoutFetchedAfterMount: true,
    layoutError: false,
  };

  it("does not authorize old cache entries on a fresh mount", () => {
    expect(resolveStoryProjectionReadiness({ ...fresh, workbenchFetchedAfterMount: false })).toBe(
      "loading"
    );
    expect(resolveStoryProjectionReadiness({ ...fresh, layoutFetchedAfterMount: false })).toBe(
      "loading"
    );
    expect(resolveStoryProjectionReadiness(fresh)).toBe("ready");
  });

  it("uses a stable project/chapter query key without an assistant head", () => {
    expect(storyProjectionQueryKey("workbench", "project-1", "chapter-1")).toEqual([
      "story-studio",
      "workbench",
      "project-1",
      "chapter",
      "chapter-1",
      null,
    ]);
  });

  it("accepts only a fresh workbench and layout pair for the requested chapter", () => {
    const matching = {
      targetChapterId: "chapter-2",
      workbenchChapterId: "chapter-2",
      layoutChapterId: "chapter-2",
      workbenchPlaceholder: false,
      layoutPlaceholder: false,
    };

    expect(isStoryChapterProjectionPairReady(matching)).toBe(true);
    expect(
      isStoryChapterProjectionPairReady({ ...matching, workbenchChapterId: "chapter-1" })
    ).toBe(false);
    expect(isStoryChapterProjectionPairReady({ ...matching, layoutChapterId: "chapter-1" })).toBe(
      false
    );
    expect(isStoryChapterProjectionPairReady({ ...matching, workbenchPlaceholder: true })).toBe(
      false
    );
    expect(isStoryChapterProjectionPairReady({ ...matching, layoutPlaceholder: true })).toBe(false);
  });

  it("fails closed when a canonical projection read fails", () => {
    expect(resolveStoryProjectionReadiness({ ...fresh, workbenchError: true })).toBe("unavailable");
    expect(resolveStoryProjectionReadiness({ ...fresh, layoutError: true })).toBe("unavailable");
  });
});

describe("Story canvas projection surface", () => {
  it("shows a full-screen loading state only on a cold load", () => {
    expect(resolveStoryCanvasProjectionSurface("loading", false)).toBe("loading");
    expect(resolveStoryCanvasProjectionSurface("loading", true)).toBe("canvas");
  });

  it("keeps a retained canvas mounted through transitions and failed refreshes", () => {
    expect(resolveStoryCanvasProjectionSurface("loading", true)).toBe("canvas");
    expect(resolveStoryCanvasProjectionSurface("unavailable", true)).toBe("canvas");
    expect(resolveStoryCanvasProjectionSurface("ready", true)).toBe("canvas");
  });

  it("shows an error only for a cold failure with nothing to render", () => {
    expect(resolveStoryCanvasProjectionSurface("unavailable", false)).toBe("error");
  });
});
