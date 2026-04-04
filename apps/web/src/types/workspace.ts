import type { ProjectDetail } from "@/src/store/slices/projectSlice";

export type WorkspaceTab = "script" | "storyboard" | "timeline";

export type WorkspacePanelKey =
  | "projects"
  | "episodes"
  | "characters"
  | "scenes"
  | "props"
  | "editWorld"
  | "myAssets"
  | "music"
  | "inspiration"
  | "aiAssistant";

export interface ProjectListParams {
  worldId: string;
  page?: number;
  pageSize?: number;
  name?: string;
}

export interface ProjectOptionItem extends ProjectDetail {
  id?: string;
  name?: string;
  imagePath?: string;
  chapterLength?: number;
}

export interface IntegralRecord {
  id?: string;
  recordType?: string;
  integralChange?: number;
  integralCost?: number;
  createTime?: string;
  serviceCode?: string;
  [key: string]: unknown;
}

export type { RawAiModel } from "@/src/lib/ai-model-schema";

export interface VoiceOptionItem {
  voiceId?: string;
  voiceName?: string;
  voiceDescription?: string;
  voicePath?: string;
  [key: string]: unknown;
}

export interface V1ProjectMember {
  id?: string;
  account?: string;
  email?: string;
  nickname?: string;
  role?: number;
  [key: string]: unknown;
}

export interface Comment {
  id?: string;
  content?: string;
  createTime?: string;
  userId?: string;
  nickname?: string;
  imagePaths?: string[];
  replies?: Comment[];
  [key: string]: unknown;
}

export interface AssetRecord {
  id?: string;
  path?: string;
  url?: string;
  filePath?: string;
  storagePath?: string;
  name?: string;
  type?: string;
  createTime?: string;
  other?: string;
  [key: string]: unknown;
}

export interface FileDetail {
  id?: string;
  name?: string;
  prompt?: string;
  type?: string;
  width?: number;
  height?: number;
  size?: number;
  updateTime?: string;
  createTime?: string;
  userName?: string;
  nickname?: string;
  userAvatarImagePath?: string;
  [key: string]: unknown;
}

export type AssetRecordSource = "all" | "local" | "ai";
export type AssetRecordType = "img" | "video" | "audio";

export interface V1MessageItem {
  id?: string;
  category?: string;
  type?: string;
  status?: string;
  handleStatus?: string;
  title?: string;
  content?: string;
  createTime?: string;
  projectId?: string;
  redirectUrl?: string;
  operationParams?: string;
  [key: string]: unknown;
}

export interface ProjectDictionaries {
  typeOptions: Array<{ label: string; value: number }>;
  styleOptions: Array<{ id: string; info?: string; picLink?: string }>;
  sizeOptions: Array<{ label: string; value: string }>;
}

export interface StoryboardImportResult {
  headers: string[];
  rows: string[][];
}

export type ImportEntityType = "role" | "scene" | "prop";

export interface PipelineEvent {
  type?: string;
  content?: string;
  fullText?: string;
  result?: unknown;
  step?: string;
  stepIndex?: number;
  totalSteps?: number;
  results?: Record<string, unknown>;
  error?: string;
  message?: string;
  [key: string]: unknown;
}
