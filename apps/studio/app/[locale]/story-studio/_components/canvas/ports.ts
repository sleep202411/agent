import type { NarrativeEdge, NarrativeNodeData, NarrativeNodeKind } from "./types";

export const CURVED_EDGE_OPTIONS = {
  type: "default",
  pathOptions: { curvature: 0.42 },
  interactionWidth: 28,
  style: {
    stroke: "rgba(255, 255, 255, 0.34)",
    strokeLinecap: "round",
    strokeWidth: 1.8,
  },
} satisfies Partial<NarrativeEdge>;

export const CONNECTION_PORTS = {
  roles: {
    id: "roles",
    label: "角色",
    description: "连角色卡片",
    color: "#a78bfa",
    glow: "rgba(167,139,250,0.42)",
  },
  clues: {
    id: "clues",
    label: "线索库",
    description: "挂故事全局线索",
    color: "#5b9dff",
    glow: "rgba(91,157,255,0.42)",
  },
} as const;

export type ConnectionPortId = keyof typeof CONNECTION_PORTS;

export function edgeOptionsForPort(sourceHandle?: string | null): Partial<NarrativeEdge> {
  if (!sourceHandle || !(sourceHandle in CONNECTION_PORTS)) {
    return CURVED_EDGE_OPTIONS;
  }

  const port = CONNECTION_PORTS[sourceHandle as ConnectionPortId];

  return {
    ...CURVED_EDGE_OPTIONS,
    style: {
      ...CURVED_EDGE_OPTIONS.style,
      stroke: port.color,
      strokeWidth: 2,
    },
  };
}

export function edgeLabelOptions(
  label: string,
  sourceHandle?: ConnectionPortId
): Partial<NarrativeEdge> {
  const port = sourceHandle ? CONNECTION_PORTS[sourceHandle] : null;

  return {
    label,
    labelBgBorderRadius: 999,
    labelBgPadding: [9, 5],
    labelBgStyle: {
      fill: "oklch(0.19 0 0)",
      fillOpacity: 0.94,
    },
    labelStyle: {
      fill: port ? port.color : "rgba(255, 255, 255, 0.68)",
      fontSize: 12,
      fontWeight: 800,
    },
  };
}

export function isConnectionTargetKindAllowed(
  sourceHandle: string | null | undefined,
  targetKind: NarrativeNodeKind | undefined,
  sourceId?: string
) {
  if (targetKind === "role") {
    return sourceId === "storyRoot" && sourceHandle === "roles";
  }

  if (!sourceHandle || !(sourceHandle in CONNECTION_PORTS)) {
    return true;
  }

  if (sourceHandle === "roles") {
    return false;
  }

  if (sourceHandle === "clues") {
    return targetKind === "clue";
  }

  return true;
}

export function targetHandleForPort(
  sourceHandle: string | null | undefined,
  targetKind: NarrativeNodeKind | undefined
) {
  if (sourceHandle === "roles" && targetKind === "role") {
    return "role-in";
  }

  if (sourceHandle === "clues" && targetKind === "clue") {
    return "clue-in";
  }

  return undefined;
}

export function normalizePersistedEdgeHandles(
  edge: NarrativeEdge,
  targetKind: NarrativeNodeKind | undefined
): NarrativeEdge {
  const targetHandle = edge.targetHandle ?? targetHandleForPort(edge.sourceHandle, targetKind);

  if (edge.sourceHandle && edge.sourceHandle in CONNECTION_PORTS) {
    return {
      ...edge,
      ...edgeOptionsForPort(edge.sourceHandle),
      targetHandle,
    };
  }

  return {
    ...edge,
    targetHandle,
  };
}

export function nextDraftNodeForPort({
  portId,
  index,
}: {
  portId: ConnectionPortId;
  index: number;
}): {
  data: NarrativeNodeData;
  targetHandle?: string;
  label: string;
  offset: { x: number; y: number };
} {
  if (portId === "roles") {
    return {
      label: "角色",
      offset: { x: 150, y: 105 },
      targetHandle: "role-in",
      data: {
        kind: "role",
        eyebrow: "角色",
        label: `新角色 ${index}`,
        summary: "从故事总纲拖出生成。用于定义玩家、关键关系人、机构或观察对象。",
        status: "working",
        chips: ["角色", "待设定", "可参与剧情"],
        characterMode: index === 1 ? "protagonist" : "relation",
        characterPortrait: "neutral",
      },
    };
  }

  return {
    targetHandle: "clue-in",
    label: "全局线索",
    offset: { x: 150, y: 105 },
    data: {
      kind: "clue",
      eyebrow: "线索 · 全局",
      label: `新线索 ${index}`,
      summary: "从故事线索库拖出生成。它是全局证据状态，出现位置在剧情详情中配置。",
      status: "working",
      chips: ["全局证据", "待设置出现点", "AI 可引用"],
      clueType: "待分类线索",
      clueSource: "归属当前故事总纲；具体发现点在剧情详情中配置。",
      clueUse: "用于后续追问、推理、出口条件或风险变化。",
      clueRule: "未解锁前不能被 AI 当作已知事实引用。",
    },
  };
}
