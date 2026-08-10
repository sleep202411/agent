import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { AddNodeAction } from "@/components/canvas/add-node-menu";

/**
 * Project shell UI state — the "which panel is open" layer.
 *
 * Owned by Zustand (not Context) so any component can read/write without
 * Provider plumbing. Mutual exclusion lives in the actions themselves:
 *   openAssets() clears selectedShotId
 *   selectShot() clears assetsOpen
 * No effect-racing, no setLeftDrawer, no two components fighting.
 *
 * Data layer (catalog, canvas connection, graph, generation) stays in Context
 * — this store is UI switches and selection only.
 */
interface ProjectUIState {
  // ── Left drawer (single instance, mutually exclusive) ──────────────────
  /** Asset library panel open. */
  assetsOpen: boolean;
  /** Canvas node catalog panel open. */
  nodesOpen: boolean;
  /** Project activity feed panel open. */
  historyOpen: boolean;
  /** Project chapter navigator open. */
  sectionsOpen: boolean;
  /** The storyboard shot selected for the left drawer, if any. */
  selectedShotId: string | null;
  /** Which picture slot of the selected shot the drawer is editing. */
  selectedSlot: "image" | "video";

  // ── Right panel ────────────────────────────────────────────────────────
  copilotOpen: boolean;

  // ── Canvas commands ───────────────────────────────────────────────────
  /** One-shot request consumed by the active media-authoring canvas. */
  nodeInsertRequest: { id: number; action: AddNodeAction } | null;
  nodeInsertSerial: number;

  // ── Actions ────────────────────────────────────────────────────────────
  /** Open asset library; closes any open shot drawer (mutually exclusive). */
  openAssets: () => void;
  closeAssets: () => void;
  openNodes: () => void;
  closeNodes: () => void;
  requestNodeInsert: (action: AddNodeAction) => void;
  clearNodeInsertRequest: (id: number) => void;
  toggleSections: () => void;
  closeSections: () => void;
  /** Select a shot for the drawer; closes asset library (mutually exclusive). */
  selectShot: (id: string, slot: "image" | "video") => void;
  closeShotDrawer: () => void;
  toggleCopilot: () => void;
  closeCopilot: () => void;
  toggleHistory: () => void;
  closeHistory: () => void;
}

export const useProjectUIStore = create<ProjectUIState>()(
  devtools(
    (set) => ({
      assetsOpen: false,
      nodesOpen: false,
      sectionsOpen: false,
      selectedShotId: null,
      selectedSlot: "image",
      copilotOpen: false,
      historyOpen: false,
      nodeInsertRequest: null,
      nodeInsertSerial: 0,

      openAssets: () =>
        set({
          assetsOpen: true,
          nodesOpen: false,
          historyOpen: false,
          sectionsOpen: false,
          selectedShotId: null,
        }),
      closeAssets: () => set({ assetsOpen: false }),
      openNodes: () =>
        set({
          nodesOpen: true,
          assetsOpen: false,
          historyOpen: false,
          sectionsOpen: false,
          selectedShotId: null,
        }),
      closeNodes: () => set({ nodesOpen: false }),
      requestNodeInsert: (action) =>
        set((state) => {
          const id = state.nodeInsertSerial + 1;
          return {
            nodesOpen: false,
            nodeInsertSerial: id,
            nodeInsertRequest: { id, action },
          };
        }),
      clearNodeInsertRequest: (id) =>
        set((state) => (state.nodeInsertRequest?.id === id ? { nodeInsertRequest: null } : {})),
      toggleSections: () =>
        set((state) => ({
          sectionsOpen: !state.sectionsOpen,
          assetsOpen: false,
          nodesOpen: false,
          historyOpen: false,
          selectedShotId: null,
        })),
      closeSections: () => set({ sectionsOpen: false }),
      selectShot: (id, slot) =>
        set({
          selectedShotId: id,
          selectedSlot: slot,
          assetsOpen: false,
          nodesOpen: false,
          historyOpen: false,
          sectionsOpen: false,
        }),
      closeShotDrawer: () => set({ selectedShotId: null }),
      toggleCopilot: () => set((s) => ({ copilotOpen: !s.copilotOpen })),
      closeCopilot: () => set({ copilotOpen: false }),
      toggleHistory: () =>
        set((state) => ({
          historyOpen: !state.historyOpen,
          assetsOpen: false,
          nodesOpen: false,
          sectionsOpen: false,
          selectedShotId: null,
        })),
      closeHistory: () => set({ historyOpen: false }),
    }),
    { name: "project-ui" }
  )
);
