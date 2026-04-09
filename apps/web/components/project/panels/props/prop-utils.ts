import type { Asset } from "@/src/store/slices/projectSlice";
import { env } from "@/src/env";

const OSS_BASE = env.OSS_BASE_URL;

export function ossUrl(path?: string): string | null {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  return `${OSS_BASE}/${path}`;
}

export function toArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item ?? "").trim()).filter(Boolean) : [];
}

export function normalizePropName(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export type PropPanelItem = Asset & {
  description?: string;
  prompt?: string;
  referenceImgPath?: string[];
  threeViewsImagePath?: string;
  __panelKey: string;
  __source: "world" | "asset";
  aiId?: string;
};

export function normalizePropItem(
  raw: Asset,
  index: number,
  source: "world" | "asset"
): PropPanelItem {
  const name = String(raw.name ?? raw.prop_name ?? raw.propName ?? raw.label ?? "").trim();
  const aiId = String(raw.aiId ?? raw.prop_set_id ?? raw.propSetId ?? raw.prop_id ?? "").trim();
  const fallbackKey = aiId || normalizePropName(name) || String(index);

  return {
    ...raw,
    id: raw.id ? String(raw.id) : "",
    name,
    description: String(raw.description ?? raw.propDescription ?? raw.desc ?? ""),
    prompt: String(raw.prompt ?? raw.propPrompt ?? ""),
    propImgPath: toArray(raw.propImgPath ?? raw.prop_img_path ?? raw.images),
    referenceImgPath: toArray(raw.referenceImgPath ?? raw.reference_img_path),
    threeViewsImagePath: String(raw.threeViewsImagePath ?? raw.three_views_image_path ?? ""),
    aiId,
    __source: source,
    __panelKey: source === "world" && raw.id ? `world:${raw.id}` : `asset:${fallbackKey}`,
  };
}

export function mergeProps(worldProps: PropPanelItem[], assetProps: PropPanelItem[]) {
  const merged: PropPanelItem[] = [];
  const propIndexMap = new Map<string, number>();

  const pushProp = (prop: PropPanelItem) => {
    const keys = [
      normalizePropName(prop.aiId),
      normalizePropName(prop.id),
      normalizePropName(prop.name),
    ].filter(Boolean);

    const existingKey = keys.find((key) => propIndexMap.has(key));
    if (existingKey) {
      const targetIndex = propIndexMap.get(existingKey)!;
      const current = merged[targetIndex];
      const next: PropPanelItem = {
        ...current,
        ...prop,
        description: current.description || prop.description,
        prompt: current.prompt || prop.prompt,
        propImgPath:
          Array.isArray(current.propImgPath) && current.propImgPath.length
            ? current.propImgPath
            : prop.propImgPath,
        referenceImgPath:
          Array.isArray(current.referenceImgPath) && current.referenceImgPath.length
            ? current.referenceImgPath
            : prop.referenceImgPath,
        threeViewsImagePath: current.threeViewsImagePath || prop.threeViewsImagePath,
        __source: current.id ? "world" : prop.__source,
      };
      merged[targetIndex] = next;
      keys.forEach((key) => propIndexMap.set(key, targetIndex));
      return;
    }

    const nextIndex = merged.length;
    merged.push(prop);
    keys.forEach((key) => propIndexMap.set(key, nextIndex));
  };

  worldProps.forEach(pushProp);
  assetProps.forEach(pushProp);

  return merged;
}
