import {
  createSlice,
  createAsyncThunk,
  createSelector,
  type PayloadAction,
} from "@reduxjs/toolkit";
import type { WorkspacePanelKey, WorkspaceTab } from "@/src/types/workspace";
import { backendApi } from "@/src/lib/api";
import { buildOssUrl } from "@/src/lib/uploads/workspace-upload";
import {
  removeTask,
  selectTasksByShot,
  makeSelectTasksByShot,
  type Task,
  type TaskStatus as ReduxTaskStatus,
} from "./taskSlice";
import type { RootState, AppDispatch } from "@/src/store/index";
import type {
  EditMode,
  MultiRefType,
  ReferenceAsset,
  SimpleMode,
  VideoMode,
  VideoResultItem,
} from "@/components/storyboard/ai-generator/video-dialog/video-types";
import {
  getModePath,
  ossUrl,
  toHistoryItem,
} from "@/components/storyboard/ai-generator/video-dialog/video-types";
import type { RawAiModel, AssetRecord } from "@/src/types/workspace";
import { getRawAiModelsFromCache } from "@/src/hooks/use-ai-models";

// ─── Re-export video types used by consumers ──────────
export type { VideoResultItem, ReferenceAsset, MultiRefType, SimpleMode, EditMode, VideoMode };

// ─── Types ──────────────────────────────────────────────

/**
 * Java backend /api/user/project/detail response.
 */
export interface ProjectDetail {
  id?: string;
  name?: string;
  description?: string;
  imagePath?: string;
  aspectRatio?: string;
  aspectRatioType?: string;
  stylePainting?: string;
  type?: number;
  episode?: number;
  chapterLength?: number;
  status?: number;
  aiId?: string;
  adminUserId?: string;
  admin?: boolean;
  enable?: boolean;
  sort?: number;
  createTime?: string;
  updateTime?: string;
  [key: string]: unknown;
}

/**
 * Java backend /api/user/world/list/episode response.
 */
export interface Episode {
  id?: string;
  title?: string;
  sort?: number;
  frontPrompt?: string;
  behindPrompt?: string;
  imagePath?: string;
  videoLength?: number;
  introduction?: string;
  status?: number;
  createTime?: string;
  updateTime?: string;
  [key: string]: unknown;
}

export type ResolvedColumnType =
  | "shot_no"
  | "image"
  | "video"
  | "sound_path"
  | "audio"
  | "music"
  | "richtext"
  | "text"
  | "number"
  | "select"
  | "character"
  | "scene"
  | "dialogue"
  | "lip_sync"
  | "unknown";

export interface ShotColumn {
  id?: string;
  columnType?: string;
  columnName?: string;
  presetColumnKey?: string;
  hide?: boolean;
  sort?: number;
  columnOptions?: unknown[];
  editable?: boolean;
  draggable?: boolean;
  aiRef?: unknown[];
  createTime?: string;
  updateTime?: string;
  resolvedType?: ResolvedColumnType;
  [key: string]: unknown;
}

export interface ShotValue {
  id?: string;
  shotColumnId?: string;
  shotColumnName?: string;
  shotColumnType?: string;
  presetColumnKey?: string;
  richText?: { content?: string; characters?: unknown[] };
  scenes?: unknown[];
  values?: unknown[];
  value?: string;
  files?: unknown[];
  characters?: unknown[];
  [key: string]: unknown;
}

export interface ShotRow {
  shotId?: string;
  shotNo?: string | number;
  shotValues?: ShotValue[];
  createTime?: string;
  updateTime?: string;
  [key: string]: unknown;
}

export interface Asset {
  id?: string;
  name?: string;
  roleImgPath?: string[];
  sceneImgPath?: string[];
  propImgPath?: string[];
  otherImgPath?: string | Record<string, string>;
  [key: string]: unknown;
}

export const STORYBOARD_ROW_HEIGHT = 120;

// ─── Column Type Resolution ─────────────────────────────

function resolveColumn(col: ShotColumn): ShotColumn {
  const preset = col.presetColumnKey?.toLowerCase() ?? "";
  const type = col.columnType?.toLowerCase() ?? "";

  let resolved: ResolvedColumnType = "unknown";

  switch (preset) {
    case "shot_no":
      resolved = "shot_no";
      break;
    case "description":
    case "image_prompt":
    case "video_prompt":
    case "style_planting":
      resolved = "richtext";
      break;
    case "image_path":
      resolved = "image";
      break;
    case "video_path":
      resolved = "video";
      break;
    case "video_path_lip_sync":
      resolved = "lip_sync";
      break;
    case "sound_path":
      resolved = "sound_path";
      break;
    case "music":
      resolved = "music";
      break;
    case "dialogue":
      resolved = "dialogue";
      break;
    case "duration":
      resolved = "number";
      break;
    case "shot_size":
    case "perspective":
    case "movement":
    case "status":
      resolved = "select";
      break;
    case "character":
      resolved = "character";
      break;
    case "scene":
      resolved = "scene";
      break;
    default:
      switch (type) {
        case "rich_text":
        case "richtext":
          resolved = "richtext";
          break;
        case "text":
          resolved = "text";
          break;
        case "number":
          resolved = "number";
          break;
        case "image":
          resolved = "image";
          break;
        case "video":
          resolved = "video";
          break;
        case "audio":
          resolved = "audio";
          break;
        case "single_option":
        case "select":
          resolved = "select";
          break;
        case "character":
          resolved = "character";
          break;
        case "scene":
          resolved = "scene";
          break;
        default:
          resolved = "unknown";
      }
  }

  return { ...col, resolvedType: resolved };
}

// ─── AI Image Form Types ──────────────────────────────

export interface AiModel {
  serviceCode?: string;
  serviceName?: string;
  integralCost?: number;
  description?: string;
  isDefault?: boolean;
  [key: string]: unknown;
}

export interface AiSizeOption {
  label: string;
  value: string;
  ratio?: string;
}

export interface HistoryItem {
  id: string;
  url: string;
  storagePath: string;
  createTime?: string;
  other?: string;
  fromHistory: true;
}

export type ResultStatus = "waiting" | "generating" | "success" | "failed";

export interface ResultItem {
  id: string;
  url?: string;
  storagePath?: string;
  status?: ResultStatus;
  error?: string;
  other?: string;
  fromQueue?: boolean;
  fromHistory?: boolean;
}

export interface ImageGenerateInput {
  shotId: string;
  shotColumnId: string;
  prompt: string;
  model?: string;
  size?: string;
  referenceImageUrl?: string;
  images?: string[];
  mode?: "generate" | "edit";
  promptExtend?: boolean;
  watermark?: boolean;
}

export interface FusionGenerateInput {
  worldRoleId: number;
  prompt: string;
  model?: string;
  characterImageUrl: string;
  propImageUrls: string[];
}

export interface AiImageFormData {
  prompt: string;
  model: string;
  size: string;
  count: number;
  referenceImages: { url: string; path: string }[];
}

interface ImageInstanceState {
  formData: AiImageFormData;
  history: HistoryItem[];
  historyLoading: boolean;
  previewItem: ResultItem | null;
}

// ─── AI Image Helpers ──────────────────────────────────

function imageInstanceKey(shotId: string, shotColumnId: string) {
  return `${shotId}_${shotColumnId}`;
}

function createDefaultImageInstance(): ImageInstanceState {
  return {
    formData: { prompt: "", model: "", size: "", count: 1, referenceImages: [] },
    history: [],
    historyLoading: false,
    previewItem: null,
  };
}

export function parseSizesFromModel(model: AiModel): AiSizeOption[] {
  if (!model.description) return [];
  try {
    const desc = JSON.parse(model.description);
    let sizes = desc.size;
    if (typeof sizes === "string") {
      try {
        sizes = JSON.parse(sizes);
      } catch {
        /* ignore */
      }
    }
    if (!Array.isArray(sizes)) return [];
    return sizes.map((s: unknown) => {
      if (typeof s === "object" && s !== null) {
        const obj = s as { ratio?: string; dimension?: string };
        const ratio = obj.ratio ?? "";
        const dim = obj.dimension ?? "";
        return { label: ratio ? `${ratio} (${dim})` : dim, value: dim || ratio, ratio };
      }
      return { label: String(s), value: String(s) };
    });
  } catch {
    return [];
  }
}

const API_PATH_IMAGE = "/api/ai/image/generate/basic";
const API_PATH_IMAGE_EDIT = "/api/ai/image/edit/wan";

export const defaultSizeOptions: AiSizeOption[] = [
  { label: "1:1 (1024x1024)", value: "1024x1024", ratio: "1:1" },
  { label: "3:4 (768x1024)", value: "768x1024", ratio: "3:4" },
  { label: "4:3 (1024x768)", value: "1024x768", ratio: "4:3" },
  { label: "9:16 (768x1280)", value: "768x1280", ratio: "9:16" },
  { label: "16:9 (1280x768)", value: "1280x768", ratio: "16:9" },
];

// Task -> ResultItem mapping (image)
function taskStatusToLegacy(status: ReduxTaskStatus): ResultStatus {
  switch (status) {
    case "pending":
      return "waiting";
    case "running":
      return "generating";
    case "completed":
      return "success";
    case "failed":
      return "failed";
    case "cancelled":
      return "failed";
    default:
      return "failed";
  }
}

function taskToResultItem(task: Task): ResultItem {
  if (task.status === "completed" && task.output) {
    return {
      id: task.id,
      url: task.output.url,
      storagePath: task.output.storagePath,
      fromQueue: true,
    };
  }
  if (task.status === "failed") {
    return {
      id: task.id,
      status: taskStatusToLegacy(task.status),
      error: task.error ?? undefined,
      fromQueue: true,
    };
  }
  return {
    id: task.id,
    status: taskStatusToLegacy(task.status),
    fromQueue: true,
  };
}

// ─── AI Video Form Types ──────────────────────────────

export interface VideoFormData {
  prompt: string;
  prefixPrompt: string;
  suffixPrompt: string;
  model: string;
  size: string;
  videoLength: string;
  count: number;
}

export interface VideoReferences {
  referenceImages: ReferenceAsset[];
  firstFrames: ReferenceAsset[];
  lastFrames: ReferenceAsset[];
  multiRefImages: (ReferenceAsset & { typeTag: MultiRefType })[];
  repaintRefVideos: ReferenceAsset[];
  repaintRefImage: ReferenceAsset[];
  localEditRefVideo: ReferenceAsset[];
  localEditMaskImage: ReferenceAsset[];
  localEditRefImage: ReferenceAsset[];
  extendFirstClip: ReferenceAsset[];
  extendLastClip: ReferenceAsset[];
  extendFirstFrame: ReferenceAsset[];
  extendLastFrame: ReferenceAsset[];
  outpaintingRefVideo: ReferenceAsset[];
}

export interface VideoModeSettingsState {
  controlCondition: string;
  maskType: "tracking" | "fixed";
  expandRatio: number;
  maskFrameId: string;
  outpaintingTop: number;
  outpaintingBottom: number;
  outpaintingLeft: number;
  outpaintingRight: number;
}

export interface VideoInstanceState {
  uploadMode: SimpleMode;
  editMode: EditMode | null;
  formData: VideoFormData;
  references: VideoReferences;
  modeSettings: VideoModeSettingsState;
  history: VideoResultItem[];
  historyLoading: boolean;
  previewItem: VideoResultItem | null;
  savedModel: string;
}

// ─── AI Video Helpers ─────────────────────────────────

function videoInstanceKey(shotId: string, shotColumnId: string) {
  return `${shotId}_${shotColumnId}`;
}

function createDefaultVideoReferences(): VideoReferences {
  return {
    referenceImages: [],
    firstFrames: [],
    lastFrames: [],
    multiRefImages: [],
    repaintRefVideos: [],
    repaintRefImage: [],
    localEditRefVideo: [],
    localEditMaskImage: [],
    localEditRefImage: [],
    extendFirstClip: [],
    extendLastClip: [],
    extendFirstFrame: [],
    extendLastFrame: [],
    outpaintingRefVideo: [],
  };
}

function createDefaultVideoModeSettings(): VideoModeSettingsState {
  return {
    controlCondition: "posebodyface",
    maskType: "tracking",
    expandRatio: 0.5,
    maskFrameId: "",
    outpaintingTop: 1,
    outpaintingBottom: 1,
    outpaintingLeft: 1,
    outpaintingRight: 1,
  };
}

function createDefaultVideoInstance(): VideoInstanceState {
  return {
    uploadMode: "reference",
    editMode: null,
    formData: {
      prompt: "",
      prefixPrompt: "",
      suffixPrompt: "",
      model: "",
      size: "",
      videoLength: "",
      count: 1,
    },
    references: createDefaultVideoReferences(),
    modeSettings: createDefaultVideoModeSettings(),
    history: [],
    historyLoading: false,
    previewItem: null,
    savedModel: "",
  };
}

// Task -> VideoResultItem mapping
type VideoResultStatus = "waiting" | "generating" | "success" | "failed";

function taskStatusToVideoStatus(status: ReduxTaskStatus): VideoResultStatus {
  switch (status) {
    case "pending":
      return "waiting";
    case "running":
      return "generating";
    case "completed":
      return "success";
    case "failed":
      return "failed";
    case "cancelled":
      return "failed";
    default:
      return "failed";
  }
}

function taskToVideoResultItem(task: Task): VideoResultItem {
  if (task.status === "completed" && task.output) {
    return {
      id: task.id,
      url: task.output.url,
      storagePath: task.output.storagePath,
      fromQueue: true,
    };
  }
  if (task.status === "failed") {
    return {
      id: task.id,
      status: taskStatusToVideoStatus(task.status),
      error: task.error ?? undefined,
      fromQueue: true,
    };
  }
  return {
    id: task.id,
    status: taskStatusToVideoStatus(task.status),
    fromQueue: true,
  };
}

// ─── AI Image Form State (nested) ────────────────────

interface AiImageFormNestedState {
  models: AiModel[];
  modelsLoaded: boolean;
  currentModel: AiModel | null;
  editModels: AiModel[];
  editModelsLoaded: boolean;
  currentEditModel: AiModel | null;
  instances: Record<string, ImageInstanceState>;
}

function createDefaultAiImageForm(): AiImageFormNestedState {
  return {
    models: [],
    modelsLoaded: false,
    currentModel: null,
    editModels: [],
    editModelsLoaded: false,
    currentEditModel: null,
    instances: {},
  };
}

// ─── AI Audio Form State (nested) ────────────────────

export interface AudioGenerateInput {
  shotId: string;
  shotColumnId: string;
  prompt: string;
  model?: string;
  voiceId?: string;
}

export interface AiAudioFormData {
  prompt: string;
  model: string;
  voiceId: string;
  count: number;
}

interface AudioInstanceState {
  formData: AiAudioFormData;
  history: HistoryItem[];
  historyLoading: boolean;
  previewItem: ResultItem | null;
}

function audioInstanceKey(shotId: string, shotColumnId: string) {
  return `${shotId}_${shotColumnId}`;
}

function createDefaultAudioInstance(): AudioInstanceState {
  return {
    formData: { prompt: "", model: "", voiceId: "", count: 1 },
    history: [],
    historyLoading: false,
    previewItem: null,
  };
}

interface AiAudioFormNestedState {
  models: RawAiModel[];
  modelsLoaded: boolean;
  currentModel: RawAiModel | null;
  instances: Record<string, AudioInstanceState>;
}

function createDefaultAiAudioForm(): AiAudioFormNestedState {
  return {
    models: [],
    modelsLoaded: false,
    currentModel: null,
    instances: {},
  };
}

// ─── AI Video Form State (nested) ────────────────────

interface AiVideoFormNestedState {
  modelsByMode: Partial<Record<VideoMode, RawAiModel[]>>;
  modelsLoadedForMode: Partial<Record<VideoMode, boolean>>;
  instances: Record<string, VideoInstanceState>;
}

function createDefaultAiVideoForm(): AiVideoFormNestedState {
  return {
    modelsByMode: {},
    modelsLoadedForMode: {},
    instances: {},
  };
}

// ─── Per-Instance State ────────────────────────────────

export interface ProjectInstanceState {
  worldId: string | null;
  routeEpisodeId: string | null;
  detail: ProjectDetail | null;
  isLoading: boolean;
  error: string | null;

  activeTab: WorkspaceTab;
  activePanel: WorkspacePanelKey | null;
  isAiPanelOpen: boolean;
  isAiPanelExpanded: boolean;

  episodes: Episode[];
  activeEpisodeId: string | null;
  isEpisodesLoading: boolean;

  columns: ShotColumn[];
  rows: ShotRow[];
  isStoryboardLoading: boolean;
  batchGeneratingActive: boolean;
  batchGeneratingCells: Record<string, true>;
  batchCompletedCells: Record<string, true>;

  worldDetail: Record<string, unknown> | null;
  isWorldLoading: boolean;

  characters: Asset[];
  isCharactersLoading: boolean;
  scenes: Asset[];
  isScenesLoading: boolean;
  props: Asset[];
  isPropsLoading: boolean;

  projectList: ProjectDetail[];
  isProjectListLoading: boolean;

  projectListVersion: number;
  episodesVersion: number;
  storyboardVersion: number;
  worldVersion: number;
  charactersVersion: number;
  scenesVersion: number;
  propsVersion: number;
  assetsVersion: number;

  // AI Image Form (merged from aiImageFormSlice)
  aiImageForm: AiImageFormNestedState;

  // AI Video Form (merged from aiVideoFormSlice)
  aiVideoForm: AiVideoFormNestedState;

  // AI Audio Form
  aiAudioForm: AiAudioFormNestedState;
}

export function createDefaultProjectInstance(): ProjectInstanceState {
  return {
    worldId: null,
    routeEpisodeId: null,
    detail: null,
    isLoading: false,
    error: null,

    activeTab: "storyboard",
    activePanel: "aiAssistant",
    isAiPanelOpen: false,
    isAiPanelExpanded: false,

    episodes: [],
    activeEpisodeId: null,
    isEpisodesLoading: false,

    columns: [],
    rows: [],
    isStoryboardLoading: false,
    batchGeneratingActive: false,
    batchGeneratingCells: {},
    batchCompletedCells: {},

    worldDetail: null,
    isWorldLoading: false,

    characters: [],
    isCharactersLoading: false,
    scenes: [],
    isScenesLoading: false,
    props: [],
    isPropsLoading: false,

    projectList: [],
    isProjectListLoading: false,

    projectListVersion: 0,
    episodesVersion: 0,
    storyboardVersion: 0,
    worldVersion: 0,
    charactersVersion: 0,
    scenesVersion: 0,
    propsVersion: 0,
    assetsVersion: 0,

    aiImageForm: createDefaultAiImageForm(),
    aiVideoForm: createDefaultAiVideoForm(),
    aiAudioForm: createDefaultAiAudioForm(),
  };
}

/**
 * Stable empty instance used as fallback when currentProjectId is null.
 * This is a single reference so selectors don't cause re-renders.
 */
export const EMPTY_INSTANCE: ProjectInstanceState = createDefaultProjectInstance();

// ─── Root State ────────────────────────────────────────

interface ProjectSliceState {
  currentProjectId: string | null;
  instances: Record<string, ProjectInstanceState>;
}

const initialState: ProjectSliceState = {
  currentProjectId: null,
  instances: {},
};

// ─── Helper ────────────────────────────────────────────

/**
 * Safely get or create the current project instance.
 */
function getInstance(state: ProjectSliceState): ProjectInstanceState | null {
  const id = state.currentProjectId;
  if (!id) return null;
  if (!state.instances[id]) {
    state.instances[id] = createDefaultProjectInstance();
  }
  return state.instances[id];
}

// ─── AI Image Form Thunks ─────────────────────────────

export const loadImageModels = createAsyncThunk<void, void, { state: RootState }>(
  "project/loadImageModels",
  async (_, { getState, dispatch }) => {
    const inst = selectCurrentInstance(getState());
    if (inst.aiImageForm.modelsLoaded) return;
    try {
      const res = await backendApi.post<AiModel[]>(
        `/api/ai/record/model/list?path=${encodeURIComponent(API_PATH_IMAGE)}`
      );
      const list = Array.isArray(res) ? res : [];
      const defaultModel = list.find((m) => m.isDefault) ?? list[0] ?? null;
      dispatch(setImageModelsLoaded({ models: list, currentModel: defaultModel }));
    } catch (err) {
      console.error("[projectSlice] loadImageModels failed:", err);
    }
  }
);

export const loadImageEditModels = createAsyncThunk<void, void, { state: RootState }>(
  "project/loadImageEditModels",
  async (_, { getState, dispatch }) => {
    const inst = selectCurrentInstance(getState());
    if (inst.aiImageForm.editModelsLoaded) return;
    try {
      const res = await backendApi.post<AiModel[]>(
        `/api/ai/record/model/list?path=${encodeURIComponent(API_PATH_IMAGE_EDIT)}`
      );
      const list = Array.isArray(res) ? res : [];
      const defaultModel = list.find((m) => m.isDefault) ?? list[0] ?? null;
      dispatch(setImageEditModelsLoaded({ editModels: list, currentEditModel: defaultModel }));
    } catch (err) {
      console.error("[projectSlice] loadImageEditModels failed:", err);
    }
  }
);

export const loadImageHistory = createAsyncThunk<
  void,
  { shotId: string; colId: string },
  { state: RootState; dispatch: AppDispatch }
>("project/loadImageHistory", async ({ shotId, colId }, { getState, dispatch }) => {
  const key = imageInstanceKey(shotId, colId);

  dispatch(setImageHistoryLoading({ key, loading: true }));

  try {
    interface RecordItem {
      id?: string;
      filePath?: string;
      path?: string;
      storagePath?: string;
      createTime?: string;
      other?: string;
    }
    const res = await backendApi.post<{ list?: RecordItem[] }>("/api/ai/record/shot/list", {
      data: { page: 1, pageSize: 50, shotId, shotcolumnId: colId, type: "img", sort: 1 },
    });

    const records = (res as { list?: RecordItem[] })?.list ?? [];
    const history: HistoryItem[] = records.map((item) => ({
      id: String(item.id ?? ""),
      url: buildOssUrl(item.filePath ?? item.path ?? item.storagePath),
      storagePath: item.storagePath ?? item.filePath ?? item.path ?? "",
      createTime: item.createTime,
      other: item.other ?? "",
      fromHistory: true,
    }));

    // Dedup: clear completed tasks whose storagePath already exists in history
    const historyPaths = new Set(history.map((h) => h.storagePath).filter(Boolean));
    const state = getState();
    const shotTasks = selectTasksByShot(state, shotId, colId);
    for (const task of shotTasks) {
      if (
        task.status === "completed" &&
        task.output?.storagePath &&
        historyPaths.has(task.output.storagePath)
      ) {
        dispatch(removeTask(task.id));
      }
    }

    dispatch(setImageHistory({ key, history }));
  } catch (err) {
    console.error("[projectSlice] loadImageHistory failed:", err);
    dispatch(setImageHistoryLoading({ key, loading: false }));
  }
});

export const initImageInstance = createAsyncThunk<
  void,
  {
    shotId: string;
    colId: string;
    opts?: { defaultPrompt?: string; defaultRefImage?: string };
  },
  { state: RootState; dispatch: AppDispatch }
>("project/initImageInstance", async ({ shotId, colId, opts }, { getState, dispatch }) => {
  await dispatch(loadImageModels()).unwrap();

  const key = imageInstanceKey(shotId, colId);
  const state = getState();
  const instProj = selectCurrentInstance(state);
  const existing = instProj.aiImageForm.instances[key];
  const inst = existing
    ? { ...existing, formData: { ...existing.formData } }
    : createDefaultImageInstance();

  if (opts?.defaultPrompt && !inst.formData.prompt) {
    inst.formData.prompt = opts.defaultPrompt;
  }
  if (opts?.defaultRefImage) {
    inst.formData.referenceImages = [
      { url: buildOssUrl(opts.defaultRefImage), path: opts.defaultRefImage },
    ];
  }
  if (instProj.aiImageForm.currentModel && !inst.formData.model) {
    inst.formData.model = instProj.aiImageForm.currentModel.serviceCode ?? "";
  }

  dispatch(setImageInstance({ key, instance: inst }));
  await dispatch(loadImageHistory({ shotId, colId })).unwrap();
});

export const deleteImageItem = createAsyncThunk<
  void,
  { shotId: string; colId: string; item: ResultItem },
  { state: RootState; dispatch: AppDispatch }
>("project/deleteImageItem", async ({ shotId, colId, item }, { getState, dispatch }) => {
  const key = imageInstanceKey(shotId, colId);

  if (item.fromQueue) {
    dispatch(removeTask(item.id));
  } else if (item.id) {
    await backendApi.post(`/api/ai/record/delete/${item.id}`);
    dispatch(removeImageHistoryItem({ key, itemId: item.id }));
  }

  // Clear preview if deleted
  const instProj = selectCurrentInstance(getState());
  const inst = instProj.aiImageForm.instances[key];
  if (inst?.previewItem?.id === item.id) {
    dispatch(setImagePreview({ shotId, colId, item: null }));
  }
});

// ─── AI Video Form Thunks ─────────────────────────────

export const loadVideoModels = createAsyncThunk<
  void,
  { mode: VideoMode },
  { state: RootState; dispatch: AppDispatch }
>("project/loadVideoModels", async ({ mode }, { getState, dispatch }) => {
  const inst = selectCurrentInstance(getState());
  if (inst.aiVideoForm.modelsLoadedForMode[mode]) return;

  // Try preloaded cache first
  const modePath = getModePath(mode);
  const cached = getRawAiModelsFromCache(modePath) as RawAiModel[];
  if (cached.length > 0) {
    dispatch(setVideoModelsByMode({ mode, models: cached }));
    return;
  }

  try {
    const res = await backendApi.post<RawAiModel[]>(
      `/api/ai/record/model/list?path=${encodeURIComponent(modePath)}`
    );
    const list = Array.isArray(res) ? res : [];
    dispatch(setVideoModelsByMode({ mode, models: list }));
  } catch (err) {
    console.error("[projectSlice] loadVideoModels failed:", err);
  }
});

export const loadVideoHistory = createAsyncThunk<
  void,
  { shotId: string; colId: string },
  { state: RootState; dispatch: AppDispatch }
>("project/loadVideoHistory", async ({ shotId, colId }, { getState, dispatch }) => {
  const key = videoInstanceKey(shotId, colId);
  dispatch(setVideoHistoryLoading({ key, loading: true }));

  try {
    const res = await backendApi.post<{ list?: AssetRecord[] }>("/api/ai/record/shot/list", {
      data: { page: 1, pageSize: 50, shotId, shotcolumnId: colId, type: "video", sort: 1 },
    });

    const records = (res as { list?: AssetRecord[] })?.list ?? [];
    const history: VideoResultItem[] = records.map(toHistoryItem);

    // Dedup: clear completed tasks whose storagePath already exists in history
    const historyPaths = new Set(history.map((h) => h.storagePath).filter(Boolean));
    const state = getState();
    const shotTasks = selectTasksByShot(state, shotId, colId);
    for (const task of shotTasks) {
      if (
        task.type === "video" &&
        task.status === "completed" &&
        task.output?.storagePath &&
        historyPaths.has(task.output.storagePath)
      ) {
        dispatch(removeTask(task.id));
      }
    }

    dispatch(setVideoHistory({ key, history }));
  } catch (err) {
    console.error("[projectSlice] loadVideoHistory failed:", err);
    dispatch(setVideoHistoryLoading({ key, loading: false }));
  }
});

export const initVideoInstance = createAsyncThunk<
  void,
  {
    shotId: string;
    colId: string;
    opts?: {
      defaultPrompt?: string;
      defaultReferenceImage?: string;
      prefixPrompt?: string;
      suffixPrompt?: string;
    };
  },
  { state: RootState; dispatch: AppDispatch }
>("project/initVideoInstance", async ({ shotId, colId, opts }, { getState, dispatch }) => {
  const key = videoInstanceKey(shotId, colId);
  const state = getState();
  const instProj = selectCurrentInstance(state);
  const existing = instProj.aiVideoForm.instances[key];
  const inst = existing
    ? { ...existing, formData: { ...existing.formData }, references: { ...existing.references } }
    : createDefaultVideoInstance();

  if (opts?.defaultPrompt && !inst.formData.prompt) {
    inst.formData.prompt = opts.defaultPrompt;
  }
  if (opts?.prefixPrompt && !inst.formData.prefixPrompt) {
    inst.formData.prefixPrompt = opts.prefixPrompt;
  }
  if (opts?.suffixPrompt && !inst.formData.suffixPrompt) {
    inst.formData.suffixPrompt = opts.suffixPrompt;
  }
  if (opts?.defaultReferenceImage) {
    const defaultRef = {
      url: ossUrl(opts.defaultReferenceImage),
      path: opts.defaultReferenceImage,
    };
    if (inst.references.referenceImages.length === 0) {
      inst.references.referenceImages = [defaultRef];
    }
    if (inst.references.firstFrames.length === 0) {
      inst.references.firstFrames = [defaultRef];
    }
  }

  dispatch(setVideoInstance({ key, instance: inst }));

  // Load models for the active mode + load history
  const activeMode = inst.editMode ?? inst.uploadMode;
  await dispatch(loadVideoModels({ mode: activeMode })).unwrap();

  // Set default model if needed
  const updatedState = getState();
  const updatedInst = selectCurrentInstance(updatedState);
  const models = updatedInst.aiVideoForm.modelsByMode[activeMode] ?? [];
  if (models.length > 0 && !inst.formData.model) {
    const defaultModel = models.find((m) => m.isDefault) ?? models[0];
    if (defaultModel?.serviceCode) {
      dispatch(updateVideoForm({ key, updates: { model: String(defaultModel.serviceCode) } }));
    }
  }

  await dispatch(loadVideoHistory({ shotId, colId })).unwrap();
});

export const deleteVideoItem = createAsyncThunk<
  void,
  { shotId: string; colId: string; item: VideoResultItem },
  { state: RootState; dispatch: AppDispatch }
>("project/deleteVideoItem", async ({ shotId, colId, item }, { getState, dispatch }) => {
  const key = videoInstanceKey(shotId, colId);

  if (item.fromQueue) {
    dispatch(removeTask(item.id));
  } else if (item.id) {
    await backendApi.post(`/api/ai/record/delete/${item.id}`);
    dispatch(removeVideoHistoryItem({ key, itemId: item.id }));
  }

  // Clear preview if deleted
  const instProj = selectCurrentInstance(getState());
  const inst = instProj.aiVideoForm.instances[key];
  if (inst?.previewItem?.id === item.id) {
    dispatch(setVideoPreview({ key, item: null }));
  }
});

// ─── Audio Thunks ─────────────────────────────────────

const API_PATH_AUDIO_VOICE = "/api/ai/voice/synthesize";

export const loadAudioModels = createAsyncThunk<void, void, { state: RootState }>(
  "project/loadAudioModels",
  async (_, { getState, dispatch }) => {
    const inst = selectCurrentInstance(getState());
    if (inst.aiAudioForm.modelsLoaded) return;
    try {
      const res = await backendApi.post<RawAiModel[]>(
        `/api/ai/record/model/list?path=${encodeURIComponent(API_PATH_AUDIO_VOICE)}`
      );
      const list = Array.isArray(res) ? res : [];
      const defaultModel = list.find((m) => m.isDefault) ?? list[0] ?? null;
      dispatch(setAudioModelsLoaded({ models: list, currentModel: defaultModel }));
    } catch (err) {
      console.error("[projectSlice] loadAudioModels failed:", err);
    }
  }
);

export const loadAudioHistory = createAsyncThunk<
  void,
  { shotId: string; colId: string },
  { state: RootState; dispatch: AppDispatch }
>("project/loadAudioHistory", async ({ shotId, colId }, { getState, dispatch }) => {
  const key = audioInstanceKey(shotId, colId);
  dispatch(setAudioHistoryLoading({ key, loading: true }));

  try {
    interface RecordItem {
      id?: string;
      filePath?: string;
      path?: string;
      storagePath?: string;
      createTime?: string;
      other?: string;
    }
    const res = await backendApi.post<{ list?: RecordItem[] }>("/api/ai/record/shot/list", {
      data: { page: 1, pageSize: 50, shotId, shotcolumnId: colId, type: "audio", sort: 1 },
    });

    const records = (res as { list?: RecordItem[] })?.list ?? [];
    const history: HistoryItem[] = records
      .filter((item) => item.storagePath || item.filePath || item.path)
      .map((item) => ({
        id: String(item.id ?? ""),
        url: buildOssUrl(item.storagePath ?? item.filePath ?? item.path ?? ""),
        storagePath: item.storagePath ?? item.filePath ?? item.path ?? "",
        createTime: item.createTime,
        other: item.other ?? "",
        fromHistory: true as const,
      }));

    // Dedup completed tasks already in history
    const historyPaths = new Set(history.map((h) => h.storagePath).filter(Boolean));
    const state = getState();
    const shotTasks = selectTasksByShot(state, shotId, colId);
    for (const task of shotTasks) {
      if (
        task.type === "audio" &&
        task.status === "completed" &&
        task.output?.storagePath &&
        historyPaths.has(task.output.storagePath)
      ) {
        dispatch(removeTask(task.id));
      }
    }

    dispatch(setAudioHistory({ key, history }));
  } catch (err) {
    console.error("[projectSlice] loadAudioHistory failed:", err);
    dispatch(setAudioHistoryLoading({ key, loading: false }));
  }
});

export const initAudioInstance = createAsyncThunk<
  void,
  { shotId: string; colId: string; opts?: { defaultPrompt?: string } },
  { state: RootState; dispatch: AppDispatch }
>("project/initAudioInstance", async ({ shotId, colId, opts }, { getState, dispatch }) => {
  await dispatch(loadAudioModels()).unwrap();

  const key = audioInstanceKey(shotId, colId);
  const instProj = selectCurrentInstance(getState());
  const existing = instProj.aiAudioForm.instances[key];
  const inst = existing
    ? { ...existing, formData: { ...existing.formData } }
    : createDefaultAudioInstance();

  if (opts?.defaultPrompt && !inst.formData.prompt) {
    inst.formData.prompt = opts.defaultPrompt;
  }
  if (instProj.aiAudioForm.currentModel && !inst.formData.model) {
    inst.formData.model = String(instProj.aiAudioForm.currentModel.serviceCode ?? "");
  }

  dispatch(setAudioInstance({ key, instance: inst }));
  await dispatch(loadAudioHistory({ shotId, colId })).unwrap();
});

export const deleteAudioItem = createAsyncThunk<
  void,
  { shotId: string; colId: string; item: ResultItem },
  { state: RootState; dispatch: AppDispatch }
>("project/deleteAudioItem", async ({ shotId, colId, item }, { getState, dispatch }) => {
  const key = audioInstanceKey(shotId, colId);

  if (item.fromQueue) {
    dispatch(removeTask(item.id));
  } else if (item.id) {
    await backendApi.post(`/api/ai/record/delete/${item.id}`);
    dispatch(removeAudioHistoryItem({ key, itemId: item.id }));
  }

  const instProj = selectCurrentInstance(getState());
  const inst = instProj.aiAudioForm.instances[key];
  if (inst?.previewItem?.id === item.id) {
    dispatch(setAudioPreview({ shotId, colId, item: null }));
  }
});

// ─── Slice ──────────────────────────────────────────────

export const projectSlice = createSlice({
  name: "project",
  initialState,
  reducers: {
    setProjectId: (state, action: PayloadAction<string>) => {
      state.currentProjectId = action.payload;
      if (!state.instances[action.payload]) {
        state.instances[action.payload] = createDefaultProjectInstance();
      }
    },
    setWorldId: (state, action: PayloadAction<string>) => {
      const inst = getInstance(state);
      if (inst) inst.worldId = action.payload;
    },
    setRouteEpisodeId: (state, action: PayloadAction<string | null>) => {
      const inst = getInstance(state);
      if (inst) inst.routeEpisodeId = action.payload;
    },
    setDetail: (state, action: PayloadAction<ProjectDetail>) => {
      const inst = getInstance(state);
      if (inst) {
        inst.detail = action.payload;
        inst.error = null;
        inst.isLoading = false;
      }
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      const inst = getInstance(state);
      if (inst) inst.isLoading = action.payload;
    },
    setError: (state, action: PayloadAction<string | null>) => {
      const inst = getInstance(state);
      if (inst) {
        inst.error = action.payload;
        inst.isLoading = false;
      }
    },
    setActiveTab: (state, action: PayloadAction<WorkspaceTab>) => {
      const inst = getInstance(state);
      if (inst) inst.activeTab = action.payload;
    },
    setActivePanel: (state, action: PayloadAction<WorkspacePanelKey | null>) => {
      const inst = getInstance(state);
      if (inst) inst.activePanel = action.payload;
    },
    togglePanel: (state, action: PayloadAction<WorkspacePanelKey>) => {
      const inst = getInstance(state);
      if (inst) inst.activePanel = inst.activePanel === action.payload ? null : action.payload;
    },
    setAiPanelOpen: (state, action: PayloadAction<boolean>) => {
      const inst = getInstance(state);
      if (inst) {
        inst.isAiPanelOpen = action.payload;
        if (!action.payload) inst.isAiPanelExpanded = false;
      }
    },
    setAiPanelExpanded: (state, action: PayloadAction<boolean>) => {
      const inst = getInstance(state);
      if (inst) inst.isAiPanelExpanded = action.payload;
    },
    // Episodes
    setEpisodes: (state, action: PayloadAction<Episode[]>) => {
      const inst = getInstance(state);
      if (!inst) return;
      const episodes = action.payload;
      const routeEpisodeId = inst.routeEpisodeId;
      const current = routeEpisodeId ?? inst.activeEpisodeId;
      const exists = episodes.some((ep) => String(ep.id) === String(current));
      inst.episodes = episodes;
      inst.isEpisodesLoading = false;
      inst.activeEpisodeId = exists ? current : episodes[0]?.id ? String(episodes[0].id) : null;
    },
    setActiveEpisodeId: (state, action: PayloadAction<string>) => {
      const inst = getInstance(state);
      if (inst) {
        if (inst.activeEpisodeId === action.payload) return;
        inst.activeEpisodeId = action.payload;
        inst.columns = [];
        inst.rows = [];
      }
    },
    setEpisodesLoading: (state, action: PayloadAction<boolean>) => {
      const inst = getInstance(state);
      if (inst) inst.isEpisodesLoading = action.payload;
    },
    updateEpisodeInStore: (
      state,
      action: PayloadAction<{ id: string; data: Partial<Episode> }>
    ) => {
      const inst = getInstance(state);
      if (inst) {
        inst.episodes = inst.episodes.map((ep) =>
          String(ep.id) === action.payload.id ? { ...ep, ...action.payload.data } : ep
        );
      }
    },
    addEpisodeToStore: (state, action: PayloadAction<Episode>) => {
      const inst = getInstance(state);
      if (inst) inst.episodes.push(action.payload);
    },
    removeEpisodeFromStore: (state, action: PayloadAction<string>) => {
      const inst = getInstance(state);
      if (inst) {
        inst.episodes = inst.episodes.filter((ep) => String(ep.id) !== action.payload);
      }
    },

    // Storyboard
    setColumns: (state, action: PayloadAction<ShotColumn[]>) => {
      const inst = getInstance(state);
      if (inst) inst.columns = action.payload.map(resolveColumn);
    },
    setRows: (state, action: PayloadAction<ShotRow[]>) => {
      const inst = getInstance(state);
      if (inst) {
        inst.rows = action.payload;
        inst.isStoryboardLoading = false;
      }
    },
    setStoryboardLoading: (state, action: PayloadAction<boolean>) => {
      const inst = getInstance(state);
      if (inst) inst.isStoryboardLoading = action.payload;
    },
    setBatchGeneratingActive: (state, action: PayloadAction<boolean>) => {
      const inst = getInstance(state);
      if (inst) inst.batchGeneratingActive = action.payload;
    },
    setBatchGenerating: (
      state,
      action: PayloadAction<{ shotId: string; columnId: string; generating: boolean }>
    ) => {
      const inst = getInstance(state);
      if (!inst) return;
      const key = `${action.payload.shotId}:${action.payload.columnId}`;
      if (action.payload.generating) {
        inst.batchGeneratingCells[key] = true;
      } else {
        delete inst.batchGeneratingCells[key];
      }
    },
    setBatchCompleted: (state, action: PayloadAction<{ shotId: string; columnId: string }>) => {
      const inst = getInstance(state);
      if (!inst) return;
      const key = `${action.payload.shotId}:${action.payload.columnId}`;
      inst.batchCompletedCells[key] = true;
    },
    clearSingleBatchCompleted: (
      state,
      action: PayloadAction<{ shotId: string; columnId: string }>
    ) => {
      const inst = getInstance(state);
      if (!inst) return;
      const key = `${action.payload.shotId}:${action.payload.columnId}`;
      delete inst.batchCompletedCells[key];
    },
    clearBatchGenerating: (state) => {
      const inst = getInstance(state);
      if (inst) {
        inst.batchGeneratingActive = false;
        inst.batchGeneratingCells = {};
      }
    },

    // World
    setWorldDetail: (state, action: PayloadAction<Record<string, unknown>>) => {
      const inst = getInstance(state);
      if (inst) {
        inst.worldDetail = action.payload;
        inst.isWorldLoading = false;
      }
    },
    setWorldLoading: (state, action: PayloadAction<boolean>) => {
      const inst = getInstance(state);
      if (inst) inst.isWorldLoading = action.payload;
    },

    // Assets
    setCharacters: (state, action: PayloadAction<Asset[]>) => {
      const inst = getInstance(state);
      if (inst) {
        inst.characters = action.payload;
        inst.isCharactersLoading = false;
      }
    },
    setCharactersLoading: (state, action: PayloadAction<boolean>) => {
      const inst = getInstance(state);
      if (inst) inst.isCharactersLoading = action.payload;
    },
    setScenes: (state, action: PayloadAction<Asset[]>) => {
      const inst = getInstance(state);
      if (inst) {
        inst.scenes = action.payload;
        inst.isScenesLoading = false;
      }
    },
    setScenesLoading: (state, action: PayloadAction<boolean>) => {
      const inst = getInstance(state);
      if (inst) inst.isScenesLoading = action.payload;
    },
    updateScene: (state, action: PayloadAction<{ id: string; data: Partial<Asset> }>) => {
      const inst = getInstance(state);
      if (inst) {
        inst.scenes = inst.scenes.map((s) =>
          String(s.id) === action.payload.id ? { ...s, ...action.payload.data } : s
        );
      }
    },
    addScene: (state, action: PayloadAction<Asset>) => {
      const inst = getInstance(state);
      if (inst) inst.scenes.unshift(action.payload);
    },
    removeScene: (state, action: PayloadAction<string>) => {
      const inst = getInstance(state);
      if (inst) {
        inst.scenes = inst.scenes.filter((s) => String(s.id) !== action.payload);
      }
    },
    setProps: (state, action: PayloadAction<Asset[]>) => {
      const inst = getInstance(state);
      if (inst) {
        inst.props = action.payload;
        inst.isPropsLoading = false;
      }
    },
    setPropsLoading: (state, action: PayloadAction<boolean>) => {
      const inst = getInstance(state);
      if (inst) inst.isPropsLoading = action.payload;
    },
    updateProp: (state, action: PayloadAction<{ id: string; data: Partial<Asset> }>) => {
      const inst = getInstance(state);
      if (inst) {
        inst.props = inst.props.map((p) =>
          String(p.id) === action.payload.id ? { ...p, ...action.payload.data } : p
        );
      }
    },
    addProp: (state, action: PayloadAction<Asset>) => {
      const inst = getInstance(state);
      if (inst) inst.props.unshift(action.payload);
    },
    removeProp: (state, action: PayloadAction<string>) => {
      const inst = getInstance(state);
      if (inst) {
        inst.props = inst.props.filter((p) => String(p.id) !== action.payload);
      }
    },

    // Project list
    setProjectList: (state, action: PayloadAction<ProjectDetail[]>) => {
      const inst = getInstance(state);
      if (inst) {
        inst.projectList = action.payload;
        inst.isProjectListLoading = false;
      }
    },
    setProjectListLoading: (state, action: PayloadAction<boolean>) => {
      const inst = getInstance(state);
      if (inst) inst.isProjectListLoading = action.payload;
    },

    // Version touch actions
    touchProjectList: (state) => {
      const inst = getInstance(state);
      if (inst) inst.projectListVersion += 1;
    },
    touchEpisodes: (state) => {
      const inst = getInstance(state);
      if (inst) inst.episodesVersion += 1;
    },
    touchStoryboard: (state) => {
      const inst = getInstance(state);
      if (inst) inst.storyboardVersion += 1;
    },
    touchWorld: (state) => {
      const inst = getInstance(state);
      if (inst) inst.worldVersion += 1;
    },
    touchCharacters: (state) => {
      const inst = getInstance(state);
      if (inst) inst.charactersVersion += 1;
    },
    touchScenes: (state) => {
      const inst = getInstance(state);
      if (inst) inst.scenesVersion += 1;
    },
    touchProps: (state) => {
      const inst = getInstance(state);
      if (inst) inst.propsVersion += 1;
    },
    touchAssets: (state) => {
      const inst = getInstance(state);
      if (inst) inst.assetsVersion += 1;
    },
    // Reset
    reset: (state) => {
      const id = state.currentProjectId;
      if (id) {
        state.instances[id] = createDefaultProjectInstance();
      }
    },

    // ─── AI Image Form Reducers ──────────────────────────
    setImageModelsLoaded: (
      state,
      action: PayloadAction<{ models: AiModel[]; currentModel: AiModel | null }>
    ) => {
      const inst = getInstance(state);
      if (!inst) return;
      inst.aiImageForm.models = action.payload.models;
      inst.aiImageForm.modelsLoaded = true;
      inst.aiImageForm.currentModel = action.payload.currentModel;
    },

    setImageEditModelsLoaded: (
      state,
      action: PayloadAction<{ editModels: AiModel[]; currentEditModel: AiModel | null }>
    ) => {
      const inst = getInstance(state);
      if (!inst) return;
      inst.aiImageForm.editModels = action.payload.editModels;
      inst.aiImageForm.editModelsLoaded = true;
      inst.aiImageForm.currentEditModel = action.payload.currentEditModel;
    },

    setImageCurrentModel: (state, action: PayloadAction<AiModel>) => {
      const inst = getInstance(state);
      if (!inst) return;
      inst.aiImageForm.currentModel = action.payload;
    },

    setImageCurrentEditModel: (state, action: PayloadAction<AiModel>) => {
      const inst = getInstance(state);
      if (!inst) return;
      inst.aiImageForm.currentEditModel = action.payload;
    },

    setImageInstance: (
      state,
      action: PayloadAction<{ key: string; instance: ImageInstanceState }>
    ) => {
      const inst = getInstance(state);
      if (!inst) return;
      inst.aiImageForm.instances[action.payload.key] = action.payload.instance;
    },

    updateImageForm: (
      state,
      action: PayloadAction<{
        shotId: string;
        colId: string;
        updates: Partial<AiImageFormData>;
      }>
    ) => {
      const inst = getInstance(state);
      if (!inst) return;
      const key = imageInstanceKey(action.payload.shotId, action.payload.colId);
      const imgInst = inst.aiImageForm.instances[key] ?? createDefaultImageInstance();
      inst.aiImageForm.instances[key] = {
        ...imgInst,
        formData: { ...imgInst.formData, ...action.payload.updates },
      };
    },

    setImagePreview: (
      state,
      action: PayloadAction<{
        shotId: string;
        colId: string;
        item: ResultItem | null;
      }>
    ) => {
      const inst = getInstance(state);
      if (!inst) return;
      const key = imageInstanceKey(action.payload.shotId, action.payload.colId);
      const imgInst = inst.aiImageForm.instances[key] ?? createDefaultImageInstance();
      inst.aiImageForm.instances[key] = { ...imgInst, previewItem: action.payload.item };
    },

    setImageHistoryLoading: (state, action: PayloadAction<{ key: string; loading: boolean }>) => {
      const inst = getInstance(state);
      if (!inst) return;
      const imgInst =
        inst.aiImageForm.instances[action.payload.key] ?? createDefaultImageInstance();
      inst.aiImageForm.instances[action.payload.key] = {
        ...imgInst,
        historyLoading: action.payload.loading,
      };
    },

    setImageHistory: (state, action: PayloadAction<{ key: string; history: HistoryItem[] }>) => {
      const inst = getInstance(state);
      if (!inst) return;
      const imgInst =
        inst.aiImageForm.instances[action.payload.key] ?? createDefaultImageInstance();
      inst.aiImageForm.instances[action.payload.key] = {
        ...imgInst,
        history: action.payload.history,
        historyLoading: false,
      };
    },

    removeImageHistoryItem: (state, action: PayloadAction<{ key: string; itemId: string }>) => {
      const inst = getInstance(state);
      if (!inst) return;
      const imgInst = inst.aiImageForm.instances[action.payload.key];
      if (!imgInst) return;
      inst.aiImageForm.instances[action.payload.key] = {
        ...imgInst,
        history: imgInst.history.filter((h) => h.id !== action.payload.itemId),
      };
    },

    // ─── AI Video Form Reducers ──────────────────────────
    setVideoInstance: (
      state,
      action: PayloadAction<{ key: string; instance: VideoInstanceState }>
    ) => {
      const inst = getInstance(state);
      if (!inst) return;
      inst.aiVideoForm.instances[action.payload.key] = action.payload.instance;
    },

    updateVideoForm: (
      state,
      action: PayloadAction<{ key: string; updates: Partial<VideoFormData> }>
    ) => {
      const inst = getInstance(state);
      if (!inst) return;
      const vidInst =
        inst.aiVideoForm.instances[action.payload.key] ?? createDefaultVideoInstance();
      inst.aiVideoForm.instances[action.payload.key] = {
        ...vidInst,
        formData: { ...vidInst.formData, ...action.payload.updates },
      };
    },

    setVideoUploadMode: (state, action: PayloadAction<{ key: string; mode: SimpleMode }>) => {
      const inst = getInstance(state);
      if (!inst) return;
      const vidInst =
        inst.aiVideoForm.instances[action.payload.key] ?? createDefaultVideoInstance();
      inst.aiVideoForm.instances[action.payload.key] = {
        ...vidInst,
        uploadMode: action.payload.mode,
      };
    },

    setVideoEditMode: (state, action: PayloadAction<{ key: string; mode: EditMode | null }>) => {
      const inst = getInstance(state);
      if (!inst) return;
      const vidInst =
        inst.aiVideoForm.instances[action.payload.key] ?? createDefaultVideoInstance();
      inst.aiVideoForm.instances[action.payload.key] = {
        ...vidInst,
        editMode: action.payload.mode,
      };
    },

    setVideoReferences: (
      state,
      action: PayloadAction<{
        key: string;
        field: keyof VideoReferences;
        value: ReferenceAsset[] | (ReferenceAsset & { typeTag: MultiRefType })[];
      }>
    ) => {
      const inst = getInstance(state);
      if (!inst) return;
      const vidInst =
        inst.aiVideoForm.instances[action.payload.key] ?? createDefaultVideoInstance();
      inst.aiVideoForm.instances[action.payload.key] = {
        ...vidInst,
        references: {
          ...vidInst.references,
          [action.payload.field]: action.payload.value,
        },
      };
    },

    setVideoModeSettings: (
      state,
      action: PayloadAction<{ key: string; updates: Partial<VideoModeSettingsState> }>
    ) => {
      const inst = getInstance(state);
      if (!inst) return;
      const vidInst =
        inst.aiVideoForm.instances[action.payload.key] ?? createDefaultVideoInstance();
      inst.aiVideoForm.instances[action.payload.key] = {
        ...vidInst,
        modeSettings: { ...vidInst.modeSettings, ...action.payload.updates },
      };
    },

    setVideoPreview: (
      state,
      action: PayloadAction<{ key: string; item: VideoResultItem | null }>
    ) => {
      const inst = getInstance(state);
      if (!inst) return;
      const vidInst =
        inst.aiVideoForm.instances[action.payload.key] ?? createDefaultVideoInstance();
      inst.aiVideoForm.instances[action.payload.key] = {
        ...vidInst,
        previewItem: action.payload.item,
      };
    },

    setVideoHistory: (
      state,
      action: PayloadAction<{ key: string; history: VideoResultItem[] }>
    ) => {
      const inst = getInstance(state);
      if (!inst) return;
      const vidInst =
        inst.aiVideoForm.instances[action.payload.key] ?? createDefaultVideoInstance();
      inst.aiVideoForm.instances[action.payload.key] = {
        ...vidInst,
        history: action.payload.history,
        historyLoading: false,
      };
    },

    setVideoHistoryLoading: (state, action: PayloadAction<{ key: string; loading: boolean }>) => {
      const inst = getInstance(state);
      if (!inst) return;
      const vidInst =
        inst.aiVideoForm.instances[action.payload.key] ?? createDefaultVideoInstance();
      inst.aiVideoForm.instances[action.payload.key] = {
        ...vidInst,
        historyLoading: action.payload.loading,
      };
    },

    removeVideoHistoryItem: (state, action: PayloadAction<{ key: string; itemId: string }>) => {
      const inst = getInstance(state);
      if (!inst) return;
      const vidInst = inst.aiVideoForm.instances[action.payload.key];
      if (!vidInst) return;
      inst.aiVideoForm.instances[action.payload.key] = {
        ...vidInst,
        history: vidInst.history.filter((h) => h.id !== action.payload.itemId),
      };
    },

    setVideoModelsByMode: (
      state,
      action: PayloadAction<{ mode: VideoMode; models: RawAiModel[] }>
    ) => {
      const inst = getInstance(state);
      if (!inst) return;
      inst.aiVideoForm.modelsByMode[action.payload.mode] = action.payload.models;
      inst.aiVideoForm.modelsLoadedForMode[action.payload.mode] = true;
    },

    setVideoSavedModel: (state, action: PayloadAction<{ key: string; model: string }>) => {
      const inst = getInstance(state);
      if (!inst) return;
      const vidInst =
        inst.aiVideoForm.instances[action.payload.key] ?? createDefaultVideoInstance();
      inst.aiVideoForm.instances[action.payload.key] = {
        ...vidInst,
        savedModel: action.payload.model,
      };
    },

    // ─── AI Audio Form reducers ─────────────────────────

    setAudioModelsLoaded: (
      state,
      action: PayloadAction<{ models: RawAiModel[]; currentModel: RawAiModel | null }>
    ) => {
      const inst = getInstance(state);
      if (!inst) return;
      inst.aiAudioForm.models = action.payload.models;
      inst.aiAudioForm.modelsLoaded = true;
      inst.aiAudioForm.currentModel = action.payload.currentModel;
    },

    setAudioCurrentModel: (state, action: PayloadAction<RawAiModel | null>) => {
      const inst = getInstance(state);
      if (!inst) return;
      inst.aiAudioForm.currentModel = action.payload;
    },

    setAudioInstance: (
      state,
      action: PayloadAction<{ key: string; instance: AudioInstanceState }>
    ) => {
      const inst = getInstance(state);
      if (!inst) return;
      inst.aiAudioForm.instances[action.payload.key] = action.payload.instance;
    },

    updateAudioForm: (
      state,
      action: PayloadAction<{ shotId: string; colId: string; updates: Partial<AiAudioFormData> }>
    ) => {
      const inst = getInstance(state);
      if (!inst) return;
      const key = audioInstanceKey(action.payload.shotId, action.payload.colId);
      const audioInst = inst.aiAudioForm.instances[key] ?? createDefaultAudioInstance();
      inst.aiAudioForm.instances[key] = {
        ...audioInst,
        formData: { ...audioInst.formData, ...action.payload.updates },
      };
    },

    setAudioPreview: (
      state,
      action: PayloadAction<{ shotId: string; colId: string; item: ResultItem | null }>
    ) => {
      const inst = getInstance(state);
      if (!inst) return;
      const key = audioInstanceKey(action.payload.shotId, action.payload.colId);
      const audioInst = inst.aiAudioForm.instances[key] ?? createDefaultAudioInstance();
      inst.aiAudioForm.instances[key] = { ...audioInst, previewItem: action.payload.item };
    },

    setAudioHistoryLoading: (state, action: PayloadAction<{ key: string; loading: boolean }>) => {
      const inst = getInstance(state);
      if (!inst) return;
      const audioInst =
        inst.aiAudioForm.instances[action.payload.key] ?? createDefaultAudioInstance();
      inst.aiAudioForm.instances[action.payload.key] = {
        ...audioInst,
        historyLoading: action.payload.loading,
      };
    },

    setAudioHistory: (state, action: PayloadAction<{ key: string; history: HistoryItem[] }>) => {
      const inst = getInstance(state);
      if (!inst) return;
      const audioInst =
        inst.aiAudioForm.instances[action.payload.key] ?? createDefaultAudioInstance();
      inst.aiAudioForm.instances[action.payload.key] = {
        ...audioInst,
        history: action.payload.history,
        historyLoading: false,
      };
    },

    removeAudioHistoryItem: (state, action: PayloadAction<{ key: string; itemId: string }>) => {
      const inst = getInstance(state);
      if (!inst) return;
      const audioInst = inst.aiAudioForm.instances[action.payload.key];
      if (!audioInst) return;
      inst.aiAudioForm.instances[action.payload.key] = {
        ...audioInst,
        history: audioInst.history.filter((h) => h.id !== action.payload.itemId),
      };
    },
  },
});

export const {
  setProjectId,
  setWorldId,
  setRouteEpisodeId,
  setDetail,
  setLoading,
  setError,
  setActiveTab,
  setActivePanel,
  togglePanel,
  setAiPanelOpen,
  setAiPanelExpanded,
  setEpisodes,
  setActiveEpisodeId,
  setEpisodesLoading,
  updateEpisodeInStore,
  addEpisodeToStore,
  removeEpisodeFromStore,
  setColumns,
  setRows,
  setStoryboardLoading,
  setBatchGeneratingActive,
  setBatchGenerating,
  setBatchCompleted,
  clearSingleBatchCompleted,
  clearBatchGenerating,
  setWorldDetail,
  setWorldLoading,
  setCharacters,
  setCharactersLoading,
  setScenes,
  setScenesLoading,
  updateScene,
  addScene,
  removeScene,
  setProps,
  setPropsLoading,
  updateProp,
  addProp,
  removeProp,
  setProjectList,
  setProjectListLoading,
  touchProjectList,
  touchEpisodes,
  touchStoryboard,
  touchWorld,
  touchCharacters,
  touchScenes,
  touchProps,
  touchAssets,
  reset,
  // AI Image Form actions
  setImageModelsLoaded,
  setImageEditModelsLoaded,
  setImageCurrentModel,
  setImageCurrentEditModel,
  setImageInstance,
  updateImageForm,
  setImagePreview,
  setImageHistoryLoading,
  setImageHistory,
  removeImageHistoryItem,
  // AI Video Form actions
  setVideoInstance,
  updateVideoForm,
  setVideoUploadMode,
  setVideoEditMode,
  setVideoReferences,
  setVideoModeSettings,
  setVideoPreview,
  setVideoHistory,
  setVideoHistoryLoading,
  removeVideoHistoryItem,
  setVideoModelsByMode,
  setVideoSavedModel,
  // AI Audio Form actions
  setAudioModelsLoaded,
  setAudioCurrentModel,
  setAudioInstance,
  updateAudioForm,
  setAudioPreview,
  setAudioHistoryLoading,
  setAudioHistory,
  removeAudioHistoryItem,
} = projectSlice.actions;

// ─── Selectors ──────────────────────────────────────────

/**
 * Select the current project instance from the store.
 * Returns EMPTY_INSTANCE when no project is active (stable reference).
 */
export const selectCurrentInstance = (state: {
  project: ProjectSliceState;
}): ProjectInstanceState =>
  state.project.instances[state.project.currentProjectId ?? ""] ?? EMPTY_INSTANCE;

/**
 * Select the current project ID.
 */
export const selectCurrentProjectId = (state: { project: ProjectSliceState }): string | null =>
  state.project.currentProjectId;

export const selectActiveEpisode = (state: { project: ProjectSliceState }) => {
  const inst = selectCurrentInstance(state);
  return inst.episodes.find((ep) => String(ep.id) === String(inst.activeEpisodeId));
};

// ─── AI Image Form Selectors ──────────────────────────

export const selectImageInstance = (state: RootState, shotId: string, colId: string) => {
  const key = imageInstanceKey(shotId, colId);
  return selectCurrentInstance(state).aiImageForm.instances[key] ?? createDefaultImageInstance();
};

export const selectImageSizesForModel = (state: RootState, serviceCode?: string) => {
  const model = selectCurrentInstance(state).aiImageForm.models.find(
    (m) => m.serviceCode === serviceCode
  );
  if (!model) return defaultSizeOptions;
  const sizes = parseSizesFromModel(model);
  return sizes.length > 0 ? sizes : defaultSizeOptions;
};

export const selectAllImageResults = (
  state: RootState,
  shotId: string,
  colId: string
): ResultItem[] => {
  const key = imageInstanceKey(shotId, colId);
  const inst = selectCurrentInstance(state).aiImageForm.instances[key];

  // Get tasks from taskSlice
  const tasks = selectTasksByShot(state, shotId, colId);
  const taskItems: ResultItem[] = tasks.filter((t) => t.type === "image").map(taskToResultItem);

  // Get history items
  const historyItems: ResultItem[] = inst?.history ?? [];

  // Dedup: remove history items that share storagePath with completed task items
  const taskPaths = new Set(taskItems.map((t) => t.storagePath).filter(Boolean));
  const dedupedHistory = historyItems.filter(
    (h) => !h.storagePath || !taskPaths.has(h.storagePath)
  );

  return [...taskItems, ...dedupedHistory];
};

// ─── AI Video Form Selectors ──────────────────────────

const EMPTY_VIDEO_INSTANCE = createDefaultVideoInstance();
const EMPTY_VIDEO_RESULTS: VideoResultItem[] = [];
const EMPTY_VIDEO_HISTORY: VideoResultItem[] = [];

export const selectVideoInstance = (
  state: RootState,
  shotId: string,
  colId: string
): VideoInstanceState => {
  const key = videoInstanceKey(shotId, colId);
  return selectCurrentInstance(state).aiVideoForm.instances[key] ?? EMPTY_VIDEO_INSTANCE;
};

export const selectVideoInstanceKey = (shotId: string, colId: string) =>
  videoInstanceKey(shotId, colId);

export const makeSelectAllVideoResults = () => {
  const selectShotTasks = makeSelectTasksByShot();
  return createSelector(
    [
      (state: RootState, shotId: string, colId: string) => {
        const key = videoInstanceKey(shotId, colId);
        return (
          selectCurrentInstance(state).aiVideoForm.instances[key]?.history ?? EMPTY_VIDEO_HISTORY
        );
      },
      (state: RootState, shotId: string, colId: string) => selectShotTasks(state, shotId, colId),
    ],
    (history, tasks): VideoResultItem[] => {
      // Tasks from taskSlice (both local + server-synced)
      const taskItems = tasks.filter((t) => t.type === "video").map(taskToVideoResultItem);

      if (taskItems.length === 0 && history.length === 0) return EMPTY_VIDEO_RESULTS;

      // Dedup history against tasks by storagePath and id
      const taskPaths = new Set(taskItems.map((t) => t.storagePath).filter(Boolean));
      const taskIds = new Set(taskItems.map((t) => t.id));
      const dedupedHistory = history.filter(
        (h) => (!h.storagePath || !taskPaths.has(h.storagePath)) && !taskIds.has(h.id)
      );

      return [...taskItems, ...dedupedHistory];
    }
  );
};

export const selectAllVideoResults = (
  state: RootState,
  shotId: string,
  colId: string
): VideoResultItem[] => makeSelectAllVideoResults()(state, shotId, colId);

// ─── AI Audio Form Selectors ──────────────────────────

export const selectAudioInstance = (state: RootState, shotId: string, colId: string) => {
  const key = audioInstanceKey(shotId, colId);
  return selectCurrentInstance(state).aiAudioForm.instances[key] ?? null;
};

const EMPTY_AUDIO_HISTORY: ResultItem[] = [];
const EMPTY_AUDIO_RESULTS: ResultItem[] = [];

export const makeSelectAllAudioResults = () => {
  const selectShotTasks = makeSelectTasksByShot();
  return createSelector(
    [
      (state: RootState, shotId: string, colId: string) => {
        const key = audioInstanceKey(shotId, colId);
        return (
          selectCurrentInstance(state).aiAudioForm.instances[key]?.history ?? EMPTY_AUDIO_HISTORY
        );
      },
      (state: RootState, shotId: string, colId: string) => selectShotTasks(state, shotId, colId),
    ],
    (history, tasks): ResultItem[] => {
      const taskItems: ResultItem[] = tasks.filter((t) => t.type === "audio").map(taskToResultItem);
      const historyItems: ResultItem[] = history.map((h) => ({ ...h, fromHistory: true }));

      if (taskItems.length === 0 && historyItems.length === 0) return EMPTY_AUDIO_RESULTS;

      const taskPaths = new Set(taskItems.map((t) => t.storagePath).filter(Boolean));
      const dedupedHistory = historyItems.filter(
        (h) => !h.storagePath || !taskPaths.has(h.storagePath)
      );

      return [...taskItems, ...dedupedHistory];
    }
  );
};

export const selectAllAudioResults = (
  state: RootState,
  shotId: string,
  colId: string
): ResultItem[] => makeSelectAllAudioResults()(state, shotId, colId);
