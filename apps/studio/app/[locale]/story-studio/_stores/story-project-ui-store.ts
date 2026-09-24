import { create } from "zustand";
import { devtools } from "zustand/middleware";
import {
  CLOSED_STORY_CANVAS_INSPECTOR,
  type StoryCanvasInspectorTarget,
} from "../_components/project-canvas/story-canvas-inspector-target";
import type { StoryBibleWriterPatch } from "@/lib/story-projects-api";
import type { SavedDraftSnapshotRunner } from "../_components/project-canvas/use-story-publication";

/**
 * The rail-toggled panel docked in the side-panel slot: the catalog
 * (chapter/scene list), the world (story bible), or the chapter manager. One
 * dock, one tenant; null is closed. Every tenant renders inside
 * StoryProjectSidePanelShell — the shell alone owns the dock's width.
 */
export type StorySidePanel = "catalog" | "world" | "stats" | "chapters" | null;

/** Live authoring-head signals the canvas publishes while mounted. */
export interface StoryLiveDraftSignals {
  revision: number;
  /** Autosave settled (no dirty/in-flight edits). */
  settled: boolean;
  /** Draft is in revision conflict — mutations must stay disabled. */
  conflicted: boolean;
  videoSnapshotHash: string | null;
}

export interface StoryComposerPrefillRequest {
  id: number;
  text: string;
}

/**
 * Story project shell UI state — cross-page switches shared by every
 * production step surface (script page, canvas once it adopts the shell).
 * Server truth stays in react-query; this store is view state only, per the
 * state convention in apps/studio/AGENTS.md.
 */
interface StoryProjectUIState {
  /**
   * Which surface the phone layout shows — chat (the full-screen agent
   * conversation, the mobile default) or the current step page. Desktop shows
   * both and ignores this.
   */
  mobileView: "chat" | "work";
  setMobileView: (view: "chat" | "work") => void;
  /**
   * One-shot page -> FizzAgent bridge. Stage surfaces may suggest a natural
   * language next action, but the Agent remains the only place that submits or
   * approves work. The monotonically increasing id lets the same prompt be
   * requested repeatedly without becoming persistent project state.
   */
  composerPrefillSequence: number;
  composerPrefillRequest: StoryComposerPrefillRequest | null;
  openAgentComposer: (text: string) => void;
  consumeComposerPrefill: (id: number) => void;
  /**
   * Which rail-toggled panel is docked in the side-panel slot, or null when
   * closed. Drives — and is highlighted by — the rail's panel buttons.
   */
  sidePanel: StorySidePanel;
  setSidePanel: (panel: StorySidePanel) => void;
  /** Chapter the canvas is editing — context hint for the agent panel. */
  activeChapterId: string | null;
  setActiveChapterId: (chapterId: string | null) => void;
  /**
   * Canvas node inspector — the floating editor for the selected scene, or
   * closed. Reconciled from ReactFlow selection. The world (story bible) panel
   * is a docked side panel now (see `sidePanel`), no longer an inspector kind.
   */
  inspectorTarget: StoryCanvasInspectorTarget;
  setInspectorTarget: (
    next:
      | StoryCanvasInspectorTarget
      | ((current: StoryCanvasInspectorTarget) => StoryCanvasInspectorTarget)
  ) => void;
  /** Share dialog (mounted by the project layout) open. */
  shareOpen: boolean;
  setShareOpen: (open: boolean) => void;
  /**
   * Canvas → header-actions bridge. While the canvas is mounted it publishes
   * its live draft head and registers its save barrier so the layout header's
   * preview/publish keep exact canvas semantics; on other steps both are null
   * and the server projection is the truth.
   */
  liveDraft: StoryLiveDraftSignals | null;
  setLiveDraft: (signals: StoryLiveDraftSignals | null) => void;
  draftBarrier: SavedDraftSnapshotRunner | null;
  setDraftBarrier: (barrier: SavedDraftSnapshotRunner | null) => void;
  /**
   * Story-bible writer the canvas registers while mounted. The overview dock
   * routes bible edits through it so the mounted canvas stays the draft's
   * only writer; when null (any other step), the dock saves the draft itself.
   */
  foundationWriter: ((patch: StoryBibleWriterPatch) => void) | null;
  setFoundationWriter: (writer: ((patch: StoryBibleWriterPatch) => void) | null) => void;
}

export const useStoryProjectUiStore = create<StoryProjectUIState>()(
  devtools(
    (set) => ({
      mobileView: "chat",
      setMobileView: (view) => set({ mobileView: view }, false, "setMobileView"),
      composerPrefillSequence: 0,
      composerPrefillRequest: null,
      openAgentComposer: (text) =>
        set(
          (state) => {
            const id = state.composerPrefillSequence + 1;
            return {
              mobileView: "chat",
              composerPrefillSequence: id,
              composerPrefillRequest: { id, text },
            };
          },
          false,
          "openAgentComposer"
        ),
      consumeComposerPrefill: (id) =>
        set(
          (state) =>
            state.composerPrefillRequest?.id === id ? { composerPrefillRequest: null } : state,
          false,
          "consumeComposerPrefill"
        ),
      sidePanel: null,
      setSidePanel: (panel) => set({ sidePanel: panel }, false, "setSidePanel"),
      activeChapterId: null,
      setActiveChapterId: (chapterId) =>
        set({ activeChapterId: chapterId }, false, "setActiveChapterId"),
      inspectorTarget: CLOSED_STORY_CANVAS_INSPECTOR,
      setInspectorTarget: (next) =>
        set(
          (state) => ({
            inspectorTarget: typeof next === "function" ? next(state.inspectorTarget) : next,
          }),
          false,
          "setInspectorTarget"
        ),
      shareOpen: false,
      setShareOpen: (open) => set({ shareOpen: open }, false, "setShareOpen"),
      liveDraft: null,
      setLiveDraft: (signals) => set({ liveDraft: signals }, false, "setLiveDraft"),
      draftBarrier: null,
      setDraftBarrier: (barrier) => set({ draftBarrier: barrier }, false, "setDraftBarrier"),
      foundationWriter: null,
      setFoundationWriter: (writer) =>
        set({ foundationWriter: writer }, false, "setFoundationWriter"),
    }),
    { name: "story-project-ui" }
  )
);
