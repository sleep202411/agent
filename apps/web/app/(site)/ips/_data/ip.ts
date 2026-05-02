/**
 * IP feature dictionaries (form options + suggested tags). Detail-page
 * rendering types now live inside `[id]/page.tsx`; hook return types
 * live in `_hooks/types.ts`.
 */

export const PROJECT_TYPES = [
  "ipDevelopment",
  "series",
  "brandShort",
  "commercial",
  "creativeExperiment",
] as const;

export const SUGGESTED_TAGS = [
  "AI动画",
  "AI绘画",
  "赛博朋克",
  "奇幻",
  "科幻",
  "日常",
  "动作",
  "悬疑",
  "治愈",
  "国风",
  "机甲",
  "末日",
  "校园",
  "恋爱",
] as const;
