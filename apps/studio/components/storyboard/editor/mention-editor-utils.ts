import { backendApi, type Paginated } from "@/src/lib/api";
import type { Asset } from "@/src/store/slices/projectSlice";

export interface MentionSearchCharacter {
  id: string;
  name: string;
  images: string[];
  voiceId?: string;
  model?: string;
}

export interface MentionSearchItem {
  id: string;
  name: string;
  imgUrl?: string;
}

export interface MentionFlatItem {
  key: string;
  id: string;
  name: string;
  mentionType: import("./mention-node").MentionType;
  imgUrl?: string;
  voiceId?: string;
  model?: string;
}

export const OSS_BASE = process.env.NEXT_PUBLIC_OSS_BASE_URL ?? "";
export const PAGE_SIZE = 50;
export const DEFAULT_POPOVER_WIDTH = 520;
export const POPOVER_MARGIN = 12;

export function fetchAssetList(
  entityType: "role" | "scene" | "prop",
  worldId: string,
  params?: { page?: number; pageSize?: number; name?: string }
) {
  const base = { worldId, page: params?.page ?? 1, pageSize: params?.pageSize ?? 20 };
  const endpoints: Record<string, { list: string; search: string }> = {
    role: { list: "/api/user/world/list/worldrole", search: "/api/user/world/search/worldrole" },
    scene: { list: "/api/user/world/list/worldscene", search: "/api/user/world/search/worldscene" },
    prop: { list: "/api/user/world/list/worldprop", search: "/api/user/world/search/worldprop" },
  };
  const ep = endpoints[entityType];
  if (params?.name?.trim()) {
    return backendApi.post<Paginated<Asset>>(ep.search, {
      data: { ...base, name: params.name.trim() },
    });
  }
  return backendApi.post<Paginated<Asset>>(ep.list, { data: base });
}

export function ossUrl(path?: string) {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("blob:")) {
    return path;
  }
  return `${OSS_BASE}/${path}`;
}

export function parseOtherImgPath(value: Asset["otherImgPath"]) {
  if (!value) return [];
  try {
    const parsed =
      typeof value === "string" ? (JSON.parse(value) as Record<string, string>) : value;
    if (!parsed || typeof parsed !== "object") return [];
    return Object.values(parsed).filter((path): path is string => Boolean(path));
  } catch {
    return [];
  }
}

export function getStringField(asset: Asset, field: "voiceId" | "model") {
  const value = asset[field];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export function getCharacterImages(asset: Asset) {
  const images = [
    ...(asset.roleImgPath?.map((path) => ossUrl(path)) ?? []),
    ...parseOtherImgPath(asset.otherImgPath).map((path) => ossUrl(path)),
  ].filter(Boolean);

  return images.length > 0 ? images : [""];
}
