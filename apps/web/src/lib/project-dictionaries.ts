import { backendApi } from "@/src/lib/api";
import type { ProjectDictionaries } from "@/src/types/workspace";

let _dictionariesCache: Promise<ProjectDictionaries> | null = null;

export function fetchProjectDictionaries(): Promise<ProjectDictionaries> {
  if (_dictionariesCache) return _dictionariesCache;
  _dictionariesCache = _fetchProjectDictionaries().catch((err) => {
    _dictionariesCache = null; // 失败时清缓存，允许重试
    throw err;
  });
  return _dictionariesCache;
}

async function _fetchProjectDictionaries(): Promise<ProjectDictionaries> {
  // These three Java endpoints require a trailing slash, which Next.js 16's
  // `rewrites()` normalizes away. We route through the Nest proxy instead
  // (apps/server/.../dictionaries.controller.ts) which preserves the URL
  // exactly when forwarding to Java.
  const [typeMapResult, styleOptionsResult, sizeMetaResult] = await Promise.allSettled([
    backendApi.get<Record<string, string>>("/aurora/dictionaries/product-types"),
    backendApi.get<Array<{ id?: string | number; info?: string; picLink?: string }>>(
      "/aurora/dictionaries/painting-styles"
    ),
    backendApi.get<{ AspectRatioTypeEnum?: Record<string, string> }>(
      "/aurora/dictionaries/aspect-ratios"
    ),
  ]);

  const typeMap = typeMapResult.status === "fulfilled" ? typeMapResult.value : {};
  const styleOptions = styleOptionsResult.status === "fulfilled" ? styleOptionsResult.value : [];
  const sizeMeta =
    sizeMetaResult.status === "fulfilled" ? sizeMetaResult.value : { AspectRatioTypeEnum: {} };

  if (typeMapResult.status === "rejected") {
    console.error("[project-dictionaries] 加载项目类型字典失败:", typeMapResult.reason);
  }

  if (styleOptionsResult.status === "rejected") {
    console.error("[project-dictionaries] 加载画风字典失败:", styleOptionsResult.reason);
  }

  if (sizeMetaResult.status === "rejected") {
    console.error("[project-dictionaries] 加载视频尺寸字典失败:", sizeMetaResult.reason);
  }

  if (
    typeMapResult.status === "rejected" &&
    styleOptionsResult.status === "rejected" &&
    sizeMetaResult.status === "rejected"
  ) {
    throw new Error("项目字典全部加载失败");
  }

  return {
    typeOptions: Object.entries(typeMap ?? {}).map(([value, label]) => ({
      label,
      value: Number(value),
    })),
    styleOptions: (styleOptions ?? []).map((item) => ({
      id: String(item.id ?? ""),
      info: item.info,
      picLink: item.picLink,
    })),
    sizeOptions: Object.entries(sizeMeta?.AspectRatioTypeEnum ?? {}).map(([value, label]) => ({
      label,
      value,
    })),
  };
}
