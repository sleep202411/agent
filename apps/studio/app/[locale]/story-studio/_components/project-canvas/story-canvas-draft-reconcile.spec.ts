import { describe, expect, it, vi } from "vitest";

import { shouldAdoptAuthoritativeStoryDraft } from "./story-canvas-draft-reconcile";

describe("shouldAdoptAuthoritativeStoryDraft", () => {
  const clean = {
    hydrated: true,
    chapterChanged: false,
    authoritativeRevision: 50,
    currentRevision: 49,
    hasConflict: false,
    hasLocalChanges: () => false,
  };

  it("adopts a newer canonical revision when nothing local is at stake", () => {
    expect(shouldAdoptAuthoritativeStoryDraft(clean)).toBe(true);
  });

  it("never adopts over unsaved local edits or a latched conflict", () => {
    expect(shouldAdoptAuthoritativeStoryDraft({ ...clean, hasLocalChanges: () => true })).toBe(
      false
    );
    expect(shouldAdoptAuthoritativeStoryDraft({ ...clean, hasConflict: true })).toBe(false);
  });

  it("ignores a revision that is not ahead of the one already held", () => {
    expect(shouldAdoptAuthoritativeStoryDraft({ ...clean, authoritativeRevision: 49 })).toBe(false);
    expect(shouldAdoptAuthoritativeStoryDraft({ ...clean, authoritativeRevision: 48 })).toBe(false);
  });

  it("always takes the canonical draft on a cold start or a chapter switch", () => {
    const stale = { ...clean, authoritativeRevision: 0, hasLocalChanges: () => true };
    expect(shouldAdoptAuthoritativeStoryDraft({ ...stale, hydrated: false })).toBe(true);
    expect(shouldAdoptAuthoritativeStoryDraft({ ...stale, chapterChanged: true })).toBe(true);
  });

  it("does not sign the local draft unless the canonical revision advanced", () => {
    const hasLocalChanges = vi.fn(() => true);
    shouldAdoptAuthoritativeStoryDraft({ ...clean, authoritativeRevision: 49, hasLocalChanges });
    expect(hasLocalChanges).not.toHaveBeenCalled();
  });
});
