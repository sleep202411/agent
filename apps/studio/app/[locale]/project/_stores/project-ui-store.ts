import { create } from "zustand";
import { devtools } from "zustand/middleware";

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
  /** The storyboard shot selected for the left drawer, if any. */
  selectedShotId: string | null;
  /** Which picture slot of the selected shot the drawer is editing. */
  selectedSlot: "image" | "video";

  // ── Right panel ────────────────────────────────────────────────────────
  copilotOpen: boolean;
  historyOpen: boolean;

  // ── Actions ────────────────────────────────────────────────────────────
  /** Open asset library; closes any open shot drawer (mutually exclusive). */
  openAssets: () => void;
  closeAssets: () => void;
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
      selectedShotId: null,
      selectedSlot: "image",
      copilotOpen: false,
      historyOpen: false,

      openAssets: () => set({ assetsOpen: true, selectedShotId: null }),
      closeAssets: () => set({ assetsOpen: false }),
      selectShot: (id, slot) =>
        set({ selectedShotId: id, selectedSlot: slot, assetsOpen: false }),
      closeShotDrawer: () => set({ selectedShotId: null }),
      toggleCopilot: () => set((s) => ({ copilotOpen: !s.copilotOpen })),
      closeCopilot: () => set({ copilotOpen: false }),
      toggleHistory: () => set((s) => ({ historyOpen: !s.historyOpen })),
      closeHistory: () => set({ historyOpen: false }),
    }),
    { name: "project-ui" },
  ),
);
