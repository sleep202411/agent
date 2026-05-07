"use client";

import { backendApi, type Paginated } from "@/src/lib/api";
import { normalizeStoragePath, ossUrl } from "@/src/lib/asset-paths";
import type { Asset, Episode, ShotColumn, ShotRow } from "@/src/store/slices/projectSlice";

export type ProduceJavaAssetKind = "character" | "scene" | "prop";

export interface ProduceJavaAsset {
  kind: ProduceJavaAssetKind;
  id: string;
  name: string;
  description: string;
  prompt: string;
  imagePaths: string[];
  referenceImagePaths: string[];
  raw: Record<string, unknown>;
}

export interface ProduceJavaAssetLists {
  character: ProduceJavaAsset[];
  scene: ProduceJavaAsset[];
  prop: ProduceJavaAsset[];
}

export interface ProduceJavaEpisode {
  id: string;
  no: number;
  title: string;
  synopsis: string;
  sort: number;
  shotCount: number | null;
  raw: Episode;
}

export type ProduceShotColumnType =
  | "shot_no"
  | "image"
  | "video"
  | "richtext"
  | "dialogue"
  | "duration"
  | "character"
  | "scene"
  | "select"
  | "text";

export type ProduceShotColumn = Omit<ShotColumn, "id" | "resolvedType"> & {
  id: string;
  resolvedType: ProduceShotColumnType;
};

const PAGE_SIZE = 200;
const MAX_ASSET_IMAGES = 6;
const ASSET_COLUMN_ID: Record<ProduceJavaAssetKind, number> = {
  character: -1,
  scene: -3,
  prop: -2,
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string {
  return String(value ?? "").trim();
}

function arrayStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeStoragePath(String(item ?? ""))).filter(Boolean);
}

function objectValue(value: unknown): Record<string, string> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return objectValue(JSON.parse(value) as unknown);
    } catch {
      return {};
    }
  }
  if (typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, stringValue(item)])
      .filter(([, item]) => item)
  );
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = stringValue(value);
    if (text) return text;
  }
  return "";
}

async function loadAllPages<T>(path: string, data: Record<string, unknown>): Promise<T[]> {
  const all: T[] = [];
  let page = 1;
  let totalCount: number | undefined;

  for (;;) {
    const response = await backendApi.post<Paginated<T>>(path, {
      data: { ...data, page, pageSize: PAGE_SIZE },
    });
    const list = Array.isArray(response?.list) ? response.list : [];
    all.push(...list);
    totalCount = typeof response?.totalCount === "number" ? response.totalCount : totalCount;
    if (list.length < PAGE_SIZE) break;
    if (typeof totalCount === "number" && all.length >= totalCount) break;
    page += 1;
  }

  return all;
}

function normalizeRole(rawInput: Asset | Record<string, unknown>): ProduceJavaAsset {
  const raw = asRecord(rawInput);
  const name = firstText(raw.name, raw.characterName, raw.character_name);
  return {
    kind: "character",
    id: stringValue(raw.id),
    name,
    description: firstText(raw.description, raw.desc),
    prompt: firstText(
      raw.prompt,
      raw.aiPrompt,
      raw.ai_prompt,
      raw.imagePromptPortrait,
      raw.image_prompt_portrait
    ),
    imagePaths: arrayStrings(raw.roleImgPath ?? raw.role_img_path ?? raw.images),
    referenceImagePaths: arrayStrings(raw.referenceImgPath ?? raw.reference_img_path),
    raw,
  };
}

function normalizeScene(rawInput: Asset | Record<string, unknown>): ProduceJavaAsset {
  const raw = asRecord(rawInput);
  const name = firstText(raw.name, raw.slugline, raw.sceneName, raw.scene_name, raw.label);
  return {
    kind: "scene",
    id: stringValue(raw.id),
    name,
    description: firstText(raw.description, raw.sceneDescription, raw.desc),
    prompt: firstText(raw.prompt, raw.scenePrompt),
    imagePaths: arrayStrings(raw.sceneImgPath ?? raw.scene_img_path ?? raw.images),
    referenceImagePaths: arrayStrings(raw.referenceImgPath ?? raw.reference_img_path),
    raw,
  };
}

function normalizeProp(rawInput: Asset | Record<string, unknown>): ProduceJavaAsset {
  const raw = asRecord(rawInput);
  const name = firstText(raw.name, raw.propName, raw.prop_name, raw.label);
  return {
    kind: "prop",
    id: stringValue(raw.id),
    name,
    description: firstText(raw.description, raw.propDescription, raw.desc),
    prompt: firstText(raw.prompt, raw.propPrompt),
    imagePaths: arrayStrings(raw.propImgPath ?? raw.prop_img_path ?? raw.images),
    referenceImagePaths: arrayStrings(raw.referenceImgPath ?? raw.reference_img_path),
    raw,
  };
}

export async function loadProjectWorldId(projectId: string): Promise<string> {
  const detail = await backendApi.post<Record<string, unknown>>(
    `/api/user/project/detail/${projectId}`
  );
  return stringValue(detail?.worldId);
}

export async function loadProduceJavaAssets(worldId: string): Promise<ProduceJavaAssetLists> {
  if (!worldId) return { character: [], scene: [], prop: [] };
  const [roles, scenes, props] = await Promise.all([
    loadAllPages<Asset>("/api/user/world/list/worldrole", { worldId }),
    loadAllPages<Asset>("/api/user/world/list/worldscene", { worldId }),
    loadAllPages<Asset>("/api/user/world/list/worldprop", { worldId }),
  ]);

  return {
    character: roles.map(normalizeRole).filter((item) => item.id && item.name),
    scene: scenes.map(normalizeScene).filter((item) => item.id && item.name),
    prop: props.map(normalizeProp).filter((item) => item.id && item.name),
  };
}

export async function generateProduceAssetImagePath(asset: ProduceJavaAsset): Promise<string> {
  const prompt = asset.prompt || asset.description || asset.name;
  if (!asset.id || !prompt.trim()) {
    throw new Error("缺少资产 ID 或提示词。");
  }

  const referencePath = asset.imagePaths[0] ?? asset.referenceImagePaths[0] ?? "";
  const generated = await backendApi.post<string>("/api/ai/image/generate/basic", {
    data: {
      prompt,
      shotId: asset.id,
      shotColumnId: ASSET_COLUMN_ID[asset.kind],
      referenceImageUrl: referencePath ? ossUrl(referencePath) : undefined,
      watermark: false,
    },
    timeout: 360_000,
  });
  const generatedPath = normalizeStoragePath(String(generated ?? ""));
  if (!generatedPath) {
    throw new Error("生图接口未返回有效图片路径。");
  }
  return generatedPath;
}

export async function persistProduceAssetImagePath(
  worldId: string,
  asset: ProduceJavaAsset,
  generatedPath: string
): Promise<ProduceJavaAsset> {
  if (!worldId || !asset.id || !generatedPath) {
    throw new Error("缺少 worldId、资产 ID 或图片路径。");
  }

  const nextImages = [
    generatedPath,
    ...asset.imagePaths.filter((path) => normalizeStoragePath(path) !== generatedPath),
  ].slice(0, MAX_ASSET_IMAGES);

  if (asset.kind === "character") {
    await backendApi.post("/api/user/world/update/worldrole", {
      data: {
        ...asset.raw,
        id: asset.id,
        name: asset.name,
        description: asset.description,
        prompt: asset.prompt,
        aiPrompt: asset.prompt,
        ai_prompt: asset.prompt,
        imagePromptPortrait: asset.prompt,
        image_prompt_portrait: asset.prompt,
        promptPortrait: asset.prompt,
        prompt_portrait: asset.prompt,
        roleImgPath: nextImages,
        otherImgPath: objectValue(asset.raw.otherImgPath),
        referenceImgPath: asset.referenceImagePaths,
        referenceImgDescription: arrayStrings(asset.raw.referenceImgDescription),
        threeViewsImagePath: stringValue(asset.raw.threeViewsImagePath),
        worldId,
      },
    });
  } else if (asset.kind === "scene") {
    await backendApi.post("/api/user/world/update/worldscene", {
      data: {
        ...asset.raw,
        id: asset.id,
        name: asset.name,
        description: asset.description,
        prompt: asset.prompt,
        sceneImgPath: nextImages,
        referenceImgPath: asset.referenceImagePaths,
        panoramaImagePath: stringValue(asset.raw.panoramaImagePath),
        worldId,
      },
    });
  } else {
    await backendApi.post("/api/user/world/update/worldprop", {
      data: {
        ...asset.raw,
        id: asset.id,
        name: asset.name,
        description: asset.description,
        prompt: asset.prompt,
        propImgPath: nextImages,
        referenceImgPath: asset.referenceImagePaths,
        threeViewsImagePath: stringValue(asset.raw.threeViewsImagePath),
        worldId,
      },
    });
  }

  return { ...asset, imagePaths: nextImages };
}

export async function generateAndPersistAssetImage(
  worldId: string,
  asset: ProduceJavaAsset
): Promise<ProduceJavaAsset> {
  const generatedPath = await generateProduceAssetImagePath(asset);
  return persistProduceAssetImagePath(worldId, asset, generatedPath);
}

export async function loadProduceJavaEpisodes(projectId: string): Promise<ProduceJavaEpisode[]> {
  const response = await backendApi.post<Paginated<Episode>>("/api/user/world/list/episode", {
    data: { productId: projectId, page: 1, pageSize: 200 },
  });
  const list = Array.isArray(response?.list) ? response.list : [];
  return list
    .map((episode, index) => {
      const sort = Number(episode.sort ?? index + 1);
      return {
        id: stringValue(episode.id),
        no: index + 1,
        title: firstText(episode.title, episode.name, `第 ${index + 1} 集`),
        synopsis: firstText(episode.summary, episode.description, episode.content),
        sort: Number.isFinite(sort) ? sort : index + 1,
        shotCount: null,
        raw: episode,
      };
    })
    .filter((episode) => episode.id)
    .sort((a, b) => a.sort - b.sort);
}

/**
 * Fetches the script content for a single episode via Java's
 * `/api/user/project/scripts/episode/detail/{episodeId}` endpoint.
 *
 * Java stores the script as TipTap-style HTML (or a similar rich
 * text envelope). We strip tags here so callers can render it as
 * plain prose; if a downstream view needs the rich form, expose
 * the raw response separately.
 */
export interface ProduceEpisodeScriptDetail {
  episodeId: string;
  content: string;
  /** Raw response from Java in case callers need fields we haven't
   *  surfaced yet (lastUpdatedAt, version, etc.). */
  raw: Record<string, unknown>;
}

export async function loadProduceEpisodeScript(
  episodeId: string
): Promise<ProduceEpisodeScriptDetail> {
  const data = await backendApi.post<Record<string, unknown>>(
    `/api/user/project/scripts/episode/detail/${encodeURIComponent(episodeId)}`,
    { data: {} }
  );
  // Java may return the script under a few different keys depending
  // on which path produced it (produce pipeline / chat save / manual
  // edit). Pick the first non-empty string field that looks like
  // script content; fall back to nothing rather than guessing.
  const candidates = ["content", "script", "scriptContent", "html"];
  let raw = "";
  for (const key of candidates) {
    const value = data?.[key];
    if (typeof value === "string" && value.trim()) {
      raw = value;
      break;
    }
  }
  return { episodeId, content: scriptContentToPlain(raw), raw: data ?? {} };
}

function scriptContentToPlain(input: string): string {
  if (!input) return "";
  // The save side wraps each line in a <p> tag. Reverse that here so
  // the UI can render line-by-line without relying on a sanitiser.
  // Other tags get stripped for the plain readout.
  return input
    .replace(/<\/p>\s*<p[^>]*>/g, "\n")
    .replace(/<p[^>]*>/g, "")
    .replace(/<\/p>/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

export async function loadEpisodeShotCount(episodeId: string): Promise<number> {
  const response = await backendApi.post<Paginated<ShotRow>>("/api/user/shot/queryPage", {
    data: {
      storyBoardId: episodeId,
      page: 1,
      pageSize: 1,
      shotIds: [],
      presetColumnKeys: [],
    },
  });
  if (typeof response?.totalCount === "number") return response.totalCount;
  return Array.isArray(response?.list) ? response.list.length : 0;
}

function resolveProduceShotColumn(column: ShotColumn): ProduceShotColumn {
  const preset = String(column.presetColumnKey ?? "").toLowerCase();
  const type = String(column.columnType ?? "").toLowerCase();
  let resolvedType: ProduceShotColumnType = "text";

  if (preset === "shot_no") resolvedType = "shot_no";
  else if (preset === "image_path") resolvedType = "image";
  else if (preset === "video_path" || preset === "video_path_lip_sync") resolvedType = "video";
  else if (preset === "dialogue") resolvedType = "dialogue";
  else if (preset === "duration") resolvedType = "duration";
  else if (preset === "character") resolvedType = "character";
  else if (preset === "scene") resolvedType = "scene";
  else if (["shot_size", "perspective", "movement", "status"].includes(preset)) {
    resolvedType = "select";
  } else if (["description", "image_prompt", "video_prompt", "style_planting"].includes(preset)) {
    resolvedType = "richtext";
  } else if (type === "image") resolvedType = "image";
  else if (type === "video") resolvedType = "video";
  else if (type === "rich_text" || type === "richtext") resolvedType = "richtext";
  else if (type === "single_option" || type === "select") resolvedType = "select";
  else if (type === "character") resolvedType = "character";
  else if (type === "scene") resolvedType = "scene";

  return {
    ...column,
    id: String(column.id ?? ""),
    resolvedType,
  };
}

export async function loadProduceStoryboard(episodeId: string): Promise<{
  columns: ProduceShotColumn[];
  rows: ShotRow[];
}> {
  const [columnsData, shotsData] = await Promise.all([
    backendApi.post<ShotColumn[]>("/api/user/shotColumn/list", {
      data: { storyBoardId: episodeId },
    }),
    backendApi.post<Paginated<ShotRow>>("/api/user/shot/queryPage", {
      data: {
        storyBoardId: episodeId,
        page: 1,
        pageSize: 200,
        shotIds: [],
        presetColumnKeys: [],
      },
    }),
  ]);

  const columns = (Array.isArray(columnsData) ? columnsData : [])
    .map(resolveProduceShotColumn)
    .filter((column) => column.id && !column.hide)
    .sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0));
  const rows = shotsData?.list ?? [];
  return { columns, rows };
}

export async function saveProduceShotTextCell(
  shotId: string,
  shotColumnId: string,
  value: string
): Promise<void> {
  await backendApi.post("/api/user/shotValue/input", {
    data: { shotId, shotColumnId, value },
  });
}

export async function saveProduceShotValuesCell(
  shotId: string,
  shotColumnId: string,
  values: string[]
): Promise<void> {
  await backendApi.post("/api/user/shotValue/input", {
    data: { shotId, shotColumnId, value: "", values },
  });
}

export async function generateProduceShotVideo(params: {
  shotId: string;
  shotColumnId: string;
  prompt: string;
  startImagePath?: string;
  videoLength?: string;
}): Promise<void> {
  await backendApi.post("/api/ai/task/video/generate/basic", {
    data: {
      shotId: params.shotId,
      shotColumnId: params.shotColumnId,
      prompt: params.prompt,
      startImageUrl: params.startImagePath ? ossUrl(params.startImagePath) : undefined,
      videoLength: params.videoLength || undefined,
    },
    timeout: 60_000,
  });
}
