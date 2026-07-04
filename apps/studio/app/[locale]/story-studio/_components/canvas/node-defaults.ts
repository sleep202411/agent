import type { NarrativeNodeData, NarrativeNodeKind } from "./types";

export const NODE_LIBRARY: Array<{ kind: NarrativeNodeKind; title: string }> = [
  { kind: "storyRoot", title: "故事总纲" },
  { kind: "plot", title: "剧情节点" },
  { kind: "role", title: "角色" },
  { kind: "clue", title: "线索" },
  { kind: "ending", title: "结局" },
  { kind: "video", title: "视频" },
  { kind: "item", title: "道具" },
];

export function nodeDefaults(kind: NarrativeNodeKind, index: number): NarrativeNodeData {
  const title = NODE_LIBRARY.find((item) => item.kind === kind)?.title ?? "故事节点";

  const base: NarrativeNodeData = {
    kind,
    eyebrow: title,
    label: `${title} ${index}`,
    summary: "新的画布节点，等待创作者或 Agent 填充内容。",
    status: "working",
    chips: ["草稿", "未连接", "待审阅"],
  };

  if (kind === "storyRoot") {
    return {
      ...base,
      storyRootMode: "document",
      label: "故事总纲",
      summary: "故事背景、核心冲突、世界观和全局线索库的根节点。",
      status: "ready",
      chips: ["故事背景", "世界观", "全局线索"],
    };
  }

  if (kind === "plot") {
    return {
      ...base,
      label: `剧情节点 ${index}`,
      summary: "定义一个可玩的剧情阶段：玩家目标、自由行动范围、剧情内行动点和推进边界。",
      chips: ["自由行动", "行动点", "进入条件"],
    };
  }

  if (kind === "ending") {
    return {
      ...base,
      label: `结局 ${index}`,
      summary: "一个故事终止状态。通常由剧情出口触发，进入后玩家不再继续输入。",
      chips: ["结局", "终止节点", "待连接出口"],
      endingType: "truth",
      endingTrigger: "等待连接剧情出口，并填写达成条件。",
      endingReview: "复盘玩家走到这个结局的关键线索、行动和缺失信息。",
    };
  }

  if (kind === "role") {
    return {
      ...base,
      label: `角色 ${index}`,
      summary: "角色的定位、叙事功能和 AI 扮演边界。",
      chips: ["角色", "关系", "AI 扮演"],
      image: "avatar",
      characterMode: "relation",
      characterPortrait: "neutral",
    };
  }

  if (kind === "clue") {
    return {
      ...base,
      label: `线索 ${index}`,
      summary: "一个可被玩家发现、引用和验证的事实锚点。",
      chips: ["线索", "证据", "未解锁不可引用"],
      clueType: "待分类线索",
      clueSource: "归属故事线索库；出现点在剧情详情中配置。",
      clueUse: "作为后续追问、推理或出口条件的证据状态。",
      clueRule: "未解锁前不能被 AI 当作已知事实引用。",
    };
  }

  if (kind === "item") {
    return {
      ...base,
      label: `道具 ${index}`,
      summary: "玩家可检查、持有、出示或触发对白的物件。",
      chips: ["可检查", "可持有", "触发对白"],
      image: "item",
    };
  }

  if (kind === "video") {
    return {
      ...base,
      label: `视频片段 ${index}`,
      summary: "关键过场或可生成镜头，玩家端只在剧情需要时自然插入。",
      chips: ["过场", "镜头", "可生成"],
      image: "video",
    };
  }

  return base;
}

export function compactText(value: string, fallback: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized || fallback;
}

export function compactChips(values: string[], fallback: string[]): string[] {
  const chips = values
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 4);
  return chips.length > 0 ? chips : fallback;
}
