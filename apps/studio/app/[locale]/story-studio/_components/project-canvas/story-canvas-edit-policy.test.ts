import { describe, expect, it } from "vitest";
import {
  createStoryCanvasMutationBarrier,
  isStoryChapterProjectionPairReady,
  permitsStoryCanvasMutation,
  resolveStoryAgentAuthoringPhase,
  resolveStoryCanvasEditPolicy,
  resolveStoryCanvasProjectionSurface,
  resolveStoryCanvasWriteAuthority,
  resolveStoryProjectionAuthority,
  shouldFetchStoryProjection,
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
  it("keeps a proposed Agent run fully editable", () => {
    expect(
      resolveStoryCanvasEditPolicy({
        basePermissions: FULL_ACCESS,
        hasDraftConflict: false,
        hasLayoutConflict: false,
        agentPhase: "ready",
      })
    ).toEqual({
      ...FULL_ACCESS,
      readOnlyReason: null,
    });
  });

  it("keeps ordinary authoring enabled in the ready phase", () => {
    expect(
      resolveStoryCanvasEditPolicy({
        basePermissions: FULL_ACCESS,
        hasDraftConflict: false,
        hasLayoutConflict: false,
        agentPhase: "ready",
      })
    ).toEqual({
      ...FULL_ACCESS,
      readOnlyReason: null,
    });
  });

  it.each([
    ["checking", "agent-checking"],
    ["takeover-pending", "agent-takeover-pending"],
    ["applying", "agent-applying"],
    ["reconciling", "agent-reconciling"],
    ["unavailable", "agent-unavailable"],
  ] as const)("blocks every project mutation in the %s phase", (agentPhase, readOnlyReason) => {
    expect(
      resolveStoryCanvasEditPolicy({
        basePermissions: FULL_ACCESS,
        hasDraftConflict: false,
        hasLayoutConflict: false,
        agentPhase,
      })
    ).toEqual({
      canEditContent: false,
      canEditLayout: false,
      canManageProduction: false,
      canPreview: true,
      canPublish: false,
      readOnlyReason,
    });
  });

  it("keeps layout conflicts isolated from content and production", () => {
    expect(
      resolveStoryCanvasEditPolicy({
        basePermissions: FULL_ACCESS,
        hasDraftConflict: false,
        hasLayoutConflict: true,
        agentPhase: "ready",
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

  it("blocks draft-dependent writes during a draft conflict", () => {
    expect(
      resolveStoryCanvasEditPolicy({
        basePermissions: FULL_ACCESS,
        hasDraftConflict: true,
        hasLayoutConflict: false,
        agentPhase: "ready",
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

  it("never broadens the member's base permissions", () => {
    const policy = resolveStoryCanvasEditPolicy({
      basePermissions: {
        canEditContent: false,
        canEditLayout: false,
        canManageProduction: false,
        canPreview: true,
        canPublish: false,
      },
      hasDraftConflict: false,
      hasLayoutConflict: false,
      agentPhase: "ready",
    });

    expect(policy).toEqual({
      canEditContent: false,
      canEditLayout: false,
      canManageProduction: false,
      canPreview: true,
      canPublish: false,
      readOnlyReason: "permission",
    });
  });

  it("gives the active Agent lock precedence over conflict reasons", () => {
    expect(
      resolveStoryCanvasEditPolicy({
        basePermissions: FULL_ACCESS,
        hasDraftConflict: true,
        hasLayoutConflict: true,
        agentPhase: "applying",
      }).readOnlyReason
    ).toBe("agent-applying");
  });
});

describe("Story Canvas final mutation barrier", () => {
  it("permits content and layout only from the latest editable authority snapshot", () => {
    const editable = {
      canEditContent: true,
      canEditLayout: true,
      canManageProduction: true,
      takeoverPending: false,
    };

    expect(permitsStoryCanvasMutation(editable, "content")).toBe(true);
    expect(permitsStoryCanvasMutation(editable, "layout")).toBe(true);
    expect(permitsStoryCanvasMutation(editable, "production")).toBe(true);
    expect(permitsStoryCanvasMutation({ ...editable, canEditLayout: false }, "layout")).toBe(false);
    expect(permitsStoryCanvasMutation({ ...editable, canEditContent: false }, "content")).toBe(
      false
    );
  });

  it("lets synchronous takeover ownership close every stale callback", () => {
    const staleClosureStillEditable = {
      canEditContent: true,
      canEditLayout: true,
      canManageProduction: true,
      takeoverPending: true,
    };

    expect(permitsStoryCanvasMutation(staleClosureStillEditable, "content")).toBe(false);
    expect(permitsStoryCanvasMutation(staleClosureStillEditable, "layout")).toBe(false);
    expect(permitsStoryCanvasMutation(staleClosureStillEditable, "production")).toBe(false);
  });

  it("makes callbacks created before a realtime lock observe the latest authority", () => {
    const barrier = createStoryCanvasMutationBarrier({
      canEditContent: true,
      canEditLayout: true,
      canManageProduction: true,
      takeoverPending: false,
    });
    const staleDragStop = () => barrier.permits("layout");

    expect(staleDragStop()).toBe(true);
    barrier.update({
      canEditContent: false,
      canEditLayout: false,
      canManageProduction: false,
      takeoverPending: false,
    });
    expect(staleDragStop()).toBe(false);

    barrier.update({
      canEditContent: true,
      canEditLayout: true,
      canManageProduction: true,
      takeoverPending: false,
    });
    barrier.setTakeoverPending(true);
    expect(staleDragStop()).toBe(false);
  });
});

describe("Story projection authority", () => {
  const fresh = {
    hasWorkspace: true,
    agentAuthorityState: "ready" as const,
    workbenchFetchedAfterMount: true,
    workbenchError: false,
    layoutFetchedAfterMount: true,
    layoutError: false,
  };

  it("does not authorize old workbench or layout cache entries on a fresh mount", () => {
    expect(resolveStoryProjectionAuthority({ ...fresh, workbenchFetchedAfterMount: false })).toBe(
      "checking"
    );
    expect(resolveStoryProjectionAuthority({ ...fresh, layoutFetchedAfterMount: false })).toBe(
      "checking"
    );
  });

  it("loads projections only after the active-run head and both projection reads are fresh", () => {
    expect(shouldFetchStoryProjection(true, "checking")).toBe(false);
    expect(shouldFetchStoryProjection(true, "error")).toBe(false);
    expect(shouldFetchStoryProjection(true, "ready")).toBe(true);
    expect(resolveStoryProjectionAuthority({ ...fresh, agentAuthorityState: "checking" })).toBe(
      "checking"
    );
    expect(resolveStoryProjectionAuthority(fresh)).toBe("ready");
  });

  it("isolates projection cache entries by the authority head generation", () => {
    expect(
      storyProjectionQueryKey("workbench", "workspace-1", "project-1", "chapter-1", "head-a")
    ).not.toEqual(
      storyProjectionQueryKey("workbench", "workspace-1", "project-1", "chapter-1", "head-b")
    );
    expect(
      storyProjectionQueryKey("canvas-layout", "workspace-1", "project-1", "chapter-1", null)
    ).toEqual([
      "story-studio",
      "canvas-layout",
      "workspace-1",
      "project-1",
      "chapter",
      "chapter-1",
      "authority",
      "unavailable",
    ]);
  });

  it("accepts only a fresh workbench and layout pair for the same target chapter", () => {
    const matching = {
      targetChapterId: "chapter-2",
      workbenchChapterId: "chapter-2",
      layoutChapterId: "chapter-2",
      workbenchPlaceholder: false,
      layoutPlaceholder: false,
    };

    expect(isStoryChapterProjectionPairReady(matching)).toBe(true);
    expect(
      isStoryChapterProjectionPairReady({
        ...matching,
        workbenchChapterId: "chapter-1",
      })
    ).toBe(false);
    expect(
      isStoryChapterProjectionPairReady({
        ...matching,
        layoutChapterId: "chapter-1",
      })
    ).toBe(false);
    expect(
      isStoryChapterProjectionPairReady({
        ...matching,
        workbenchPlaceholder: true,
      })
    ).toBe(false);
    expect(
      isStoryChapterProjectionPairReady({
        ...matching,
        layoutPlaceholder: true,
      })
    ).toBe(false);
  });

  it("fails closed when any fresh authority read fails", () => {
    expect(resolveStoryProjectionAuthority({ ...fresh, workbenchError: true })).toBe("unavailable");
    expect(resolveStoryProjectionAuthority({ ...fresh, layoutError: true })).toBe("unavailable");
    expect(resolveStoryProjectionAuthority({ ...fresh, agentAuthorityState: "error" })).toBe(
      "unavailable"
    );
  });
});

describe("Story canvas projection surface", () => {
  it("shows the full-screen loading state only on a true cold load", () => {
    expect(resolveStoryCanvasProjectionSurface("checking", false)).toBe("loading");
    expect(resolveStoryCanvasProjectionSurface("checking", true)).toBe("canvas");
  });

  it("keeps the canvas mounted across authority-key rotations and failed refreshes", () => {
    // A previous projection snapshot may keep RENDERING while a fresh read is
    // in flight or has failed; only writes are latched during those states.
    expect(resolveStoryCanvasProjectionSurface("checking", true)).toBe("canvas");
    expect(resolveStoryCanvasProjectionSurface("unavailable", true)).toBe("canvas");
    expect(resolveStoryCanvasProjectionSurface("ready", true)).toBe("canvas");
  });

  it("reserves the full-screen error state for a cold failure with nothing to show", () => {
    expect(resolveStoryCanvasProjectionSurface("unavailable", false)).toBe("error");
  });
});

describe("Story canvas write authority", () => {
  it("maps the combined projection authority onto the fail-closed phase input", () => {
    expect(resolveStoryCanvasWriteAuthority("ready")).toBe("ready");
    expect(resolveStoryCanvasWriteAuthority("checking")).toBe("checking");
    expect(resolveStoryCanvasWriteAuthority("unavailable")).toBe("error");
  });

  it.each([
    ["checking", "agent-checking"],
    ["unavailable", "agent-unavailable"],
  ] as const)(
    "latches every mutation while the projection authority is %s, without unmounting",
    (projectionAuthority, readOnlyReason) => {
      const policy = resolveStoryCanvasEditPolicy({
        basePermissions: {
          canEditContent: true,
          canEditLayout: true,
          canManageProduction: true,
          canPreview: true,
          canPublish: true,
        },
        hasDraftConflict: false,
        hasLayoutConflict: false,
        agentPhase: resolveStoryAgentAuthoringPhase({
          authorityState: resolveStoryCanvasWriteAuthority(projectionAuthority),
          takeoverPending: false,
          applying: false,
          runStatus: null,
          resultDraftRevision: null,
          resultLayoutRevision: null,
          draftRevision: 0,
          layoutRevision: 0,
          hasConflict: false,
        }),
      });

      expect(policy.canEditContent).toBe(false);
      expect(policy.canEditLayout).toBe(false);
      expect(policy.canManageProduction).toBe(false);
      expect(policy.canPublish).toBe(false);
      expect(policy.canPreview).toBe(true);
      expect(policy.readOnlyReason).toBe(readOnlyReason);
      // The same states keep the previously rendered snapshot mounted.
      expect(resolveStoryCanvasProjectionSurface(projectionAuthority, true)).toBe("canvas");
    }
  );
});

describe("Story Agent authoring phase", () => {
  const reconciled = {
    authorityState: "ready" as const,
    takeoverPending: false,
    applying: false,
    runStatus: "succeeded" as const,
    resultDraftRevision: 9,
    resultLayoutRevision: 6,
    draftRevision: 9,
    layoutRevision: 6,
    hasConflict: false,
  };

  it("locks synchronously while the client flushes before takeover", () => {
    expect(resolveStoryAgentAuthoringPhase({ ...reconciled, takeoverPending: true })).toBe(
      "takeover-pending"
    );
  });

  it("keeps an observed applying latch authoritative even if the canonical read fails", () => {
    expect(
      resolveStoryAgentAuthoringPhase({
        ...reconciled,
        authorityState: "error",
        applying: true,
      })
    ).toBe("applying");
  });

  it("fails closed before the first canonical run snapshot and after authority loss", () => {
    expect(resolveStoryAgentAuthoringPhase({ ...reconciled, authorityState: "checking" })).toBe(
      "checking"
    );
    expect(resolveStoryAgentAuthoringPhase({ ...reconciled, authorityState: "error" })).toBe(
      "unavailable"
    );
  });

  it.each(["authoring", "authoring_failed"] as const)(
    "keeps the canvas editable while the head run is %s (drafting holds no write fence)",
    (runStatus) => {
      expect(
        resolveStoryAgentAuthoringPhase({
          ...reconciled,
          runStatus,
          resultDraftRevision: null,
          resultLayoutRevision: null,
        })
      ).toBe("ready");
    }
  );

  it("reconciles both draft and layout projections before unlocking", () => {
    expect(resolveStoryAgentAuthoringPhase({ ...reconciled, draftRevision: 8 })).toBe(
      "reconciling"
    );
    expect(resolveStoryAgentAuthoringPhase({ ...reconciled, layoutRevision: 5 })).toBe(
      "reconciling"
    );
    expect(resolveStoryAgentAuthoringPhase(reconciled)).toBe("ready");
  });

  it("delegates a projection conflict to the conflict policy instead of waiting forever", () => {
    expect(
      resolveStoryAgentAuthoringPhase({
        ...reconciled,
        draftRevision: 8,
        hasConflict: true,
      })
    ).toBe("ready");
  });
});
