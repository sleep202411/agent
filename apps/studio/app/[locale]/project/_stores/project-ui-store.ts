import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { AddNodeAction } from "@/components/canvas/add-node-menu";

/**
 * Project shell UI state — the "which panel is open" layer.
 *
 * Owned by Zustand (not Context) so any component can read/write without
 * Provider plumbing. Mutual exclusion lives in the actions themselves:
 *   opening any library clears the active shot drawer and sibling panels
 *   selecting a shot clears both asset libraries
 * No effect-racing, no setLeftDrawer, no two components fighting.
 *
 * Data layer (catalog, canvas connection, graph, generation) stays in Context
 * — this store is UI switches and selection only.
 */
interface ProjectUIState {
  // ── Left drawer (single instance, mutually exclusive) ──────────────────
  /** Asset library panel open. */
  assetsOpen: boolean;
  /** Crew drive asset browser open. */
  crewAssetsOpen: boolean;
  actorsOpen: boolean;
  actorFocus: { nodeId: string; documentId: string } | null;
  focusActor: (nodeId: string, documentId: string) => void;
  clearActorFocus: (nodeId: string) => void;
  openActors: () => void;
  closeActors: () => void;
  /** Canvas node catalog panel open. */
  nodesOpen: boolean;
  /** Project activity feed panel open. */
  historyOpen: boolean;
  /** Project overview (metadata + cover) panel open. */
  overviewOpen: boolean;
  /** Project chapter navigator open. */
  sectionsOpen: boolean;
  /** Project skill catalog panel open. */
  skillsOpen: boolean;
  /** Catalog Skill whose detail should be shown when the panel opens. */
  selectedSkillId: string | null;
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
  /** Director-desk overlay — opened from the add-node menu, dock, or assets. */
  directorDeskOpen: boolean;

  // ── Actions ────────────────────────────────────────────────────────────
  /** Open asset library; closes any open shot drawer (mutually exclusive). */
  openAssets: () => void;
  closeAssets: () => void;
  openCrewAssets: () => void;
  closeCrewAssets: () => void;
  openNodes: () => void;
  closeNodes: () => void;
  requestNodeInsert: (action: AddNodeAction) => void;
  clearNodeInsertRequest: (id: number) => void;
  openDirectorDesk: () => void;
  closeDirectorDesk: () => void;
  toggleOverview: () => void;
  closeOverview: () => void;
  toggleSections: () => void;
  closeSections: () => void;
  openSkills: (skillId?: string) => void;
  selectSkill: (skillId: string | null) => void;
  toggleSkills: () => void;
  closeSkills: () => void;
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
      actorFocus: null,
      focusActor: (nodeId, documentId) => set({ actorFocus: { nodeId, documentId } }),
      clearActorFocus: (nodeId) =>
        set((s) => (s.actorFocus?.nodeId === nodeId ? { actorFocus: null } : {})),
      assetsOpen: false,
      crewAssetsOpen: false,
      actorsOpen: false,
      nodesOpen: false,
      sectionsOpen: false,
      skillsOpen: false,
      overviewOpen: false,
      selectedSkillId: null,
      selectedShotId: null,
      selectedSlot: "image",
      copilotOpen: false,
      historyOpen: false,
      nodeInsertRequest: null,
      nodeInsertSerial: 0,
      directorDeskOpen: false,

      openActors: () =>
        set({
          actorsOpen: true,
          overviewOpen: false,
          assetsOpen: false,
          crewAssetsOpen: false,
          nodesOpen: false,
          historyOpen: false,
          sectionsOpen: false,
          skillsOpen: false,
          selectedSkillId: null,
          selectedShotId: null,
        }),
      closeActors: () => set({ actorsOpen: false }),
      openAssets: () =>
        set({
          assetsOpen: true,
          crewAssetsOpen: false,
          actorsOpen: false,
          nodesOpen: false,
          historyOpen: false,
          overviewOpen: false,
          sectionsOpen: false,
          skillsOpen: false,
          selectedSkillId: null,
          selectedShotId: null,
        }),
      closeAssets: () => set({ assetsOpen: false }),
      openCrewAssets: () =>
        set({
          crewAssetsOpen: true,
          actorsOpen: false,
          assetsOpen: false,
          nodesOpen: false,
          historyOpen: false,
          overviewOpen: false,
          sectionsOpen: false,
          skillsOpen: false,
          selectedSkillId: null,
          selectedShotId: null,
        }),
      closeCrewAssets: () => set({ crewAssetsOpen: false }),
      openNodes: () =>
        set({
          nodesOpen: true,
          assetsOpen: false,
          crewAssetsOpen: false,
          actorsOpen: false,
          historyOpen: false,
          overviewOpen: false,
          sectionsOpen: false,
          skillsOpen: false,
          selectedSkillId: null,
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
      openDirectorDesk: () =>
        set({
          directorDeskOpen: true,
          nodesOpen: false,
          assetsOpen: false,
          crewAssetsOpen: false,
          actorsOpen: false,
          historyOpen: false,
          overviewOpen: false,
          sectionsOpen: false,
          skillsOpen: false,
          selectedSkillId: null,
          selectedShotId: null,
        }),
      closeDirectorDesk: () => set({ directorDeskOpen: false }),
      toggleOverview: () =>
        set((state) => ({
          overviewOpen: !state.overviewOpen,
          actorsOpen: false,
          assetsOpen: false,
          crewAssetsOpen: false,
          nodesOpen: false,
          historyOpen: false,
          sectionsOpen: false,
          skillsOpen: false,
          selectedSkillId: null,
          selectedShotId: null,
        })),
      closeOverview: () => set({ overviewOpen: false }),
      toggleSections: () =>
        set((state) => ({
          sectionsOpen: !state.sectionsOpen,
          assetsOpen: false,
          crewAssetsOpen: false,
          actorsOpen: false,
          nodesOpen: false,
          historyOpen: false,
          overviewOpen: false,
          skillsOpen: false,
          selectedSkillId: null,
          selectedShotId: null,
        })),
      closeSections: () => set({ sectionsOpen: false }),
      openSkills: (skillId) =>
        set({
          skillsOpen: true,
          selectedSkillId: skillId ?? null,
          assetsOpen: false,
          crewAssetsOpen: false,
          actorsOpen: false,
          nodesOpen: false,
          historyOpen: false,
          overviewOpen: false,
          sectionsOpen: false,
          selectedShotId: null,
        }),
      toggleSkills: () =>
        set((state) => ({
          skillsOpen: !state.skillsOpen,
          selectedSkillId: null,
          assetsOpen: false,
          crewAssetsOpen: false,
          actorsOpen: false,
          nodesOpen: false,
          historyOpen: false,
          overviewOpen: false,
          sectionsOpen: false,
          selectedShotId: null,
        })),
      closeSkills: () => set({ skillsOpen: false, selectedSkillId: null }),
      selectSkill: (skillId) => set({ selectedSkillId: skillId }),
      selectShot: (id, slot) =>
        set({
          selectedShotId: id,
          selectedSlot: slot,
          assetsOpen: false,
          crewAssetsOpen: false,
          actorsOpen: false,
          nodesOpen: false,
          historyOpen: false,
          overviewOpen: false,
          sectionsOpen: false,
          skillsOpen: false,
          selectedSkillId: null,
        }),
      closeShotDrawer: () => set({ selectedShotId: null }),
      toggleCopilot: () => set((s) => ({ copilotOpen: !s.copilotOpen })),
      closeCopilot: () => set({ copilotOpen: false }),
      toggleHistory: () =>
        set((state) => ({
          historyOpen: !state.historyOpen,
          assetsOpen: false,
          crewAssetsOpen: false,
          actorsOpen: false,
          nodesOpen: false,
          overviewOpen: false,
          sectionsOpen: false,
          skillsOpen: false,
          selectedSkillId: null,
          selectedShotId: null,
        })),
      closeHistory: () => set({ historyOpen: false }),
    }),
    { name: "project-ui" }
  )
);
