import { create } from "zustand";
import { devtools } from "zustand/middleware";
import {
  CLOSED_STORY_CANVAS_INSPECTOR,
  type StoryCanvasInspectorTarget,
} from "../_components/project-canvas/story-canvas-inspector-target";
import type { StoryCanvasNavigationEvent } from "../_components/project-canvas/story-canvas-leave-guard";
import type { SavedDraftSnapshotRunner } from "../_components/project-canvas/use-story-publication";

/**
 * The rail-toggled panel docked in the side-panel slot: the catalog
 * (chapter/scene list) or the world (story bible). One dock, one tenant; null
 * is closed.
 */
export type StorySidePanel = "catalog" | "world" | null;

/** Live authoring-head signals the canvas publishes while mounted. */
export interface StoryLiveDraftSignals {
  revision: number;
  /** Autosave settled (no dirty/in-flight edits). */
  settled: boolean;
  /** Draft is in revision conflict — mutations must stay disabled. */
  conflicted: boolean;
  videoSnapshotHash: string | null;
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
   * Which rail-toggled panel is docked in the side-panel slot (catalog or
   * world), or null when closed. Drives — and is highlighted by — the rail's
   * Catalog and World buttons.
   */
  sidePanel: StorySidePanel;
  setSidePanel: (panel: StorySidePanel) => void;
  /** Open `panel`, or close it if it is already the docked one. */
  toggleSidePanel: (panel: Exclude<StorySidePanel, null>) => void;
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
  /** Share dialog (mounted by the canvas) open. */
  shareOpen: boolean;
  setShareOpen: (open: boolean) => void;
  /**
   * Leave guard the canvas registers while mounted; the rail's Back link runs
   * it so unsaved-draft protection survives the move to the shared rail.
   */
  backGuard: ((event: StoryCanvasNavigationEvent) => void) | null;
  setBackGuard: (guard: ((event: StoryCanvasNavigationEvent) => void) | null) => void;
  /**
   * Canvas → header-actions bridge. While the canvas is mounted it publishes
   * its live draft head and registers its save barrier / guarded navigation so
   * the layout header's preview/publish keep exact canvas semantics; on other
   * steps all three are null and the server projection is the truth.
   */
  liveDraft: StoryLiveDraftSignals | null;
  setLiveDraft: (signals: StoryLiveDraftSignals | null) => void;
  draftBarrier: SavedDraftSnapshotRunner | null;
  setDraftBarrier: (barrier: SavedDraftSnapshotRunner | null) => void;
  guardedNavigate: ((proceed: () => void) => void) | null;
  setGuardedNavigate: (navigate: ((proceed: () => void) => void) | null) => void;
  /**
   * The header's context slot element (ref-registered by StoryProjectHeader);
   * the canvas portals its chapter switcher into it.
   */
  headerContextSlot: HTMLElement | null;
  setHeaderContextSlot: (element: HTMLElement | null) => void;
}

export const useStoryProjectUiStore = create<StoryProjectUIState>()(
  devtools(
    (set) => ({
      mobileView: "chat",
      setMobileView: (view) => set({ mobileView: view }, false, "setMobileView"),
      sidePanel: null,
      setSidePanel: (panel) => set({ sidePanel: panel }, false, "setSidePanel"),
      toggleSidePanel: (panel) =>
        set(
          (state) => ({ sidePanel: state.sidePanel === panel ? null : panel }),
          false,
          "toggleSidePanel"
        ),
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
      backGuard: null,
      setBackGuard: (guard) => set({ backGuard: guard }, false, "setBackGuard"),
      liveDraft: null,
      setLiveDraft: (signals) => set({ liveDraft: signals }, false, "setLiveDraft"),
      draftBarrier: null,
      setDraftBarrier: (barrier) => set({ draftBarrier: barrier }, false, "setDraftBarrier"),
      guardedNavigate: null,
      setGuardedNavigate: (navigate) =>
        set({ guardedNavigate: navigate }, false, "setGuardedNavigate"),
      headerContextSlot: null,
      setHeaderContextSlot: (element) =>
        set({ headerContextSlot: element }, false, "setHeaderContextSlot"),
    }),
    {
      name: "story-project-ui",
      // The devtools extension JSON-serializes every state snapshot. The store
      // holds a DOM node (headerContextSlot); walking it blows up on internals
      // (BigInt), so collapse nodes to their tag name for the devtools view.
      serialize: {
        replacer: (_key: string, value: unknown) =>
          typeof Node !== "undefined" && value instanceof Node
            ? `<${value.nodeName.toLowerCase()}>`
            : value,
      },
    }
  )
);
