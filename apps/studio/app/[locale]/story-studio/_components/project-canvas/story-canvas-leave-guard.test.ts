import { describe, expect, it, vi } from "vitest";
import {
  coordinateStoryCanvasNavigation,
  guardStoryCanvasHistoryTraversal,
  guardStoryCanvasNavigation,
  resolveStoryCanvasLeaveRisk,
} from "./story-canvas-leave-guard";

const cleanInput = {
  draftDirty: false,
  draftSaveInFlight: false,
  draftConflict: false,
  layoutDirty: false,
  layoutSaveInFlight: false,
  layoutConflict: false,
  generationRecipeDirty: false,
};

describe("Story Canvas leave guard", () => {
  it("treats every draft and layout recovery state as blocking work", () => {
    expect(resolveStoryCanvasLeaveRisk(cleanInput)).toEqual({ blocked: false, planes: [] });

    for (const field of [
      "draftDirty",
      "draftSaveInFlight",
      "draftConflict",
      "layoutDirty",
      "layoutSaveInFlight",
      "layoutConflict",
    ] as const) {
      const risk = resolveStoryCanvasLeaveRisk({ ...cleanInput, [field]: true });
      expect(risk.blocked).toBe(true);
      expect(risk.planes).toContain(field.startsWith("draft") ? "draft" : "layout");
    }
  });

  it("includes unsaved generation recipes in the same decision", () => {
    expect(resolveStoryCanvasLeaveRisk({ ...cleanInput, generationRecipeDirty: true })).toEqual({
      blocked: true,
      planes: ["generation"],
    });
  });

  it("prevents client navigation only when recovery work exists", () => {
    const preventDefault = vi.fn();
    const onBlocked = vi.fn();
    const clean = resolveStoryCanvasLeaveRisk(cleanInput);
    const dirty = resolveStoryCanvasLeaveRisk({ ...cleanInput, layoutConflict: true });

    expect(guardStoryCanvasNavigation({ preventDefault }, clean, onBlocked)).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();

    expect(guardStoryCanvasNavigation({ preventDefault }, dirty, onBlocked)).toBe(true);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onBlocked).toHaveBeenCalledWith(dirty);
  });

  it("keeps a dirty generation recipe across programmatic Preview navigation", () => {
    const navigate = vi.fn();
    const onBlocked = vi.fn();
    const dirty = resolveStoryCanvasLeaveRisk({
      ...cleanInput,
      generationRecipeDirty: true,
    });

    expect(
      coordinateStoryCanvasNavigation({
        event: null,
        risk: dirty,
        resume: navigate,
        onBlocked,
      })
    ).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
    expect(onBlocked).toHaveBeenCalledWith(dirty, navigate);

    const resume = onBlocked.mock.calls[0]?.[1] as (() => void) | undefined;
    resume?.();
    expect(navigate).toHaveBeenCalledOnce();
  });

  it("runs a clean programmatic navigation immediately", () => {
    const navigate = vi.fn();
    expect(
      coordinateStoryCanvasNavigation({
        event: null,
        risk: resolveStoryCanvasLeaveRisk(cleanInput),
        resume: navigate,
        onBlocked: vi.fn(),
      })
    ).toBe(false);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it("restores a browser history entry and resumes the exact traversal only after discard", () => {
    const stopImmediatePropagation = vi.fn();
    const pushState = vi.fn();
    const back = vi.fn();
    const onBlocked = vi.fn();
    const currentEntry = {
      href: "https://studio.example/zh-CN/story-studio/projects/project-1/canvas",
      state: { __NA: true, tree: "current" },
    };
    const dirty = resolveStoryCanvasLeaveRisk({
      ...cleanInput,
      generationRecipeDirty: true,
    });

    expect(
      guardStoryCanvasHistoryTraversal({
        event: { state: { __NA: true, tree: "destination" }, stopImmediatePropagation },
        risk: dirty,
        currentEntry,
        history: { pushState, back },
        onBlocked,
      })
    ).toBe(true);

    expect(stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(pushState).toHaveBeenCalledWith(currentEntry.state, "", currentEntry.href);
    expect(back).not.toHaveBeenCalled();

    const resume = onBlocked.mock.calls[0]?.[1] as (() => void) | undefined;
    expect(resume).toBeTypeOf("function");
    resume?.();
    expect(back).toHaveBeenCalledOnce();
  });

  it("leaves a clean browser traversal untouched", () => {
    const stopImmediatePropagation = vi.fn();
    const pushState = vi.fn();
    const onBlocked = vi.fn();

    expect(
      guardStoryCanvasHistoryTraversal({
        event: { state: null, stopImmediatePropagation },
        risk: resolveStoryCanvasLeaveRisk(cleanInput),
        currentEntry: { href: "https://studio.example/canvas", state: null },
        history: { pushState, back: vi.fn() },
        onBlocked,
      })
    ).toBe(false);
    expect(stopImmediatePropagation).not.toHaveBeenCalled();
    expect(pushState).not.toHaveBeenCalled();
    expect(onBlocked).not.toHaveBeenCalled();
  });
});
