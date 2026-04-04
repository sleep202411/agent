import type { Asset } from "@/src/store/slices/projectSlice";

const OSS_BASE = process.env.NEXT_PUBLIC_OSS_BASE_URL ?? "";

export function ossUrl(path?: string): string | null {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  return `${OSS_BASE}/${path}`;
}

export function toArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item ?? "").trim()).filter(Boolean) : [];
}

export function normalizeSceneName(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export type ScenePanelItem = Asset & {
  description?: string;
  prompt?: string;
  referenceImgPath?: string[];
  panoramaImagePath?: string;
  __panelKey: string;
  __source: "world" | "asset";
  aiId?: string;
};

export function normalizeSceneItem(
  raw: Asset,
  index: number,
  source: "world" | "asset"
): ScenePanelItem {
  const name = String(
    raw.name ?? raw.slugline ?? raw.scene_name ?? raw.sceneName ?? raw.label ?? ""
  ).trim();
  const aiId = String(raw.aiId ?? raw.scene_set_id ?? raw.sceneSetId ?? raw.scene_id ?? "").trim();
  const fallbackKey = aiId || normalizeSceneName(name) || String(index);

  return {
    ...raw,
    id: raw.id ? String(raw.id) : "",
    name,
    description: String(raw.description ?? raw.sceneDescription ?? raw.desc ?? ""),
    prompt: String(raw.prompt ?? raw.scenePrompt ?? ""),
    sceneImgPath: toArray(raw.sceneImgPath ?? raw.scene_img_path ?? raw.images),
    referenceImgPath: toArray(raw.referenceImgPath ?? raw.reference_img_path),
    panoramaImagePath: String(raw.panoramaImagePath ?? raw.panorama_image_path ?? ""),
    aiId,
    __source: source,
    __panelKey: source === "world" && raw.id ? `world:${raw.id}` : `asset:${fallbackKey}`,
  };
}

export function mergeScenes(worldScenes: ScenePanelItem[], assetScenes: ScenePanelItem[]) {
  const merged: ScenePanelItem[] = [];
  const sceneIndexMap = new Map<string, number>();

  const pushScene = (scene: ScenePanelItem) => {
    const keys = [
      normalizeSceneName(scene.aiId),
      normalizeSceneName(scene.id),
      normalizeSceneName(scene.name),
    ].filter(Boolean);

    const existingKey = keys.find((key) => sceneIndexMap.has(key));
    if (existingKey) {
      const targetIndex = sceneIndexMap.get(existingKey)!;
      const current = merged[targetIndex];
      const next: ScenePanelItem = {
        ...current,
        ...scene,
        description: current.description || scene.description,
        prompt: current.prompt || scene.prompt,
        sceneImgPath:
          Array.isArray(current.sceneImgPath) && current.sceneImgPath.length
            ? current.sceneImgPath
            : scene.sceneImgPath,
        referenceImgPath:
          Array.isArray(current.referenceImgPath) && current.referenceImgPath.length
            ? current.referenceImgPath
            : scene.referenceImgPath,
        panoramaImagePath: current.panoramaImagePath || scene.panoramaImagePath,
        __source: current.id ? "world" : scene.__source,
      };
      merged[targetIndex] = next;
      keys.forEach((key) => sceneIndexMap.set(key, targetIndex));
      return;
    }

    const nextIndex = merged.length;
    merged.push(scene);
    keys.forEach((key) => sceneIndexMap.set(key, nextIndex));
  };

  worldScenes.forEach(pushScene);
  assetScenes.forEach(pushScene);

  return merged;
}
