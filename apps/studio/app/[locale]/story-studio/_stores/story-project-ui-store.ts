import { create } from "zustand";
import { devtools } from "zustand/middleware";

/**
 * Story project shell UI state — cross-page switches shared by every
 * production step surface (script page, canvas once it adopts the shell).
 * Server truth stays in react-query; this store is view state only, per the
 * state convention in apps/studio/AGENTS.md.
 */
interface StoryProjectUIState {
  /** Agent OS side panel open. */
  agentOpen: boolean;
  toggleAgent: () => void;
  closeAgent: () => void;
  /** Chapter the canvas is editing — context hint for the agent panel. */
  activeChapterId: string | null;
  setActiveChapterId: (chapterId: string | null) => void;
}

export const useStoryProjectUiStore = create<StoryProjectUIState>()(
  devtools(
    (set) => ({
      agentOpen: false,
      toggleAgent: () => set((state) => ({ agentOpen: !state.agentOpen }), false, "toggleAgent"),
      closeAgent: () => set({ agentOpen: false }, false, "closeAgent"),
      activeChapterId: null,
      setActiveChapterId: (chapterId) =>
        set({ activeChapterId: chapterId }, false, "setActiveChapterId"),
    }),
    { name: "story-project-ui" }
  )
);
