import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

// ─── Types ──────────────────────────────────────────────

export type AgentStep = 1 | 2 | 3;
export type StepStatus = "pending" | "generating" | "done";

export interface StoryOutline {
  title: string;
  genre: string;
  background: string;
  conflict: string;
  oneLiner: string;
  videoStyle: string;
  aspectRatio: string;
  episodes: Episode[];
}

export interface Episode {
  id: string;
  title: string;
  summary: string;
  script: string;
}

export interface Character {
  id: string;
  name: string;
  role: "main" | "supporting" | "extra";
  personality: string;
  appearance: string;
  imageUrl?: string;
  imageStatus: "pending" | "generating" | "done";
}

export interface Scene {
  id: string;
  name: string;
  description: string;
  imageUrl?: string;
  imageStatus: "pending" | "generating" | "done";
}

export interface Prop {
  id: string;
  name: string;
  description: string;
}

export interface Shot {
  id: string;
  shotNumber: number;
  description: string;
  dialogue: string;
  narration: string;
  cameraAngle: string;
  cameraMovement: string;
  duration: number;
  imageUrl?: string;
  imageStatus: "pending" | "generating" | "done";
  videoUrl?: string;
  videoStatus?: "pending" | "generating" | "done";
  dialogueAudioUrl?: string;
  narrationAudioUrl?: string;
  audioStatus?: "pending" | "generating" | "done";
}

export interface EpisodeStoryboard {
  episodeId: string;
  title: string;
  shots: Shot[];
  bgmUrl?: string;
  bgmStatus?: "pending" | "generating" | "done";
}

// ─── State ──────────────────────────────────────────────

interface AgentState {
  isOpen: boolean;
  taskId: string | null;
  agentId: string | null;
  prompt: string;
  currentStep: AgentStep;
  stepStatuses: Record<AgentStep, StepStatus>;

  outline: StoryOutline | null;
  characters: Character[];
  scenes: Scene[];
  props: Prop[];
  storyboards: EpisodeStoryboard[];
}

const initialStepStatuses: Record<AgentStep, StepStatus> = {
  1: "pending",
  2: "pending",
  3: "pending",
};

const initialState: AgentState = {
  isOpen: false,
  taskId: null,
  agentId: null,
  prompt: "",
  currentStep: 1,
  stepStatuses: { ...initialStepStatuses },
  outline: null,
  characters: [],
  scenes: [],
  props: [],
  storyboards: [],
};

// ─── Slice ──────────────────────────────────────────────

export const agentSlice = createSlice({
  name: "agent",
  initialState,
  reducers: {
    open: (state) => {
      state.isOpen = true;
    },
    close: (state) => {
      state.isOpen = false;
    },

    setTaskId: (state, action: PayloadAction<string>) => {
      state.taskId = action.payload;
    },

    initAgent: (state, action: PayloadAction<{ id: string; prompt: string }>) => {
      state.isOpen = true;
      state.taskId = null;
      state.agentId = action.payload.id;
      state.prompt = action.payload.prompt;
      state.currentStep = 1;
      state.stepStatuses = { ...initialStepStatuses };
      state.outline = null;
      state.characters = [];
      state.scenes = [];
      state.props = [];
      state.storyboards = [];
    },

    hydrateFromProgress: (
      state,
      action: PayloadAction<{
        task: { id: string; input: Record<string, unknown> };
        steps: { step?: number; stepResult?: Record<string, unknown> }[];
        currentStep: number;
      }>
    ) => {
      const progress = action.payload;
      const stepStatuses: Record<AgentStep, StepStatus> = {
        1: "pending",
        2: "pending",
        3: "pending",
      };
      let outline: StoryOutline | null = null;
      let characters: Character[] = [];
      let scenes: Scene[] = [];
      let props: Prop[] = [];
      let storyboards: EpisodeStoryboard[] = [];

      for (const step of progress.steps) {
        if (!step.stepResult || !step.step) continue;
        const r = step.stepResult as Record<string, unknown>;
        stepStatuses[step.step as AgentStep] = "done";

        if (step.step === 1) {
          const o = r as unknown as StoryOutline;
          outline = {
            ...o,
            episodes: (o.episodes ?? []).map((ep) => ({
              ...ep,
              id: (ep as Episode).id ?? crypto.randomUUID(),
            })),
          };
        } else if (step.step === 2) {
          characters = ((r.characters as Character[]) ?? []).map((c) => ({
            ...c,
            id: c.id ?? crypto.randomUUID(),
            imageStatus: c.imageStatus ?? ("pending" as const),
          }));
          scenes = ((r.scenes as Scene[]) ?? []).map((s) => ({
            ...s,
            id: s.id ?? crypto.randomUUID(),
            imageStatus: s.imageStatus ?? ("pending" as const),
          }));
          props = ((r.props as Prop[]) ?? []).map((p) => ({
            ...p,
            id: p.id ?? crypto.randomUUID(),
          }));
        } else if (step.step === 3) {
          storyboards = ((r.storyboards as EpisodeStoryboard[]) ?? []).map((sb) => ({
            ...sb,
            episodeId: sb.episodeId ?? crypto.randomUUID(),
            shots: (sb.shots ?? []).map((shot) => ({
              ...shot,
              id: (shot as Shot).id ?? crypto.randomUUID(),
              imageStatus: (shot as Shot).imageStatus ?? ("pending" as const),
            })),
          }));
        }
      }

      const completedCount = progress.currentStep;
      const nextStep = Math.min(completedCount + 1, 3) as AgentStep;

      state.isOpen = true;
      state.taskId = progress.task.id;
      state.agentId = progress.task.id;
      state.prompt = (progress.task.input.prompt as string) ?? "";
      state.currentStep = nextStep;
      state.stepStatuses = stepStatuses;
      state.outline = outline;
      state.characters = characters;
      state.scenes = scenes;
      state.props = props;
      state.storyboards = storyboards;
    },

    setCurrentStep: (state, action: PayloadAction<AgentStep>) => {
      state.currentStep = action.payload;
    },

    setStepStatus: (state, action: PayloadAction<{ step: AgentStep; status: StepStatus }>) => {
      state.stepStatuses[action.payload.step] = action.payload.status;
    },

    // Step 1
    setOutline: (state, action: PayloadAction<StoryOutline>) => {
      state.outline = action.payload;
    },
    updateOutlineField: (
      state,
      action: PayloadAction<{ field: keyof StoryOutline; value: string }>
    ) => {
      if (state.outline) {
        (state.outline as Record<string, unknown>)[action.payload.field] = action.payload.value;
      }
    },
    addEpisode: (state, action: PayloadAction<Episode>) => {
      if (state.outline) {
        state.outline.episodes.push(action.payload);
      }
    },
    updateEpisode: (state, action: PayloadAction<{ id: string; updates: Partial<Episode> }>) => {
      if (state.outline) {
        state.outline.episodes = state.outline.episodes.map((e) =>
          e.id === action.payload.id ? { ...e, ...action.payload.updates } : e
        );
      }
    },
    removeEpisode: (state, action: PayloadAction<string>) => {
      if (state.outline) {
        state.outline.episodes = state.outline.episodes.filter((e) => e.id !== action.payload);
      }
    },
    reorderEpisodes: (state, action: PayloadAction<Episode[]>) => {
      if (state.outline) {
        state.outline.episodes = action.payload;
      }
    },

    // Step 2
    setCharacters: (state, action: PayloadAction<Character[]>) => {
      state.characters = action.payload;
    },
    addCharacter: (state, action: PayloadAction<Character>) => {
      state.characters.push(action.payload);
    },
    updateCharacter: (
      state,
      action: PayloadAction<{ id: string; updates: Partial<Character> }>
    ) => {
      state.characters = state.characters.map((c) =>
        c.id === action.payload.id ? { ...c, ...action.payload.updates } : c
      );
    },
    removeCharacter: (state, action: PayloadAction<string>) => {
      state.characters = state.characters.filter((c) => c.id !== action.payload);
    },
    setScenes: (state, action: PayloadAction<Scene[]>) => {
      state.scenes = action.payload;
    },
    addScene: (state, action: PayloadAction<Scene>) => {
      state.scenes.push(action.payload);
    },
    updateScene: (state, action: PayloadAction<{ id: string; updates: Partial<Scene> }>) => {
      state.scenes = state.scenes.map((s) =>
        s.id === action.payload.id ? { ...s, ...action.payload.updates } : s
      );
    },
    removeScene: (state, action: PayloadAction<string>) => {
      state.scenes = state.scenes.filter((s) => s.id !== action.payload);
    },
    setProps: (state, action: PayloadAction<Prop[]>) => {
      state.props = action.payload;
    },
    addProp: (state, action: PayloadAction<Prop>) => {
      state.props.push(action.payload);
    },
    updateProp: (state, action: PayloadAction<{ id: string; updates: Partial<Prop> }>) => {
      state.props = state.props.map((p) =>
        p.id === action.payload.id ? { ...p, ...action.payload.updates } : p
      );
    },
    removeProp: (state, action: PayloadAction<string>) => {
      state.props = state.props.filter((p) => p.id !== action.payload);
    },

    // Step 3
    setStoryboards: (state, action: PayloadAction<EpisodeStoryboard[]>) => {
      state.storyboards = action.payload;
    },
    updateShot: (
      state,
      action: PayloadAction<{ episodeId: string; shotId: string; updates: Partial<Shot> }>
    ) => {
      state.storyboards = state.storyboards.map((sb) =>
        sb.episodeId === action.payload.episodeId
          ? {
              ...sb,
              shots: sb.shots.map((shot) =>
                shot.id === action.payload.shotId ? { ...shot, ...action.payload.updates } : shot
              ),
            }
          : sb
      );
    },

    // Reset
    reset: () => initialState,
  },
});

export const {
  open,
  close,
  setTaskId,
  initAgent,
  hydrateFromProgress,
  setCurrentStep,
  setStepStatus,
  setOutline,
  updateOutlineField,
  addEpisode,
  updateEpisode,
  removeEpisode,
  reorderEpisodes,
  setCharacters,
  addCharacter,
  updateCharacter,
  removeCharacter,
  setScenes,
  addScene,
  updateScene,
  removeScene,
  setProps,
  addProp,
  updateProp,
  removeProp,
  setStoryboards,
  updateShot,
  reset,
} = agentSlice.actions;
