import { backendApi } from "@/src/lib/api";
import type { ProjectDictionaries } from "@/src/types/workspace";

export async function fetchProjectDictionaries(signal?: AbortSignal): Promise<ProjectDictionaries> {
  signal?.throwIfAborted();
  // Product-types and painting-styles still require a trailing slash on the
  // Java endpoint, which Next.js 16's `rewrites()` normalizes away — those
  // two route through the Nest proxy (apps/server/.../dictionaries.controller.ts).
  // `aspect-ratios` had its trailing slash removed on the Java side, so we
  // call `/anon/...` directly through the Next rewrite.
  const [typeMapResult, styleOptionsResult, sizeMetaResult] = await Promise.allSettled([
    backendApi.get<Record<string, string>>("/aurora/dictionaries/product-types", { signal }),
    backendApi.get<Array<{ id?: string | number; info?: string; picLink?: string }>>(
      "/aurora/dictionaries/painting-styles",
      { signal }
    ),
    backendApi.get<{ AspectRatioTypeEnum?: Record<string, string> }>(
      "/anon/enumMeta/getEnumBySimpleName/AspectRatioTypeEnum",
      { signal }
    ),
  ]);

  signal?.throwIfAborted();

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
    throw new Error("Failed to load all project dictionaries");
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
