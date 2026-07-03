"use client";

import {
  type CSSProperties,
  type ReactNode,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Image from "next/image";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type OnConnectEnd,
  type OnConnectStart,
  type OnSelectionChangeFunc,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  IconAdjustmentsHorizontal,
  IconArrowUpRight,
  IconBook2,
  IconBoxMultiple,
  IconBrain,
  IconCards,
  IconChevronDown,
  IconClock,
  IconDeviceGamepad2,
  IconEdit,
  IconEye,
  IconFileText,
  IconFingerprint,
  IconGitBranch,
  IconLayoutGridAdd,
  IconMap,
  IconMessageCircle,
  IconMusic,
  IconPackage,
  IconPhoto,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconRocket,
  IconSearch,
  IconSend,
  IconShieldCheck,
  IconSparkles,
  IconVideo,
  IconWaveSine,
  IconUsersGroup,
  IconUserCircle,
  IconX,
  type Icon,
} from "@tabler/icons-react";
import {
  ensureCanvasDocument,
  getDocument,
  updateDocumentSnapshot,
  type ModeDocumentRef,
} from "@/lib/collab/projects-api";
import { cn } from "@/lib/utils";

type NarrativeNodeKind =
  | "storyRoot"
  | "plot"
  | "ending"
  | "role"
  | "scene"
  | "clue"
  | "storyboard"
  | "item"
  | "sfx"
  | "music"
  | "video"
  | "logic"
  | "condition"
  | "state"
  | "relationship"
  | "playtest";

type StoryRootDocumentSection = {
  heading: string;
  paragraphs: readonly string[];
};

type StoryRootOverviewCard = {
  label: string;
  value: string;
};

type StoryRootStats = {
  roleCount: number;
  plotCount: number;
  clueCount: number;
  endingCount: number;
};

type NarrativeNodeData = {
  kind: NarrativeNodeKind;
  label: string;
  eyebrow: string;
  summary: string;
  meta?: string;
  status?: "ready" | "working" | "review";
  chips?: string[];
  image?: "avatar" | "scene" | "board" | "item" | "sfx" | "music" | "video";
  storyRootMode?: "document";
  storyRootSections?: StoryRootDocumentSection[];
  storyRootOverviewCards?: StoryRootOverviewCard[];
  storyRootStats?: StoryRootStats;
  plotId?: PlotNodeId;
  characterMode?: "protagonist" | "relation";
  characterPortrait?: CharacterPortraitKey;
  endingType?: "truth" | "intervention" | "failure" | "hidden";
  endingTrigger?: string;
  endingReview?: string;
  clueType?: string;
  clueSource?: string;
  clueUse?: string;
  clueRule?: string;
  triggerPhrases?: string[];
  triggerScope?: string;
  boundAsset?: string;
  playbackRule?: string;
  conditionExpression?: string;
  conditionPass?: string;
  conditionFail?: string;
  stateKey?: string;
  stateValue?: string;
  stateRule?: string;
  relationshipFrom?: string;
  relationshipTo?: string;
  relationshipType?: string;
  onViewStoryRoot?: () => void;
  onViewPlot?: () => void;
  onViewCharacter?: () => void;
  onEditNode?: () => void;
};

type NarrativeNode = Node<NarrativeNodeData, "narrative">;
type NarrativeEdge = Edge & {
  pathOptions?: {
    curvature?: number;
  };
};

type StoryCanvasSnapshot = Record<string, unknown> & {
  title?: string;
  summary?: string;
  canvas?: {
    nodes?: unknown;
    edges?: unknown;
  };
};

type StoryStudioAnalysis = {
  title: string;
  summary: string;
  worldview: string;
  storyKernel: string;
  adaptationDirection: string;
  locations: string[];
  protagonist: {
    name: string;
    role: string;
    summary: string;
  };
  characters: Array<{
    name: string;
    role: string;
    summary: string;
    tags: string[];
  }>;
  clues: Array<{
    title: string;
    summary: string;
    type: string;
    source: string;
    use: string;
    rule: string;
    tags: string[];
  }>;
  plots: Array<{
    title: string;
    summary: string;
    entryGoal: string;
    tags: string[];
  }>;
  endings: Array<{
    title: string;
    type: "truth" | "intervention" | "failure" | "hidden";
    summary: string;
    trigger: string;
    review: string;
    tags: string[];
  }>;
  guardrails: string[];
};

type StoryStudioAnalyzeResponse =
  | {
      success: true;
      analysis: StoryStudioAnalysis;
    }
  | {
      success: false;
      message: string;
    };

const STORY_CANVAS_SCHEMA_VERSION = "story-studio-canvas-v1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNarrativeNodeKind(value: unknown): value is NarrativeNodeKind {
  return (
    value === "storyRoot" ||
    value === "plot" ||
    value === "ending" ||
    value === "role" ||
    value === "scene" ||
    value === "clue" ||
    value === "storyboard" ||
    value === "item" ||
    value === "sfx" ||
    value === "music" ||
    value === "video" ||
    value === "logic" ||
    value === "condition" ||
    value === "state" ||
    value === "relationship" ||
    value === "playtest"
  );
}

function normalizeNarrativeNodeKind(value: unknown): NarrativeNodeKind | null {
  if (value === "script") {
    return "storyRoot";
  }

  return isNarrativeNodeKind(value) ? value : null;
}

function isPersistedNarrativeNode(value: unknown): value is NarrativeNode {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string") return false;
  if (!isRecord(value.position)) return false;
  if (typeof value.position.x !== "number" || typeof value.position.y !== "number") {
    return false;
  }
  if (!isRecord(value.data)) return false;
  if (!normalizeNarrativeNodeKind(value.data.kind)) return false;
  return typeof value.data.label === "string" && typeof value.data.eyebrow === "string";
}

function isPersistedNarrativeEdge(value: unknown): value is NarrativeEdge {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.source === "string" &&
    typeof value.target === "string"
  );
}

function parseStoryCanvasSnapshot(snapshot: unknown): {
  nodes: NarrativeNode[];
  edges: NarrativeEdge[];
  base: StoryCanvasSnapshot;
} {
  const base = isRecord(snapshot) ? (snapshot as StoryCanvasSnapshot) : {};
  const canvas = isRecord(base.canvas) ? base.canvas : {};
  const nodes = Array.isArray(canvas.nodes)
    ? canvas.nodes.filter(isPersistedNarrativeNode).map((node) => {
        const kind = normalizeNarrativeNodeKind(node.data.kind);
        const legacyStoryRootData = node.data as NarrativeNodeData & {
          scriptMode?: "document";
          scriptSections?: StoryRootDocumentSection[];
          scriptOverviewCards?: StoryRootOverviewCard[];
        };
        const normalizedData: NarrativeNodeData = {
          ...node.data,
          kind: kind ?? "storyRoot",
          ...(kind === "storyRoot"
            ? {
                storyRootMode:
                  legacyStoryRootData.storyRootMode ?? legacyStoryRootData.scriptMode ?? "document",
                storyRootSections:
                  legacyStoryRootData.storyRootSections ?? legacyStoryRootData.scriptSections,
                storyRootOverviewCards:
                  legacyStoryRootData.storyRootOverviewCards ??
                  legacyStoryRootData.scriptOverviewCards,
              }
            : {}),
        };

        return {
          ...node,
          id: node.id === "script" ? "storyRoot" : node.id,
          type: "narrative" as const,
          data: normalizedData,
          selected: false,
          dragging: false,
        };
      })
    : [];
  const normalizedNodes = normalizeLegacyStoryRootLayout(nodes);
  const nodeKindById = new Map(normalizedNodes.map((node) => [node.id, node.data.kind]));
  const edges = Array.isArray(canvas.edges)
    ? canvas.edges
        .filter(isPersistedNarrativeEdge)
        .map((edge) => ({
          ...edge,
          source: edge.source === "script" ? "storyRoot" : edge.source,
          target: edge.target === "script" ? "storyRoot" : edge.target,
        }))
        .map((edge) => normalizePersistedEdgeHandles(edge, nodeKindById.get(edge.target)))
        .filter((edge) =>
          isConnectionTargetKindAllowed(
            edge.sourceHandle,
            nodeKindById.get(edge.target),
            edge.source
          )
        )
    : [];

  return { nodes: normalizedNodes, edges, base };
}

function serializeNarrativeNodes(nodes: NarrativeNode[]): NarrativeNode[] {
  return nodes.map((node) => ({
    id: node.id,
    type: "narrative",
    position: node.position,
    data: {
      ...node.data,
      onViewStoryRoot: undefined,
      onViewPlot: undefined,
      onViewCharacter: undefined,
      onEditNode: undefined,
      storyRootStats: undefined,
    },
    hidden: node.hidden,
    draggable: node.draggable,
    selectable: node.selectable,
    deletable: node.deletable,
    sourcePosition: node.sourcePosition,
    targetPosition: node.targetPosition,
    parentId: node.parentId,
    extent: node.extent,
    expandParent: node.expandParent,
    origin: node.origin,
    className: node.className,
    style: node.style,
  }));
}

function serializeNarrativeEdges(edges: NarrativeEdge[]): NarrativeEdge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    type: edge.type,
    label: edge.label,
    animated: edge.animated,
    hidden: edge.hidden,
    deletable: edge.deletable,
    selectable: edge.selectable,
    style: edge.style,
    className: edge.className,
    markerEnd: edge.markerEnd,
    pathOptions: edge.pathOptions,
    labelBgBorderRadius: edge.labelBgBorderRadius,
    labelBgPadding: edge.labelBgPadding,
    labelBgStyle: edge.labelBgStyle,
    labelStyle: edge.labelStyle,
    interactionWidth: edge.interactionWidth,
    data: edge.data,
  }));
}

function buildStoryCanvasSnapshot(
  base: StoryCanvasSnapshot,
  nodes: NarrativeNode[],
  edges: NarrativeEdge[]
): Record<string, unknown> {
  return {
    ...base,
    schemaVersion:
      typeof base.schemaVersion === "string" ? base.schemaVersion : STORY_CANVAS_SCHEMA_VERSION,
    canvas: {
      ...(isRecord(base.canvas) ? base.canvas : {}),
      nodes: serializeNarrativeNodes(nodes),
      edges: serializeNarrativeEdges(edges),
    },
  };
}

const CURVED_EDGE_OPTIONS = {
  type: "default",
  pathOptions: { curvature: 0.42 },
  interactionWidth: 28,
  style: {
    stroke: "rgba(255, 255, 255, 0.34)",
    strokeLinecap: "round",
    strokeWidth: 1.8,
  },
} satisfies Partial<NarrativeEdge>;

function edgeOptionsForPort(sourceHandle?: string | null): Partial<NarrativeEdge> {
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

function edgeLabelOptions(label: string, sourceHandle?: ConnectionPortId): Partial<NarrativeEdge> {
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

type CharacterPortraitKey =
  | "protagonist"
  | "brother"
  | "victim"
  | "school"
  | "police"
  | "female"
  | "male"
  | "neutral";
type PlotNodeId = "arrival" | "rumor" | "report";
type AssetKind = "characters" | "scenes" | "clues" | "items" | "sfx" | "music" | "video";
type AssetStatus = "ready" | "draft" | "generating" | "missing";
type AssetItem = {
  title: string;
  eyebrow: string;
  summary: string;
  meta: string;
  status: AssetStatus;
  tags: string[];
  node: NarrativeNodeData;
};
type PlotNodeDetail = {
  id: PlotNodeId;
  stage: string;
  title: string;
  scene: string;
  goal: string;
  summary: string;
  entryVideo: {
    title: string;
    src: string;
    description: string;
  };
  openIntents: string[];
  internalActions: string[];
  unlocksClues: string[];
  entryConditions: string[];
  exitConditions: string[];
  guardrails: string[];
  riskTriggers: string[];
  aiChecks: string[];
  sampleInputs: Array<{ input: string; result: string }>;
};
type PlotSimulationStatus = "allowed" | "partial" | "blocked";
type PlotSimulationResult = {
  status: PlotSimulationStatus;
  intent: string;
  reason: string;
  unlockedClues: string[];
  riskChanges: string[];
  progress: string;
  replyPreview: string;
  checks: string[];
};

const CONNECTION_PORTS = {
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
  assets: {
    id: "assets",
    label: "媒体",
    description: "连场景/视频",
    color: "#e0a45c",
    glow: "rgba(224,164,92,0.38)",
  },
} as const;

type ConnectionPortId = keyof typeof CONNECTION_PORTS;

const ROLE_CARD_WIDTH = 320;
const ROLE_CARD_HEIGHT = 168;
const ROLE_CARD_VERTICAL_GAP = 34;
const ROLE_PORTRAIT_WIDTH = 82;
const ROLE_PORTRAIT_HEIGHT = Math.round((ROLE_PORTRAIT_WIDTH * 16) / 9);
const ROLE_LANE_OFFSET_X = 620;
const ROLE_LANE_OFFSET_Y = -260;

function isConnectionTargetKindAllowed(
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

  if (sourceHandle === "assets") {
    return targetKind === "scene" || targetKind === "video";
  }

  return true;
}

function targetHandleForPort(
  sourceHandle: string | null | undefined,
  targetKind: NarrativeNodeKind | undefined
) {
  if (sourceHandle === "roles" && targetKind === "role") {
    return "role-in";
  }

  if (sourceHandle === "clues" && targetKind === "clue") {
    return "clue-in";
  }

  if (sourceHandle === "assets" && (targetKind === "scene" || targetKind === "video")) {
    return "node-in";
  }

  return undefined;
}

function normalizePersistedEdgeHandles(
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

function normalizeLegacyStoryRootLayout(nodes: NarrativeNode[]) {
  const rootNode = nodes.find((node) => node.id === "storyRoot");

  if (!rootNode) {
    return nodes;
  }

  const roleNodes = nodes.filter((node) => node.data.kind === "role");
  const shouldMoveLegacyRoleLane =
    roleNodes.length > 0 &&
    (roleNodes.every((node) => node.position.x < rootNode.position.x - 80) ||
      roleNodes.some((node, index) => {
        if (index === 0) return false;
        const previousNode = roleNodes[index - 1];
        return Math.abs(node.position.y - previousNode.position.y) < ROLE_CARD_HEIGHT;
      }));

  if (!shouldMoveLegacyRoleLane) {
    return nodes;
  }

  let roleIndex = 0;
  let plotIndex = 0;
  let clueIndex = 0;
  let endingIndex = 0;

  return nodes.map((node) => {
    if (node.data.kind === "role") {
      const nextPosition = {
        x: rootNode.position.x + ROLE_LANE_OFFSET_X,
        y:
          rootNode.position.y +
          ROLE_LANE_OFFSET_Y +
          roleIndex * (ROLE_CARD_HEIGHT + ROLE_CARD_VERTICAL_GAP),
      };
      roleIndex += 1;
      return { ...node, position: nextPosition };
    }

    if (node.data.kind === "plot" && node.position.x < rootNode.position.x + 900) {
      const nextPosition = {
        x: rootNode.position.x + 980 + plotIndex * 420,
        y: rootNode.position.y,
      };
      plotIndex += 1;
      return { ...node, position: nextPosition };
    }

    if (node.data.kind === "clue" && node.position.y < rootNode.position.y + 900) {
      const nextPosition = {
        x: rootNode.position.x + 560 + (clueIndex % 3) * 340,
        y: rootNode.position.y + 900 + Math.floor(clueIndex / 3) * 300,
      };
      clueIndex += 1;
      return { ...node, position: nextPosition };
    }

    if (node.data.kind === "ending" && node.position.y < rootNode.position.y + 1380) {
      const nextPosition = {
        x: rootNode.position.x + 660 + endingIndex * 380,
        y: rootNode.position.y + 1420,
      };
      endingIndex += 1;
      return { ...node, position: nextPosition };
    }

    return node;
  });
}

function nextDraftNodeForPort({ portId, index }: { portId: ConnectionPortId; index: number }): {
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

  if (portId === "clues") {
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

  const assetPreset = index % 2;

  if (assetPreset === 1) {
    return {
      targetHandle: "node-in",
      label: "场景资产",
      offset: { x: 180, y: 120 },
      data: {
        kind: "scene",
        eyebrow: "场景资产",
        label: `新场景资产 ${index}`,
        summary: "定义这个剧情节点发生时的地点、视觉氛围和可观察环境。",
        status: "working",
        chips: ["场景", "待生成", "可绑定剧情"],
        image: "scene",
      },
    };
  }

  return {
    targetHandle: "node-in",
    label: "视频触发",
    offset: { x: 180, y: 120 },
    data: {
      kind: "video",
      eyebrow: "视频触发",
      label: `新视频片段 ${index}`,
      summary: "定义当前剧情节点可插入的短视频、过场或未来 Game Video 镜头。",
      status: "working",
      chips: ["视频", "过场", "可生成"],
      image: "video",
    },
  };
}

const CHARACTER_PORTRAITS: Record<CharacterPortraitKey, { src: string; alt: string }> = {
  protagonist: {
    src: "/narrative-studio/avatars/protagonist-linfeng.png",
    alt: "17 岁少女主角角色图",
  },
  brother: {
    src: "/narrative-studio/avatars/brother-intelligence.png",
    alt: "哥哥情报部门角色图",
  },
  victim: {
    src: "/narrative-studio/avatars/victim-classmate.png",
    alt: "溺亡同学生前角色图",
  },
  school: {
    src: "/narrative-studio/avatars/school-authority.png",
    alt: "精英学校校方角色图",
  },
  police: {
    src: "/narrative-studio/avatars/police-procedure.png",
    alt: "警方初步定性角色图",
  },
  female: {
    src: "/narrative-studio/avatars/female-student.png",
    alt: "女生默认角色图",
  },
  male: {
    src: "/narrative-studio/avatars/male-student.png",
    alt: "男生默认角色图",
  },
  neutral: {
    src: "/narrative-studio/avatars/neutral-student.png",
    alt: "无性别默认角色图",
  },
};

const STORY_ROOT_DOCUMENT_SECTIONS = [
  {
    heading: "故事背景",
    paragraphs: [
      "現代中國。一名17歲少女因被指有社交障礙，遭送往精英學校「矯正」，實則擁有過目不忘與超強邏輯推演的雙重天賦。其兄任職政府情報部門，總在她逼近真相時將她「保護性帶回家」。",
      "首宗案件：同學「意外溺斃」，警方草草定性為自殺；她僅用36小時便揭發這是一場精心策劃的謀殺——兇手竟是眾人連懷疑都不敢的人。",
    ],
  },
  {
    heading: "主角设定",
    paragraphs: [
      "17 岁少女被贴上「社交障碍」标签，进入精英学校接受矫正。她不擅长顺从社交规则，却能完整复现任何见过的细节，并在极短时间内推演出事件链条。",
      "她的哥哥任职政府情报部门。每当她接近更大的真相，他总会以保护为名把她带回家。这不是单纯的亲情保护，也可能是某种系统性隔离。",
    ],
  },
  {
    heading: "首宗案件：意外溺毙",
    paragraphs: [
      "一名同学在校内水域死亡，校方和警方迅速定性为自杀。时间线、目击证词和现场痕迹都被处理得近乎完美，足以让大多数人停止追问。",
      "主角只用了 36 小时就发现这并非冲动犯罪，而是一场经过预演的谋杀。真正的凶手并不是最像凶手的人，而是所有人都本能回避怀疑的人。",
    ],
  },
  {
    heading: "AI 运行边界",
    paragraphs: [
      "玩家可以自由输入，也可以选择剧情内行动点。AI 可以决定下一步剧情，但必须遵守故事背景、人物能力、学校规则、案件证据链和哥哥的干预逻辑。",
      "AI 不允许提前揭露真凶，不允许让主角凭空获得证据，也不允许把警方、校方或哥哥写成单一脸谱角色。每次推进都要留下可追踪的观察、推理或代价。",
    ],
  },
] as const;

const CHARACTER_ABILITIES = [
  { label: "过目不忘", value: 96, detail: "能复现见过的物品位置、语气停顿和现场细节。" },
  { label: "逻辑推演", value: 94, detail: "能把碎片证据压缩成可验证的事件链。" },
  { label: "社交伪装", value: 32, detail: "不擅长顺从社交规则，容易被误读为冷漠或失礼。" },
  { label: "干预风险", value: 78, detail: "逼近关键真相时，哥哥会以保护为名带她离场。" },
] as const;

const CHARACTER_DOCUMENT_SECTIONS = [
  {
    heading: "角色身份",
    icon: IconFingerprint,
    paragraphs: [
      "17 岁少女，玩家默认扮演的核心角色。她被外界贴上「社交障碍」标签，被送往精英学校接受所谓矫正。",
      "她不是天生反叛者，也不是传统侦探。她的问题在于无法自然接受不合逻辑的解释，因此会本能地拆解每一个被粉饰过的结论。",
    ],
  },
  {
    heading: "能力模型",
    icon: IconBrain,
    paragraphs: [
      "过目不忘不是超能力，而是叙事约束：她能回忆已经看见过的信息，但不能凭空知道没接触过的证据。",
      "逻辑推演必须基于观察、矛盾、证词或行为模式。AI 生成她的推理时，要明确展示至少一个可追踪的线索来源。",
    ],
  },
  {
    heading: "限制与风险",
    icon: IconShieldCheck,
    paragraphs: [
      "她不擅长处理人情压力，容易在群体场景中被孤立。她越准确，越会让校方、警方或同学觉得危险。",
      "哥哥任职政府情报部门。当她触碰到更高层级的真相，哥哥会触发干预：带她回家、切断调查、替她解释行为，甚至删除她接触证据的机会。",
    ],
  },
  {
    heading: "AI 扮演规则",
    icon: IconEye,
    paragraphs: [
      "AI 可以让她提出尖锐问题、记住细节、指出矛盾，但不能让她直接说出真凶，除非证据链已经完成。",
      "玩家自由输入时，AI 需要先判断动作是否符合她的能力和处境，再输出观察结果、推理推进、角色关系变化和潜在代价。",
    ],
  },
  {
    heading: "关系锚点",
    icon: IconUsersGroup,
    paragraphs: [
      "哥哥：保护者、监控者、信息封锁者三种身份同时成立，不能写成单纯反派。",
      "死者：不是案件道具，而是学校秩序的一次裂缝。主角必须通过死者留下的生活痕迹理解这起谋杀。",
      "同学与校方：他们的沉默比证词更重要。AI 应持续追踪谁在回避、谁在过度配合、谁拥有不该拥有的信息。",
    ],
  },
] as const;

const PLOT_NODE_DETAILS: Record<PlotNodeId, PlotNodeDetail> = {
  arrival: {
    id: "arrival",
    stage: "A",
    title: "进入精英学校",
    scene: "精英学校校门",
    goal: "让玩家建立处境：她被送来矫正，但学校和哥哥都在控制信息。",
    summary:
      "这是玩家进入世界的第一回合。玩家可以自由试探环境，但不能直接接触溺亡案核心，因为案件尚未被引入。",
    entryVideo: {
      title: "入场短片 · 校门",
      src: "/narrative-studio/videos/plot-a-enter-elite-school.mp4",
      description: "进入剧情 A 时播放，建立精英学校的压迫感和信息被控制的第一印象。",
    },
    openIntents: ["观察环境", "检查转学通知书", "询问接待老师", "联系哥哥", "拒绝配合或保持沉默"],
    internalActions: ["出示转学通知书", "询问矫正项目", "观察校门安保"],
    unlocksClues: ["转学通知书日期异常", "保安提前知道主角姓名", "哥哥没有回复但已读"],
    entryConditions: ["故事开始", "主角持有转学通知书"],
    exitConditions: ["完成入校手续", "至少观察到 1 个制度异常", "被老师带往教室"],
    guardrails: ["不能直接进入校长办公室", "不能提前知道溺亡案", "不能让哥哥立刻解释全部真相"],
    riskTriggers: ["公开质疑矫正项目会提升校方警惕", "连续联系哥哥会提高干预风险"],
    aiChecks: [
      "玩家输入是否属于当前场景可执行动作",
      "是否需要用社交伪装能力判定",
      "输出必须给出观察结果或被阻止的合理原因",
    ],
    sampleInputs: [
      {
        input: "我假装没听懂老师的话，慢慢观察校门和保安。",
        result: "允许。归类为观察环境 + 社交伪装，可能解锁保安提前知道主角姓名。",
      },
      {
        input: "我冲进校长办公室质问死人案。",
        result: "阻止。当前节点未引入案件，AI 只能让校方提高警惕，不能推进到真相。",
      },
    ],
  },
  rumor: {
    id: "rumor",
    stage: "B",
    title: "第一次听说溺亡案",
    scene: "高二（3）班教室",
    goal: "把玩家从入校体验转入案件，但只允许获得碎片信息。",
    summary: "玩家第一次听到同学溺亡。这里要允许自由追问、观察和试探，同时限制玩家直接锁定凶手。",
    entryVideo: {
      title: "入场短片 · 教室传闻",
      src: "/narrative-studio/videos/plot-b-first-drowning-hearsay.mp4",
      description: "进入剧情 B 时播放，把玩家从入校流程推入同学溺亡的低声传闻。",
    },
    openIntents: ["询问同桌", "观察老师反应", "查看公告栏", "回忆刚才的低声对话", "用假设试探同学"],
    internalActions: ["询问同桌发生了什么", "观察教室气氛", "检查公告栏"],
    unlocksClues: ["同学回避同一时间段", "老师听到水域时停顿", "公告措辞异常统一"],
    entryConditions: ["已完成入校手续", "进入高二（3）班教室"],
    exitConditions: ["获得至少 2 条异常线索", "知道校方把事件称为自杀", "触发事故报告入口"],
    guardrails: ["不能直接指认真凶", "不能让所有同学主动交代", "不能直接获得监控权限"],
    riskTriggers: ["连续逼问同学会降低信任", "公开说这是谋杀会触发老师打断"],
    aiChecks: [
      "自由输入是否能映射为追问、观察、试探或回忆",
      "如果失败，也要返回微线索或关系变化",
      "输出不能让玩家跳过事故报告阶段",
    ],
    sampleInputs: [
      {
        input: "我故意说昨晚水池边有人，观察谁最紧张。",
        result: "允许。归类为试探同学，可解锁老师停顿或同学回避。",
      },
      {
        input: "我直接宣布凶手是校长。",
        result: "不推进。当前证据不足，AI 应反馈缺少连接校长和现场的证据。",
      },
    ],
  },
  report: {
    id: "report",
    stage: "C",
    title: "调查事故报告",
    scene: "教务处走廊 / 公告栏",
    goal: "让玩家第一次用线索链证明“自杀结论不稳”。",
    summary: "这是从开放探索进入受控推理的节点。玩家可以自由拆报告，但必须基于已观察证据推进。",
    entryVideo: {
      title: "入场短片 · 事故报告",
      src: "/narrative-studio/videos/plot-c-accident-report.mp4",
      description: "进入剧情 C 时播放，强调报告、时间线和被处理过的细节。",
    },
    openIntents: [
      "核对时间线",
      "比较签名顺序",
      "追问报告措辞",
      "寻找缺失见证人",
      "请求查看原始记录",
    ],
    internalActions: ["核对报告时间线", "检查签名顺序", "追问原始记录"],
    unlocksClues: ["报告签名顺序异常", "关键 17 分钟缺失", "见证人名单被替换"],
    entryConditions: ["知道校方定性为自杀", "已获得至少 2 条异常线索"],
    exitConditions: ["证明报告不能独立成立", "解锁溺亡现场回看", "哥哥干预风险上升"],
    guardrails: ["不能直接得出真凶", "不能凭空获得监控录像", "必须给出至少一个可追踪线索来源"],
    riskTriggers: ["要求原始记录会触发教务处阻拦", "证据链接近成立会提升哥哥干预风险"],
    aiChecks: [
      "玩家是否已有足够线索质疑报告",
      "推理输出是否明确引用线索来源",
      "是否触发新线索、阻拦或哥哥干预",
    ],
    sampleInputs: [
      {
        input: "我按时间顺序重排报告里所有人的签名。",
        result: "允许。归类为核对时间线，可解锁报告签名顺序异常。",
      },
      {
        input: "我说我已经知道谁删了监控。",
        result: "不允许直接确认。除非已拿到权限线索，否则只能形成怀疑。",
      },
    ],
  },
};

const KIND_META: Record<NarrativeNodeKind, { icon: Icon; accent: string; glow: string }> = {
  storyRoot: {
    icon: IconFileText,
    accent: "text-[#84b7ff]",
    glow: "bg-[#84b7ff]/18",
  },
  plot: {
    icon: IconGitBranch,
    accent: "text-white",
    glow: "bg-white/14",
  },
  ending: {
    icon: IconRocket,
    accent: "text-white",
    glow: "bg-white/14",
  },
  role: {
    icon: IconUserCircle,
    accent: "text-[#e0c27a]",
    glow: "bg-[#e0c27a]/18",
  },
  scene: {
    icon: IconMap,
    accent: "text-[#8ad9bb]",
    glow: "bg-[#8ad9bb]/18",
  },
  clue: {
    icon: IconFingerprint,
    accent: "text-white",
    glow: "bg-white/14",
  },
  storyboard: {
    icon: IconPhoto,
    accent: "text-[#d9d9d9]",
    glow: "bg-white/14",
  },
  item: {
    icon: IconCards,
    accent: "text-[#e0c27a]",
    glow: "bg-[#e0c27a]/18",
  },
  sfx: {
    icon: IconWaveSine,
    accent: "text-[#e0c27a]",
    glow: "bg-[#e0c27a]/18",
  },
  music: {
    icon: IconMusic,
    accent: "text-white",
    glow: "bg-white/14",
  },
  video: {
    icon: IconVideo,
    accent: "text-white",
    glow: "bg-white/14",
  },
  logic: {
    icon: IconAdjustmentsHorizontal,
    accent: "text-[#ff8c8f]",
    glow: "bg-[#E52227]/18",
  },
  condition: {
    icon: IconShieldCheck,
    accent: "text-[#8ad9bb]",
    glow: "bg-[#8ad9bb]/18",
  },
  state: {
    icon: IconBrain,
    accent: "text-[#84b7ff]",
    glow: "bg-[#84b7ff]/18",
  },
  relationship: {
    icon: IconUsersGroup,
    accent: "text-white",
    glow: "bg-white/14",
  },
  playtest: {
    icon: IconDeviceGamepad2,
    accent: "text-white",
    glow: "bg-white/12",
  },
};

const CANVAS_LAYOUT = {
  endingColumnX: 2760,
  endingColumnStartY: -860,
  endingCardHeight: 280,
  endingCardGap: 72,
} as const;

const NODE_LIBRARY: Array<{ kind: NarrativeNodeKind; title: string }> = [
  { kind: "storyRoot", title: "故事总纲" },
  { kind: "plot", title: "剧情节点" },
  { kind: "role", title: "角色" },
  { kind: "clue", title: "线索" },
  { kind: "ending", title: "结局" },
  { kind: "video", title: "视频" },
  { kind: "item", title: "道具" },
];

const EMPTY_CANVAS_STARTERS: Array<{
  kind: NarrativeNodeKind;
  title: string;
  description: string;
  prompt: string;
  image: string;
}> = [
  {
    kind: "storyRoot",
    title: "Story Root",
    description: "Generate with StoryOS",
    prompt:
      "Turn this IP into a playable text story with a clear story root, plot spine, clues, characters, and endings.",
    image: "/gallery/seed/concept-story-archive-cover.jpg",
  },
  {
    kind: "role",
    title: "Character Sheets",
    description: "Generate with StoryOS",
    prompt:
      "Analyze the IP and generate the first playable story structure with strong character sheets and role boundaries.",
    image: "/gallery/seed/studio-dark-creative-interior.jpg",
  },
  {
    kind: "video",
    title: "Opening Video",
    description: "Generate with StoryOS",
    prompt:
      "Analyze the IP and create a story canvas that includes the opening plot node and media moments.",
    image: "/gallery/seed/studio-neon-story-panels.jpg",
  },
  {
    kind: "music",
    title: "Audio Scene",
    description: "Generate with StoryOS",
    prompt:
      "Analyze the IP and create a playable story canvas with atmosphere, dramatic beats, and runtime guardrails.",
    image: "/gallery/seed/studio-holographic-timeline-desk.jpg",
  },
];

const AGENT_ACTIONS: Array<{ label: string; kind: NarrativeNodeKind }> = [
  { label: "扩写案发前一天的校园氛围", kind: "storyRoot" },
  { label: "生成下一个可玩剧情节点", kind: "plot" },
  { label: "生成哥哥干预角色节点", kind: "role" },
];

const ASSET_KIND_ORDER: AssetKind[] = ["characters", "scenes", "clues", "items", "video"];

const ASSET_KIND_META: Record<
  AssetKind,
  { label: string; eyebrow: string; description: string; icon: Icon }
> = {
  characters: {
    label: "角色",
    eyebrow: "Characters",
    description: "玩家、嫌疑人、机构和关系角色。",
    icon: IconUsersGroup,
  },
  scenes: {
    label: "场景",
    eyebrow: "Scenes",
    description: "地点、时间段、氛围和可交互环境。",
    icon: IconMap,
  },
  clues: {
    label: "线索",
    eyebrow: "Clues",
    description: "证据、证词矛盾、事实锚点和推理触发器。",
    icon: IconFingerprint,
  },
  items: {
    label: "道具",
    eyebrow: "Items",
    description: "玩家可持有、检查、交换或消耗的物件。",
    icon: IconPackage,
  },
  sfx: {
    label: "音效",
    eyebrow: "SFX",
    description: "由文字动作、线索解锁或状态变化触发的短音效。",
    icon: IconWaveSine,
  },
  music: {
    label: "音乐",
    eyebrow: "Music",
    description: "持续背景音乐、情绪曲线、循环段和切换条件。",
    icon: IconMusic,
  },
  video: {
    label: "视频",
    eyebrow: "Video",
    description: "过场、关键镜头、Game Video 生成片段。",
    icon: IconVideo,
  },
};

const ASSET_LIBRARY: Record<AssetKind, AssetItem[]> = {
  characters: [
    {
      eyebrow: "玩家角色",
      title: "17 岁少女主角",
      summary: "过目不忘与逻辑推演是她的核心运行规则，但她无法凭空知道未观察过的证据。",
      meta: "4 个能力值 · 5 条 AI 扮演规则",
      status: "ready",
      tags: ["过目不忘", "逻辑推演", "玩家默认扮演"],
      node: {
        kind: "role",
        eyebrow: "角色",
        label: "17 岁少女主角",
        summary: "被指有社交障碍，实则拥有过目不忘和超强逻辑推演能力。",
        status: "ready",
        chips: ["过目不忘", "逻辑推演", "玩家角色"],
        image: "avatar",
        characterMode: "protagonist",
        characterPortrait: "protagonist",
      },
    },
    {
      eyebrow: "关系角色",
      title: "哥哥 / 情报部门",
      summary: "既是保护者，也是监控者。主角逼近高层真相时，他会触发干预。",
      meta: "3 个关系身份 · 1 个干预条件",
      status: "ready",
      tags: ["保护", "监控", "干预触发"],
      node: {
        kind: "role",
        eyebrow: "关系角色",
        label: "哥哥 / 情报部门",
        summary: "保护者、监控者、信息封锁者三种身份同时成立。",
        status: "review",
        chips: ["保护", "监控", "干预触发"],
        image: "avatar",
        characterMode: "relation",
        characterPortrait: "brother",
      },
    },
    {
      eyebrow: "案件角色",
      title: "溺亡同学",
      summary: "死者的生活痕迹是证据链入口，而不是单纯的案件背景。",
      meta: "6 条生活痕迹 · 2 条关系线",
      status: "draft",
      tags: ["死者", "生活痕迹", "证据源"],
      node: {
        kind: "role",
        eyebrow: "案件角色",
        label: "溺亡同学",
        summary: "她留下的生活痕迹会推动证据链。",
        status: "working",
        chips: ["死者", "生活痕迹", "证据源"],
        image: "avatar",
        characterMode: "relation",
        characterPortrait: "victim",
      },
    },
    {
      eyebrow: "机构角色",
      title: "精英学校 / 校方",
      summary: "表面是矫正机构，实际维护沉默秩序，并把异常解释成学生个人问题。",
      meta: "3 条制度压力 · 2 条阻拦逻辑",
      status: "ready",
      tags: ["矫正", "权力秩序", "压制调查"],
      node: {
        kind: "role",
        eyebrow: "机构角色",
        label: "精英学校 / 校方",
        summary: "校方会把异常解释成学生个人问题，并限制玩家获得原始信息。",
        status: "working",
        chips: ["矫正", "权力秩序", "压制调查"],
        image: "avatar",
        characterMode: "relation",
        characterPortrait: "school",
      },
    },
    {
      eyebrow: "外部角色",
      title: "警方 / 初步定性",
      summary: "快速接受自杀结论，用程序性语言封住追问空间；它是压力来源，不是单纯反派。",
      meta: "1 个官方结论 · 3 个可质疑点",
      status: "draft",
      tags: ["自杀定性", "程序压力", "可质疑"],
      node: {
        kind: "role",
        eyebrow: "外部角色",
        label: "警方 / 初步定性",
        summary: "快速接受自杀结论，并用程序性语言封住追问空间。",
        status: "review",
        chips: ["自杀定性", "程序压力", "可质疑"],
        image: "avatar",
        characterMode: "relation",
        characterPortrait: "police",
      },
    },
  ],
  scenes: [
    {
      eyebrow: "主场景",
      title: "精英学校校门",
      summary: "主角进入矫正学校的第一视觉锚点，校门、保安和转学手续共同建立压迫感。",
      meta: "日间 · 现代中国 · 可生成图像",
      status: "ready",
      tags: ["开场", "制度感", "校门"],
      node: {
        kind: "scene",
        eyebrow: "场景",
        label: "精英学校校门",
        summary: "主角第一次进入矫正学校，保安、校门和转学手续共同建立秩序压力。",
        status: "ready",
        chips: ["开场", "制度感", "校门"],
        image: "scene",
      },
    },
    {
      eyebrow: "案件场景",
      title: "校内水域 / 溺亡现场",
      summary: "事故被快速清理，现场痕迹被消除得过于完整，反而成为第一个矛盾。",
      meta: "夜间 · 水域 · 证据污染",
      status: "generating",
      tags: ["溺亡", "现场清理", "矛盾点"],
      node: {
        kind: "scene",
        eyebrow: "案件场景",
        label: "校内水域 / 溺亡现场",
        summary: "现场被过度清理，时间线和痕迹缺失会推动主角继续追问。",
        status: "working",
        chips: ["溺亡", "现场清理", "矛盾点"],
        image: "scene",
      },
    },
  ],
  clues: [
    {
      eyebrow: "文档线索",
      title: "校方事故报告",
      summary: "报告措辞过于一致，时间线缺口和见证人签名顺序互相冲突。",
      meta: "核心线索 · 可被质疑",
      status: "ready",
      tags: ["时间线", "签名顺序", "措辞异常"],
      node: {
        kind: "clue",
        eyebrow: "线索",
        label: "校方事故报告",
        summary: "警方和校方用来支撑自杀结论的核心文本，时间线、措辞和缺失细节都可被质疑。",
        status: "ready",
        chips: ["证据链", "时间线", "可质疑"],
        image: "item",
      },
    },
    {
      eyebrow: "行为线索",
      title: "同学的沉默",
      summary: "多名同学没有说谎，但他们都避开了同一个时间段。",
      meta: "群体行为 · AI 判定触发",
      status: "draft",
      tags: ["沉默", "回避", "时间段"],
      node: {
        kind: "clue",
        eyebrow: "线索",
        label: "同学的沉默",
        summary: "多名同学回避同一个时间段，玩家必须通过追问和观察拆出共同缺口。",
        status: "review",
        chips: ["沉默", "回避", "时间段"],
      },
    },
  ],
  items: [
    {
      eyebrow: "随身道具",
      title: "皱皱的转学通知书",
      summary: "通知书是开场道具，也能触发哥哥、校方和主角之间的权力关系。",
      meta: "可检查 · 可出示 · 可触发对白",
      status: "ready",
      tags: ["转学", "身份", "触发对白"],
      node: {
        kind: "item",
        eyebrow: "道具",
        label: "皱皱的转学通知书",
        summary: "开场道具，可被检查、出示，也能触发校方和哥哥相关对白。",
        status: "ready",
        chips: ["转学", "身份", "触发对白"],
        image: "item",
      },
    },
    {
      eyebrow: "证物道具",
      title: "湿掉的学生证",
      summary: "与溺亡现场相连，但它本身不是结论，只是让玩家重新检查时间线。",
      meta: "未确认 · 需要关联线索",
      status: "missing",
      tags: ["证物", "时间线", "待生成"],
      node: {
        kind: "item",
        eyebrow: "道具",
        label: "湿掉的学生证",
        summary: "与溺亡现场相连，需要和时间线、目击证词一起验证。",
        status: "working",
        chips: ["证物", "时间线", "待生成"],
        image: "item",
      },
    },
  ],
  sfx: [
    {
      eyebrow: "事件音效",
      title: "门在身后关上",
      summary: "玩家观察保安或 AI 描述合上登记册时触发，增强文字动作的即时反馈。",
      meta: "door-hard-shut.mp3 · one-shot · 文本触发",
      status: "ready",
      tags: ["关门", "登记册", "门禁", "短音效"],
      node: {
        kind: "sfx",
        eyebrow: "音效触发",
        label: "门在身后关上",
        summary: "当 AI 正文写到小门关上、合上登记册或门禁闭合时播放短促关门音效。",
        status: "ready",
        chips: ["文字触发", "短音效", "不阻塞剧情"],
        image: "sfx",
        triggerPhrases: ["关上门", "小门在他身后关上", "合上登记册"],
        triggerScope: "当前剧情节点",
        boundAsset: "door-hard-shut.mp3",
        playbackRule: "命中后播放一次；失败不影响剧情推进。",
      },
    },
    {
      eyebrow: "线索音效",
      title: "证据浮现",
      summary: "线索卡第一次被解锁时播放极短提示音，不抢占正文阅读节奏。",
      meta: "evidence-ping.wav · one-shot · clue_unlocked",
      status: "draft",
      tags: ["线索", "提示", "低干扰"],
      node: {
        kind: "sfx",
        eyebrow: "音效触发",
        label: "证据浮现提示",
        summary: "当玩家首次解锁关键线索时播放低干扰提示音。",
        status: "working",
        chips: ["线索解锁", "短提示", "待选素材"],
        image: "sfx",
        triggerPhrases: ["解锁线索", "发现异常", "证据出现"],
        triggerScope: "全局线索系统",
        boundAsset: "evidence-ping.wav",
        playbackRule: "同一线索只播放一次。",
      },
    },
  ],
  music: [
    {
      eyebrow: "持续背景音乐",
      title: "校门低频脉冲",
      summary: "开场和制度压迫段落使用的低频循环，进入调查状态后逐步加入高频噪点。",
      meta: "70 BPM · loop · tension",
      status: "draft",
      tags: ["开场", "压迫", "循环"],
      node: {
        kind: "music",
        eyebrow: "音乐",
        label: "校门低频脉冲",
        summary: "开场和制度压迫段落使用的低频循环，进入调查状态后逐步加入高频噪点。",
        status: "review",
        chips: ["开场", "压迫", "循环"],
        image: "music",
      },
    },
    {
      eyebrow: "情绪 cue",
      title: "哥哥出现",
      summary: "当哥哥触发干预时，音乐从调查节奏切换到更安静的控制感。",
      meta: "conditional cue · brother_intervention",
      status: "ready",
      tags: ["哥哥", "干预", "切换"],
      node: {
        kind: "music",
        eyebrow: "音乐",
        label: "哥哥出现",
        summary: "哥哥触发干预时切换到更安静、更控制的音乐 cue。",
        status: "ready",
        chips: ["哥哥", "干预", "切换"],
        image: "music",
      },
    },
  ],
  video: [
    {
      eyebrow: "开场镜头",
      title: "进入精英学校",
      summary: "9:16 竖屏过场：校门、转学通知书、主角停顿、哥哥的信息提示。",
      meta: "9:16 · 8s · 可生成",
      status: "generating",
      tags: ["开场", "竖屏", "过场"],
      node: {
        kind: "video",
        eyebrow: "视频",
        label: "进入精英学校",
        summary: "校门、转学通知书、主角停顿和哥哥的信息提示组成的开场过场。",
        status: "working",
        chips: ["开场", "竖屏", "过场"],
        image: "video",
      },
    },
    {
      eyebrow: "关键镜头",
      title: "溺亡现场回看",
      summary: "玩家触发回忆或复盘时播放，不直接揭露真凶，只强调被清理过的细节。",
      meta: "16:9 · evidence recap",
      status: "draft",
      tags: ["复盘", "证据", "不剧透"],
      node: {
        kind: "video",
        eyebrow: "视频",
        label: "溺亡现场回看",
        summary: "复盘现场被清理过的细节，不直接揭露真凶。",
        status: "review",
        chips: ["复盘", "证据", "不剧透"],
        image: "video",
      },
    },
  ],
};

function nodeDefaults(kind: NarrativeNodeKind, index: number): NarrativeNodeData {
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

  if (kind === "scene") {
    return {
      ...base,
      label: `场景 ${index}`,
      summary: "地点、时间段、氛围、可观察物和可触发媒体资产。",
      chips: ["地点", "氛围", "可观察"],
      image: "scene",
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

  if (kind === "sfx") {
    return {
      ...base,
      label: `事件音效 ${index}`,
      summary: "当 AI 正文或状态变化命中特定动作时播放短音效。",
      chips: ["文字触发", "one-shot", "不阻塞剧情"],
      image: "sfx",
      triggerPhrases: ["关上门", "脚步声停下"],
      triggerScope: "当前剧情节点",
      boundAsset: "pending-sfx.wav",
      playbackRule: "命中后播放一次；播放失败不影响剧情推进。",
    };
  }

  if (kind === "music") {
    return {
      ...base,
      label: `音乐 Cue ${index}`,
      summary: "持续背景音乐或情绪 cue，只在指定剧情阶段切入或淡出。",
      chips: ["BGM", "循环", "阶段触发"],
      image: "music",
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

  if (kind === "storyboard") {
    return {
      ...base,
      label: `视频分镜 ${index}`,
      summary: "把文字剧情拆成镜头序列，为后续 Game Video 生成服务。",
      chips: ["镜头", "分镜", "视频生成"],
      image: "board",
    };
  }

  if (kind === "condition") {
    return {
      ...base,
      label: `剧情门槛 ${index}`,
      summary: "判断玩家是否可以进入下一剧情节点，或者继续停留并获得反馈。",
      chips: ["进入条件", "退出条件", "防止跳步"],
      conditionExpression: "已完成当前目标 AND 已解锁必要线索",
      conditionPass: "允许进入下一剧情节点。",
      conditionFail: "停留在当前节点，生成澄清、观察或阻拦反馈。",
    };
  }

  if (kind === "state") {
    return {
      ...base,
      label: `运行状态 ${index}`,
      summary: "玩家回合中持续变化的状态变量，用来控制线索、风险和剧情出口。",
      chips: ["runtime", "变量", "AI 决策"],
      stateKey: "caseProgress",
      stateValue: "plot=A; clues=0; risk=0",
      stateRule: "自由输入和剧情内行动点都只能改变状态，不能直接跳到真相。",
    };
  }

  if (kind === "relationship") {
    return {
      ...base,
      label: `关系 ${index}`,
      summary: "描述两个角色或机构之间的信任、控制、保护、敌意或信息差。",
      chips: ["角色关系", "信息差", "可影响回应"],
      relationshipFrom: "角色 A",
      relationshipTo: "角色 B",
      relationshipType: "等待定义",
    };
  }

  return base;
}

function compactText(value: string, fallback: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized || fallback;
}

function compactChips(values: string[], fallback: string[]): string[] {
  const chips = values
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 4);
  return chips.length > 0 ? chips : fallback;
}

function buildStoryRootSectionsFromAnalysis(
  analysis: StoryStudioAnalysis
): StoryRootDocumentSection[] {
  return [
    {
      heading: "Worldview",
      paragraphs: [
        compactText(analysis.worldview, "Worldview pending refinement."),
        `Locations: ${analysis.locations.length > 0 ? analysis.locations.join(" · ") : "Pending"}.`,
      ],
    },
    {
      heading: "Story Kernel",
      paragraphs: [
        compactText(analysis.storyKernel, "Story kernel pending refinement."),
        compactText(analysis.summary, "Playable premise pending refinement."),
      ],
    },
    {
      heading: "Adaptation Direction",
      paragraphs: [
        compactText(analysis.adaptationDirection, "Mystery"),
        analysis.guardrails.length > 0
          ? `AI guardrails: ${analysis.guardrails.join(" · ")}`
          : "AI must respect discovered evidence, player state, and plot boundaries.",
      ],
    },
  ];
}

function buildNodesAndEdgesFromAnalysis(analysis: StoryStudioAnalysis): {
  nodes: NarrativeNode[];
  edges: NarrativeEdge[];
} {
  const now = Date.now();
  const rootId = "storyRoot";
  const plotIds = ["arrival", "rumor", "report"] as const;

  const storyRootNode: NarrativeNode = {
    id: rootId,
    type: "narrative",
    position: { x: 260, y: 220 },
    data: {
      ...nodeDefaults("storyRoot", 1),
      eyebrow: "故事总纲",
      label: compactText(analysis.title, "Untitled Story"),
      summary: compactText(analysis.summary, "A playable story draft generated by StoryOS."),
      status: "ready",
      storyRootMode: "document",
      chips: compactChips(
        [analysis.adaptationDirection, "故事核", "世界观", "全局线索"],
        ["故事核", "世界观", "全局线索"]
      ),
      storyRootSections: buildStoryRootSectionsFromAnalysis(analysis),
      storyRootOverviewCards: [
        { label: "Worldview", value: compactText(analysis.worldview, "Pending") },
        { label: "Locations", value: analysis.locations.slice(0, 4).join(" · ") || "Pending" },
        {
          label: "Direction",
          value: compactText(analysis.adaptationDirection, "Mystery"),
        },
      ],
    },
  };

  const characterSeeds = [
    {
      name: analysis.protagonist.name,
      role: analysis.protagonist.role,
      summary: analysis.protagonist.summary,
      tags: ["玩家角色", "主角"],
      mode: "protagonist" as const,
      portrait: "protagonist" as CharacterPortraitKey,
    },
    ...analysis.characters.map((character, index) => ({
      name: character.name,
      role: character.role,
      summary: character.summary,
      tags: character.tags,
      mode: "relation" as const,
      portrait: (index % 2 === 0 ? "male" : "female") as CharacterPortraitKey,
    })),
  ].slice(0, 5);

  const roleNodes: NarrativeNode[] = characterSeeds.map((character, index) => ({
    id: `role-${now}-${index}`,
    type: "narrative",
    position: {
      x: 860,
      y: -120 + index * (ROLE_CARD_HEIGHT + ROLE_CARD_VERTICAL_GAP),
    },
    data: {
      ...nodeDefaults("role", index + 1),
      eyebrow: character.role,
      label: character.name,
      summary: compactText(character.summary, "Character role pending refinement."),
      status: "ready",
      chips: compactChips(character.tags, ["角色", "AI 扮演"]),
      characterMode: character.mode,
      characterPortrait: character.portrait,
    },
  }));

  const plotNodes: NarrativeNode[] = analysis.plots.slice(0, 5).map((plot, index) => ({
    id: `plot-${now}-${index}`,
    type: "narrative",
    position: { x: 1240 + index * 420, y: 220 },
    data: {
      ...nodeDefaults("plot", index + 1),
      eyebrow: `剧情节点 ${String.fromCharCode(65 + index)}`,
      label: compactText(plot.title, `Plot Node ${index + 1}`),
      summary: compactText(
        plot.summary || plot.entryGoal,
        "Playable plot node pending refinement."
      ),
      status: index === 0 ? "ready" : "working",
      chips: compactChips(plot.tags, ["自由行动", "行动点", "进入条件"]),
      plotId: plotIds[index],
    },
  }));

  const clueNodes: NarrativeNode[] = analysis.clues.slice(0, 6).map((clue, index) => ({
    id: `clue-${now}-${index}`,
    type: "narrative",
    position: { x: 820 + (index % 3) * 340, y: 760 + Math.floor(index / 3) * 300 },
    data: {
      ...nodeDefaults("clue", index + 1),
      eyebrow: "线索 · 全局",
      label: compactText(clue.title, `Clue ${index + 1}`),
      summary: compactText(clue.summary, "Discoverable clue pending refinement."),
      status: "ready",
      chips: compactChips(clue.tags, ["全局证据", "可解锁", "AI 可引用"]),
      clueType: compactText(clue.type, "evidence"),
      clueSource: compactText(clue.source, "Player action"),
      clueUse: compactText(clue.use, "Supports later questions, deductions, or story exits."),
      clueRule: compactText(clue.rule, "Must be discovered before the AI can cite it."),
    },
  }));

  const endingNodes: NarrativeNode[] = analysis.endings.slice(0, 4).map((ending, index) => ({
    id: `ending-${now}-${index}`,
    type: "narrative",
    position: { x: 920 + index * 380, y: 1320 },
    data: {
      ...nodeDefaults("ending", index + 1),
      eyebrow: `结局 · ${ending.type}`,
      label: compactText(ending.title, `Ending ${index + 1}`),
      summary: compactText(ending.summary, "Terminal ending pending refinement."),
      status: "ready",
      chips: compactChips(ending.tags, ["结局", "终止节点"]),
      endingType: ending.type,
      endingTrigger: compactText(ending.trigger, "Reached through a plot exit condition."),
      endingReview: compactText(
        ending.review,
        "Summarize the player evidence chain and missed opportunities."
      ),
    },
  }));

  const nodes = [storyRootNode, ...roleNodes, ...plotNodes, ...clueNodes, ...endingNodes];
  const edges: NarrativeEdge[] = [];

  roleNodes.forEach((node, index) => {
    edges.push({
      ...edgeOptionsForPort("roles"),
      ...edgeLabelOptions(index === 0 ? "玩家角色" : "角色", "roles"),
      id: `${rootId}-${node.id}`,
      source: rootId,
      sourceHandle: "roles",
      target: node.id,
      targetHandle: "role-in",
    });
  });

  clueNodes.forEach((node) => {
    edges.push({
      ...edgeOptionsForPort("clues"),
      ...edgeLabelOptions("全局线索", "clues"),
      id: `${rootId}-${node.id}`,
      source: rootId,
      sourceHandle: "clues",
      target: node.id,
      targetHandle: "clue-in",
    });
  });

  if (plotNodes[0]) {
    edges.push({
      ...CURVED_EDGE_OPTIONS,
      ...edgeLabelOptions("剧情入口"),
      id: `${rootId}-${plotNodes[0].id}`,
      source: rootId,
      target: plotNodes[0].id,
    });
  }

  plotNodes.slice(0, -1).forEach((node, index) => {
    const nextNode = plotNodes[index + 1];
    edges.push({
      ...CURVED_EDGE_OPTIONS,
      ...edgeLabelOptions(`进入 ${String.fromCharCode(66 + index)}`),
      id: `${node.id}-${nextNode.id}`,
      source: node.id,
      target: nextNode.id,
    });
  });

  const lastPlot = plotNodes[plotNodes.length - 1];
  if (lastPlot) {
    endingNodes.forEach((node) => {
      edges.push({
        ...CURVED_EDGE_OPTIONS,
        ...edgeLabelOptions("结局出口"),
        id: `${lastPlot.id}-${node.id}`,
        source: lastPlot.id,
        target: node.id,
        targetHandle: "ending-in",
      });
    });
  }

  return { nodes, edges };
}

function NodeEditButton({
  onClick,
  className,
  label = "编辑",
}: {
  onClick?: () => void;
  className?: string;
  label?: string;
}) {
  if (!onClick) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={cn(
        "nodrag nopan inline-flex h-9 items-center gap-1.5 rounded-full bg-white/[0.075] px-3 text-xs font-semibold text-white/62 transition hover:bg-white/12 hover:text-white active:translate-y-0.5",
        className
      )}
    >
      <IconEdit className="size-3.5" stroke={2} />
      {label}
    </button>
  );
}

function storyRootOverviewValue(
  cards: readonly StoryRootOverviewCard[] | undefined,
  labels: string[]
): string | null {
  if (!cards || cards.length === 0) return null;

  const normalizedLabels = labels.map((label) => label.toLowerCase());
  const card = cards.find((item) =>
    normalizedLabels.some((label) => item.label.toLowerCase().includes(label))
  );

  return card?.value?.trim() || null;
}

function storyRootSectionText(
  sections: readonly StoryRootDocumentSection[],
  headings: string[]
): string | null {
  const normalizedHeadings = headings.map((heading) => heading.toLowerCase());
  const section = sections.find((item) =>
    normalizedHeadings.some((heading) => item.heading.toLowerCase().includes(heading))
  );

  return section?.paragraphs.join(" ").trim() || null;
}

function splitStoryRootList(value: string | null | undefined): string[] {
  if (!value) return [];

  return value
    .replace(/^locations:\s*/i, "")
    .replace(/[;；、,，]/g, " · ")
    .split(/\s*·\s*/)
    .map((item) => item.replace(/\.$/, "").trim())
    .filter(Boolean)
    .slice(0, 4);
}

function StoryRootStatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[18px] bg-white/[0.055] px-3 py-3">
      <p className="text-[22px] font-black leading-none text-white/88">{value}</p>
      <p className="mt-1 text-[11px] font-semibold text-white/36">{label}</p>
    </div>
  );
}

function StoryRootPreviewNode({
  data,
  selected,
}: Pick<NodeProps<NarrativeNode>, "data" | "selected">) {
  const storyRootSections =
    data.storyRootSections && data.storyRootSections.length > 0
      ? data.storyRootSections
      : STORY_ROOT_DOCUMENT_SECTIONS;
  const overviewCards = data.storyRootOverviewCards ?? [];
  const worldview =
    storyRootOverviewValue(overviewCards, ["worldview", "世界观"]) ??
    storyRootSectionText(storyRootSections, ["worldview", "世界观"]) ??
    data.summary;
  const storyKernel =
    storyRootSectionText(storyRootSections, ["story kernel", "故事核"]) ?? data.summary;
  const locationText =
    storyRootOverviewValue(overviewCards, ["locations", "地点"]) ??
    storyRootSectionText(storyRootSections, ["locations", "地点"]);
  const locations = splitStoryRootList(locationText);
  const direction =
    storyRootOverviewValue(overviewCards, ["direction", "改编", "类型"]) ??
    storyRootSectionText(storyRootSections, ["adaptation direction", "改编方向"]) ??
    "待确认";
  const stats = data.storyRootStats ?? {
    roleCount: 0,
    plotCount: 0,
    clueCount: 0,
    endingCount: 0,
  };

  return (
    <div className="relative w-[430px] pt-10">
      <div className="absolute left-0 top-0 z-10 inline-flex h-8 items-center gap-2 rounded-full bg-[#7b4be8]/42 px-3 text-[13px] font-semibold text-white shadow-[0_10px_30px_rgba(0,0,0,0.3)] backdrop-blur-xl">
        <span className="grid size-6 place-items-center rounded-full bg-[#8f65ff]/70">
          <IconFileText className="size-3.5" stroke={2} />
        </span>
        故事总纲
      </div>

      <article
        className={cn(
          "group relative overflow-visible rounded-[28px] bg-[linear-gradient(180deg,oklch(0.21_0_0),oklch(0.17_0_0))] p-8 shadow-[0_28px_100px_rgba(0,0,0,0.48)] transition duration-200",
          selected && "bg-[linear-gradient(180deg,oklch(0.24_0_0),oklch(0.18_0_0))]"
        )}
      >
        <Handle
          id="roles"
          type="source"
          position={Position.Right}
          className="!-right-1.5 !z-30 !size-3 !border-0"
          style={{
            top: "36%",
            backgroundColor: CONNECTION_PORTS.roles.color,
            boxShadow: `0 0 18px ${CONNECTION_PORTS.roles.glow}`,
          }}
        />
        <Handle
          type="source"
          position={Position.Right}
          className="!-right-1.5 !z-20 !size-3 !border-0 !bg-white/70"
        />
        <Handle
          id="clues"
          type="source"
          position={Position.Right}
          className="!-right-1.5 !z-30 !size-3 !border-0"
          style={{
            top: "66%",
            backgroundColor: CONNECTION_PORTS.clues.color,
            boxShadow: `0 0 18px ${CONNECTION_PORTS.clues.glow}`,
          }}
        />

        <div className="pointer-events-none absolute right-5 top-[31%] z-10 inline-flex items-center gap-1.5 rounded-full bg-black/18 px-2 py-1 text-[10px] font-black text-white/42 backdrop-blur-xl">
          <span
            className="size-1.5 rounded-full"
            style={{
              backgroundColor: CONNECTION_PORTS.roles.color,
              boxShadow: `0 0 12px ${CONNECTION_PORTS.roles.glow}`,
            }}
          />
          角色
        </div>

        <div className="pointer-events-none absolute right-5 top-[62%] z-10 inline-flex items-center gap-1.5 rounded-full bg-black/18 px-2 py-1 text-[10px] font-black text-white/42 backdrop-blur-xl">
          <span
            className="size-1.5 rounded-full"
            style={{
              backgroundColor: CONNECTION_PORTS.clues.color,
              boxShadow: `0 0 12px ${CONNECTION_PORTS.clues.glow}`,
            }}
          />
          线索库
        </div>

        <h2 className="text-[34px] font-black leading-none tracking-tight text-white/92">
          故事总纲
        </h2>
        <p className="mt-2 text-sm font-semibold text-white/40">{data.label}</p>
        <p className="mt-5 line-clamp-2 text-[14px] font-semibold leading-6 text-white/52">
          {data.summary}
        </p>

        <div className="mt-6 grid grid-cols-4 gap-2">
          <StoryRootStatTile label="角色" value={stats.roleCount} />
          <StoryRootStatTile label="剧情" value={stats.plotCount} />
          <StoryRootStatTile label="线索" value={stats.clueCount} />
          <StoryRootStatTile label="结局" value={stats.endingCount} />
        </div>

        <div className="mt-5 rounded-[22px] bg-black/18 p-4">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/28">故事核</p>
          <p className="mt-2 line-clamp-3 text-[13px] font-semibold leading-6 text-white/54">
            {storyKernel}
          </p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="min-h-[78px] rounded-[20px] bg-white/[0.045] p-3">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/28">地点</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(locations.length > 0 ? locations : ["待生成"]).slice(0, 3).map((location) => (
                <span
                  key={location}
                  className="max-w-full truncate rounded-full bg-white/[0.07] px-2 py-1 text-[10px] font-semibold text-white/44"
                >
                  {location}
                </span>
              ))}
            </div>
          </div>
          <div className="min-h-[78px] rounded-[20px] bg-white/[0.045] p-3">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/28">
              改编方向
            </p>
            <p className="mt-2 line-clamp-2 text-[12px] font-semibold leading-5 text-white/50">
              {direction}
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-[20px] bg-white/[0.045] p-3">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/28">世界观</p>
          <p className="mt-2 line-clamp-2 text-[12px] font-semibold leading-5 text-white/46">
            {worldview}
          </p>
        </div>

        <div className="mt-6 flex items-center justify-end">
          <button
            type="button"
            data-testid="open-story-root-viewer"
            onClick={(event) => {
              event.stopPropagation();
              data.onViewStoryRoot?.();
            }}
            className="nodrag nopan inline-flex h-11 items-center gap-2 rounded-full bg-[#E52227] px-5 text-sm font-black text-white shadow-[0_12px_34px_rgba(229,34,39,0.28)] transition hover:bg-[#ff3d42] active:translate-y-0.5"
          >
            查看
            <IconFileText className="size-4" stroke={2} />
          </button>
        </div>
      </article>
    </div>
  );
}

function PlotPortTile({ portId, value }: { portId: ConnectionPortId; value: number }) {
  const port = CONNECTION_PORTS[portId];

  return (
    <div className="rounded-[18px] bg-white/[0.06] px-3 py-2">
      <p className="text-[18px] font-black leading-none text-white/86">{value}</p>
      <p className="mt-1 inline-flex items-center gap-1.5 text-[10px] font-semibold text-white/38">
        <span
          className="size-1.5 rounded-full"
          style={{
            backgroundColor: port.color,
            boxShadow: `0 0 12px ${port.glow}`,
          }}
        />
        {port.label}
      </p>
      <p className="mt-1 text-[9px] font-semibold text-white/24">{port.description}</p>
    </div>
  );
}

function PlotInfoTile({
  label,
  value,
  description,
}: {
  label: string;
  value: number;
  description: string;
}) {
  return (
    <div className="rounded-[18px] bg-white/[0.06] px-3 py-2">
      <p className="text-[18px] font-black leading-none text-white/86">{value}</p>
      <p className="mt-1 text-[10px] font-semibold text-white/38">{label}</p>
      <p className="mt-1 text-[9px] font-semibold text-white/24">{description}</p>
    </div>
  );
}

function PlotEntryVideoStrip({ video }: { video: PlotNodeDetail["entryVideo"] }) {
  return (
    <div className="mt-4 overflow-hidden rounded-[20px] bg-black/20">
      <div className="relative aspect-video bg-white/[0.04]">
        <video
          src={video.src}
          muted
          playsInline
          preload="metadata"
          onMouseEnter={(event) => {
            void event.currentTarget.play().catch(() => {});
          }}
          onMouseLeave={(event) => {
            event.currentTarget.pause();
            event.currentTarget.currentTime = 0;
          }}
          className="h-full w-full object-cover opacity-70"
        />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,transparent,rgba(0,0,0,0.64))]" />
        <div className="pointer-events-none absolute bottom-3 left-3 right-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[10px] font-black uppercase tracking-[0.16em] text-white/42">
              入场视频
            </p>
            <p className="mt-0.5 truncate text-xs font-black text-white/82">{video.title}</p>
          </div>
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white text-black">
            <IconPlayerPlay className="size-4" />
          </span>
        </div>
      </div>
    </div>
  );
}

function PlotBorderPorts() {
  const ports: Array<{ id: ConnectionPortId; top: string }> = [{ id: "assets", top: "72%" }];

  return (
    <>
      {ports.map(({ id, top }) => {
        const port = CONNECTION_PORTS[id];

        return (
          <Handle
            key={id}
            id={port.id}
            type="source"
            position={Position.Right}
            className="nodrag nopan !-right-1.5 !z-30 !size-3 !border-0"
            style={{
              top,
              backgroundColor: port.color,
              boxShadow: `0 0 18px ${port.glow}`,
            }}
          />
        );
      })}
    </>
  );
}

function PlotNodeCard({ data, selected }: Pick<NodeProps<NarrativeNode>, "data" | "selected">) {
  const plot = data.plotId ? PLOT_NODE_DETAILS[data.plotId] : null;

  return (
    <article
      className={cn(
        "relative w-[330px] overflow-visible rounded-[28px] bg-[oklch(0.19_0_0)] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.38)] transition duration-200",
        selected && "bg-[oklch(0.23_0_0)] shadow-[0_28px_90px_rgba(0,0,0,0.5)]"
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!-left-1.5 !z-20 !size-3 !border-0 !bg-white/45"
        style={{ top: "50%" }}
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!-right-1.5 !z-20 !size-3 !border-0 !bg-white/62"
        style={{ top: "50%" }}
      />
      <PlotBorderPorts />

      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-white text-[18px] font-black text-black">
            {plot?.stage ?? "?"}
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/36">
              {data.eyebrow}
            </p>
            <h3 className="mt-1 line-clamp-2 text-[19px] font-black leading-tight text-white/92">
              {data.label}
            </h3>
          </div>
        </div>
        <StatusPill status={data.status ?? "ready"} />
      </div>

      <p className="mt-4 line-clamp-3 text-[13px] font-semibold leading-6 text-white/54">
        {data.summary}
      </p>

      {plot?.entryVideo ? <PlotEntryVideoStrip video={plot.entryVideo} /> : null}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <PlotInfoTile
          label="行动点"
          value={plot?.internalActions.length ?? 0}
          description="内部判定"
        />
        <PlotPortTile portId="assets" value={2} />
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5 pb-11">
        {(data.chips ?? []).map((chip) => (
          <span
            key={chip}
            className="rounded-full bg-white/[0.065] px-2.5 py-1 text-[11px] font-semibold text-white/52"
          >
            {chip}
          </span>
        ))}
      </div>

      <div className="absolute bottom-4 right-4 flex items-center gap-2">
        <NodeEditButton onClick={data.onEditNode} />
        <button
          type="button"
          data-testid={`open-plot-viewer-${data.plotId ?? "draft"}`}
          onClick={(event) => {
            event.stopPropagation();
            data.onViewPlot?.();
          }}
          className="nodrag nopan inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-black text-black shadow-[0_12px_34px_rgba(0,0,0,0.26)] transition hover:bg-white/88 active:translate-y-0.5"
        >
          查看
          <IconGitBranch className="size-4" stroke={2} />
        </button>
      </div>
    </article>
  );
}

function CharacterPortrait({
  portrait = "neutral",
  compact = false,
  className,
  sizes,
  style,
}: {
  portrait?: CharacterPortraitKey;
  compact?: boolean;
  className?: string;
  sizes?: string;
  style?: CSSProperties;
}) {
  const asset = CHARACTER_PORTRAITS[portrait];

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[24px] bg-[linear-gradient(180deg,oklch(0.28_0_0),oklch(0.12_0_0))] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
        compact ? "aspect-[9/16] w-full" : "aspect-[9/16] w-full",
        className
      )}
      style={style}
    >
      <Image
        src={asset.src}
        alt={asset.alt}
        fill
        unoptimized
        loading="eager"
        sizes={sizes ?? (compact ? "96px" : "340px")}
        className="object-cover"
        draggable={false}
      />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),transparent_32%,rgba(0,0,0,0.24))]" />
    </div>
  );
}

function AbilityMeter({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-white/46">
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
        <div className="h-full rounded-full bg-white/62" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function CharacterCardNode({
  data,
  selected,
}: Pick<NodeProps<NarrativeNode>, "data" | "selected">) {
  const roleLabel = data.characterMode === "protagonist" ? "主角" : "角色";

  return (
    <article
      className={cn(
        "group relative overflow-visible rounded-[22px] bg-[oklch(0.18_0_0)] p-2.5 shadow-[0_18px_58px_rgba(0,0,0,0.32)] transition duration-200",
        selected && "bg-[oklch(0.215_0_0)] shadow-[0_22px_70px_rgba(0,0,0,0.44)]"
      )}
      style={{ width: ROLE_CARD_WIDTH, height: ROLE_CARD_HEIGHT }}
    >
      <Handle
        id="role-in"
        type="target"
        position={Position.Left}
        className="!-left-1.5 !z-30 !size-3 !border-0"
        style={{
          top: "50%",
          backgroundColor: CONNECTION_PORTS.roles.color,
          boxShadow: `0 0 18px ${CONNECTION_PORTS.roles.glow}`,
        }}
      />

      <div
        className="grid h-full gap-3"
        style={{ gridTemplateColumns: `${ROLE_PORTRAIT_WIDTH}px 1fr` }}
      >
        <CharacterPortrait
          portrait={data.characterPortrait ?? "neutral"}
          compact
          sizes={`${ROLE_PORTRAIT_WIDTH}px`}
          className="rounded-[18px]"
          style={{ width: ROLE_PORTRAIT_WIDTH, height: ROLE_PORTRAIT_HEIGHT }}
        />
        <div className="flex min-w-0 flex-col py-1">
          <div className="mb-1.5 flex items-center">
            <span className="rounded-full bg-white/[0.08] px-2 py-0.5 text-[10px] font-semibold text-white/50">
              {roleLabel}
            </span>
          </div>
          <h3 className="line-clamp-1 text-[15px] font-semibold leading-5 text-white/88">
            {data.label}
          </h3>
          <p className="mt-2 line-clamp-2 text-[11px] font-medium leading-4 text-white/48">
            {data.summary}
          </p>
          <div className="mt-auto flex items-center">
            <button
              type="button"
              data-testid={`open-character-viewer-${data.label}`}
              onClick={(event) => {
                event.stopPropagation();
                data.onViewCharacter?.();
              }}
              className="nodrag nopan inline-flex h-7 items-center gap-1.5 rounded-full bg-white px-2.5 text-[11px] font-semibold text-black transition hover:bg-white/88 active:translate-y-0.5"
            >
              查看
              <IconUserCircle className="size-3.5" stroke={2} />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function ClueNodeCard({ data, selected }: Pick<NodeProps<NarrativeNode>, "data" | "selected">) {
  return (
    <article
      className={cn(
        "relative w-[300px] overflow-visible rounded-[24px] bg-[oklch(0.18_0_0)] p-4 shadow-[0_20px_64px_rgba(0,0,0,0.34)] transition duration-200",
        selected && "bg-[oklch(0.22_0_0)] shadow-[0_24px_76px_rgba(0,0,0,0.48)]"
      )}
    >
      <Handle
        id="clue-in"
        type="target"
        position={Position.Left}
        className="!-left-1.5 !z-20 !size-3 !border-0"
        style={{
          backgroundColor: CONNECTION_PORTS.clues.color,
          boxShadow: `0 0 18px ${CONNECTION_PORTS.clues.glow}`,
        }}
      />

      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#5b9dff]/14 text-[#9dc5ff]">
            <IconFingerprint className="size-5" stroke={1.8} />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/34">
              {data.eyebrow}
            </p>
            <h3 className="mt-1 line-clamp-2 text-[18px] font-black leading-tight text-white/92">
              {data.label}
            </h3>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-[#5b9dff]/12 px-2 py-1 text-[10px] font-black text-[#9dc5ff]">
          {data.clueType ?? "线索"}
        </span>
      </div>

      <p className="mt-4 line-clamp-2 text-[12px] font-semibold leading-5 text-white/54">
        {data.summary}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2">
        {[
          ["归属", data.clueSource ?? "归属故事线索库"],
          ["用途", data.clueUse ?? "作为后续追问、推理或出口条件的证据状态。"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-[16px] bg-black/18 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/28">
              {label}
            </p>
            <p className="mt-1 line-clamp-1 text-[11px] font-semibold leading-5 text-white/48">
              {value}
            </p>
          </div>
        ))}
      </div>

      <p className="mt-2 line-clamp-2 rounded-[16px] bg-black/18 p-3 text-[11px] font-semibold leading-5 text-white/46">
        <span className="mr-2 text-white/28">AI 约束</span>
        {data.clueRule ?? "未解锁前不能被 AI 当作已知事实引用。"}
      </p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {(data.chips ?? []).slice(0, 3).map((chip) => (
          <span
            key={chip}
            className="rounded-full bg-white/[0.065] px-2.5 py-1 text-[10px] font-semibold text-white/48"
          >
            {chip}
          </span>
        ))}
      </div>

      <div className="mt-4">
        <NodeEditButton onClick={data.onEditNode} />
      </div>
    </article>
  );
}

function EndingNodeCard({ data, selected }: Pick<NodeProps<NarrativeNode>, "data" | "selected">) {
  const endingLabel =
    data.endingType === "intervention"
      ? "中断"
      : data.endingType === "failure"
        ? "失败"
        : data.endingType === "hidden"
          ? "隐藏"
          : "主线";

  return (
    <article
      className={cn(
        "relative w-[330px] overflow-visible rounded-[26px] bg-[oklch(0.185_0_0)] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.36)] transition duration-200",
        selected && "bg-[oklch(0.225_0_0)] shadow-[0_28px_90px_rgba(0,0,0,0.5)]"
      )}
      style={{ height: CANVAS_LAYOUT.endingCardHeight }}
    >
      <Handle
        id="ending-in"
        type="target"
        position={Position.Left}
        className="!-left-1.5 !z-20 !size-3 !border-0 !bg-white/72"
        style={{ top: "50%" }}
      />

      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-white/12 text-white/86">
            <IconRocket className="size-5" stroke={1.8} />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/34">
              {data.eyebrow}
            </p>
            <h3 className="mt-1 line-clamp-2 text-[20px] font-black leading-tight text-white/92">
              {data.label}
            </h3>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-white/[0.075] px-2.5 py-1 text-[10px] font-black text-white/58">
          {endingLabel}
        </span>
      </div>

      <p className="mt-4 line-clamp-2 text-[13px] font-semibold leading-6 text-white/56">
        {data.summary}
      </p>

      <div className="mt-4">
        <div className="rounded-[18px] bg-black/18 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/28">
            达成方式
          </p>
          <p className="mt-1 line-clamp-2 text-[11px] font-semibold leading-5 text-white/50">
            {data.endingTrigger ?? "由剧情出口触发。"}
          </p>
        </div>
      </div>

      <div className="absolute inset-x-5 bottom-5 flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {(data.chips ?? []).slice(0, 2).map((chip) => (
            <span
              key={chip}
              className="rounded-full bg-white/[0.065] px-2.5 py-1 text-[10px] font-semibold text-white/48"
            >
              {chip}
            </span>
          ))}
        </div>
        <NodeEditButton onClick={data.onEditNode} />
      </div>
    </article>
  );
}

function SfxNodeCard({ data, selected }: Pick<NodeProps<NarrativeNode>, "data" | "selected">) {
  return (
    <article
      className={cn(
        "relative w-[320px] overflow-visible rounded-[24px] bg-[oklch(0.18_0_0)] p-4 shadow-[0_20px_64px_rgba(0,0,0,0.34)] transition duration-200",
        selected && "bg-[oklch(0.22_0_0)] shadow-[0_24px_76px_rgba(0,0,0,0.48)]"
      )}
    >
      <Handle
        id="asset-in"
        type="target"
        position={Position.Left}
        className="!-left-1.5 !z-20 !size-3 !border-0"
        style={{
          backgroundColor: CONNECTION_PORTS.assets.color,
          boxShadow: `0 0 18px ${CONNECTION_PORTS.assets.glow}`,
        }}
      />
      <Handle
        id="asset-out"
        type="source"
        position={Position.Right}
        className="!-right-1.5 !z-20 !size-3 !border-0"
        style={{
          backgroundColor: CONNECTION_PORTS.assets.color,
          boxShadow: `0 0 18px ${CONNECTION_PORTS.assets.glow}`,
        }}
      />

      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#e0a45c]/14 text-[#e0c27a]">
            <IconWaveSine className="size-5" stroke={1.8} />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/34">
              {data.eyebrow}
            </p>
            <h3 className="mt-1 line-clamp-2 text-[18px] font-black leading-tight text-white/92">
              {data.label}
            </h3>
          </div>
        </div>
        <StatusPill status={data.status ?? "ready"} />
      </div>

      <div className="mt-4">
        <NodeVisual type="sfx" />
      </div>

      <p className="mt-4 line-clamp-2 text-[12px] font-semibold leading-5 text-white/54">
        {data.summary}
      </p>

      <div className="mt-4 rounded-[18px] bg-black/18 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/30">
          触发文字
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(data.triggerPhrases ?? ["待填写"]).slice(0, 4).map((phrase) => (
            <span
              key={phrase}
              className="rounded-full bg-white/[0.065] px-2.5 py-1 text-[10px] font-semibold text-white/50"
            >
              {phrase}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-[16px] bg-black/18 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/28">
            范围
          </p>
          <p className="mt-1 line-clamp-2 text-[11px] font-semibold leading-5 text-white/48">
            {data.triggerScope ?? "当前剧情节点"}
          </p>
        </div>
        <div className="rounded-[16px] bg-black/18 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/28">
            素材
          </p>
          <p className="mt-1 line-clamp-2 text-[11px] font-semibold leading-5 text-white/48">
            {data.boundAsset ?? "未绑定"}
          </p>
        </div>
      </div>

      <div className="mt-4">
        <NodeEditButton onClick={data.onEditNode} />
      </div>
    </article>
  );
}

function ConditionNodeCard({
  data,
  selected,
}: Pick<NodeProps<NarrativeNode>, "data" | "selected">) {
  return (
    <article
      className={cn(
        "relative w-[340px] overflow-visible rounded-[24px] bg-[oklch(0.18_0_0)] p-4 shadow-[0_20px_64px_rgba(0,0,0,0.34)] transition duration-200",
        selected && "bg-[oklch(0.22_0_0)] shadow-[0_24px_76px_rgba(0,0,0,0.48)]"
      )}
    >
      <Handle
        id="condition-in"
        type="target"
        position={Position.Left}
        className="!-left-1.5 !z-20 !size-3 !border-0 !bg-white/48"
      />
      <Handle
        id="condition-out"
        type="source"
        position={Position.Right}
        className="!-right-1.5 !z-20 !size-3 !border-0 !bg-white/68"
      />

      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-white/10 text-white/76">
            <IconShieldCheck className="size-5" stroke={1.8} />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/34">
              {data.eyebrow}
            </p>
            <h3 className="mt-1 line-clamp-2 text-[18px] font-black leading-tight text-white/92">
              {data.label}
            </h3>
          </div>
        </div>
        <StatusPill status={data.status ?? "ready"} />
      </div>

      <p className="mt-4 line-clamp-2 text-[12px] font-semibold leading-5 text-white/54">
        {data.summary}
      </p>

      <div className="mt-4 rounded-[18px] bg-black/18 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/30">
          条件表达式
        </p>
        <p className="mt-2 text-[12px] font-black leading-5 text-white/76">
          {data.conditionExpression ?? "等待填写条件"}
        </p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-[16px] bg-white/[0.055] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/28">
            通过
          </p>
          <p className="mt-1 line-clamp-3 text-[11px] font-semibold leading-5 text-white/50">
            {data.conditionPass ?? "进入下一节点"}
          </p>
        </div>
        <div className="rounded-[16px] bg-white/[0.055] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/28">
            未通过
          </p>
          <p className="mt-1 line-clamp-3 text-[11px] font-semibold leading-5 text-white/50">
            {data.conditionFail ?? "停留并反馈"}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {(data.chips ?? []).slice(0, 3).map((chip) => (
          <span
            key={chip}
            className="rounded-full bg-white/[0.065] px-2.5 py-1 text-[10px] font-semibold text-white/48"
          >
            {chip}
          </span>
        ))}
      </div>

      <div className="mt-4">
        <NodeEditButton onClick={data.onEditNode} />
      </div>
    </article>
  );
}

function StateNodeCard({ data, selected }: Pick<NodeProps<NarrativeNode>, "data" | "selected">) {
  return (
    <article
      className={cn(
        "relative w-[330px] overflow-visible rounded-[24px] bg-[oklch(0.18_0_0)] p-4 shadow-[0_20px_64px_rgba(0,0,0,0.34)] transition duration-200",
        selected && "bg-[oklch(0.22_0_0)] shadow-[0_24px_76px_rgba(0,0,0,0.48)]"
      )}
    >
      <Handle
        id="state-in"
        type="target"
        position={Position.Left}
        className="!-left-1.5 !z-20 !size-3 !border-0 !bg-[#84b7ff]"
        style={{ boxShadow: "0 0 18px rgba(132,183,255,0.42)" }}
      />
      <Handle
        id="state-out"
        type="source"
        position={Position.Right}
        className="!-right-1.5 !z-20 !size-3 !border-0 !bg-[#84b7ff]"
        style={{ boxShadow: "0 0 18px rgba(132,183,255,0.42)" }}
      />

      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#84b7ff]/14 text-[#b8d7ff]">
            <IconBrain className="size-5" stroke={1.8} />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/34">
              {data.eyebrow}
            </p>
            <h3 className="mt-1 line-clamp-2 text-[18px] font-black leading-tight text-white/92">
              {data.label}
            </h3>
          </div>
        </div>
        <StatusPill status={data.status ?? "ready"} />
      </div>

      <p className="mt-4 line-clamp-2 text-[12px] font-semibold leading-5 text-white/54">
        {data.summary}
      </p>

      <div className="mt-4 rounded-[18px] bg-black/18 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/30">
          状态键
        </p>
        <p className="mt-2 text-[13px] font-black text-white/78">
          {data.stateKey ?? "runtimeState"}
        </p>
        <p className="mt-2 line-clamp-2 text-[11px] font-semibold leading-5 text-white/48">
          {data.stateValue ?? "等待写入状态值"}
        </p>
      </div>

      <p className="mt-3 line-clamp-3 rounded-[18px] bg-white/[0.055] p-3 text-[11px] font-semibold leading-5 text-white/50">
        {data.stateRule ?? "状态只影响 AI 决策，不直接把玩家跳到结论。"}
      </p>

      <div className="mt-4">
        <NodeEditButton onClick={data.onEditNode} />
      </div>
    </article>
  );
}

function RelationshipNodeCard({
  data,
  selected,
}: Pick<NodeProps<NarrativeNode>, "data" | "selected">) {
  return (
    <article
      className={cn(
        "relative w-[340px] overflow-visible rounded-[24px] bg-[oklch(0.18_0_0)] p-4 shadow-[0_20px_64px_rgba(0,0,0,0.34)] transition duration-200",
        selected && "bg-[oklch(0.22_0_0)] shadow-[0_24px_76px_rgba(0,0,0,0.48)]"
      )}
    >
      <Handle
        id="relationship-in"
        type="target"
        position={Position.Left}
        className="!-left-1.5 !z-20 !size-3 !border-0 !bg-white/48"
      />
      <Handle
        id="relationship-out"
        type="source"
        position={Position.Right}
        className="!-right-1.5 !z-20 !size-3 !border-0 !bg-white/68"
      />

      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-white/10 text-white/76">
            <IconUsersGroup className="size-5" stroke={1.8} />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/34">
              {data.eyebrow}
            </p>
            <h3 className="mt-1 line-clamp-2 text-[18px] font-black leading-tight text-white/92">
              {data.label}
            </h3>
          </div>
        </div>
        <StatusPill status={data.status ?? "ready"} />
      </div>

      <p className="mt-4 line-clamp-2 text-[12px] font-semibold leading-5 text-white/54">
        {data.summary}
      </p>

      <div className="mt-4 rounded-[20px] bg-black/18 p-3">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <p className="line-clamp-2 text-[12px] font-black leading-5 text-white/76">
            {data.relationshipFrom ?? "角色 A"}
          </p>
          <span className="grid size-8 place-items-center rounded-full bg-white/10 text-white/54">
            <IconGitBranch className="size-4" stroke={1.8} />
          </span>
          <p className="line-clamp-2 text-right text-[12px] font-black leading-5 text-white/76">
            {data.relationshipTo ?? "角色 B"}
          </p>
        </div>
        <p className="mt-3 rounded-full bg-white/[0.065] px-3 py-1.5 text-center text-[11px] font-semibold text-white/50">
          {data.relationshipType ?? "等待定义关系类型"}
        </p>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {(data.chips ?? []).slice(0, 3).map((chip) => (
          <span
            key={chip}
            className="rounded-full bg-white/[0.065] px-2.5 py-1 text-[10px] font-semibold text-white/48"
          >
            {chip}
          </span>
        ))}
      </div>

      <div className="mt-4">
        <NodeEditButton onClick={data.onEditNode} />
      </div>
    </article>
  );
}

function NarrativeNodeCard({ data, selected }: NodeProps<NarrativeNode>) {
  if (data.kind === "storyRoot" || data.storyRootMode === "document") {
    return <StoryRootPreviewNode data={data} selected={selected} />;
  }

  if (data.kind === "plot") {
    return <PlotNodeCard data={data} selected={selected} />;
  }

  if (data.kind === "role") {
    return <CharacterCardNode data={data} selected={selected} />;
  }

  if (data.kind === "ending") {
    return <EndingNodeCard data={data} selected={selected} />;
  }

  if (data.kind === "clue") {
    return <ClueNodeCard data={data} selected={selected} />;
  }

  if (data.kind === "sfx") {
    return <SfxNodeCard data={data} selected={selected} />;
  }

  if (data.kind === "condition") {
    return <ConditionNodeCard data={data} selected={selected} />;
  }

  if (data.kind === "state") {
    return <StateNodeCard data={data} selected={selected} />;
  }

  if (data.kind === "relationship") {
    return <RelationshipNodeCard data={data} selected={selected} />;
  }

  const meta = KIND_META[data.kind];
  const Icon = meta.icon;

  return (
    <article
      className={cn(
        "group relative w-[360px] overflow-visible rounded-[26px] bg-[oklch(0.19_0_0)] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.36)] transition duration-200",
        selected && "bg-[oklch(0.23_0_0)] shadow-[0_28px_90px_rgba(0,0,0,0.48)]"
      )}
    >
      <Handle
        id="node-in"
        type="target"
        position={Position.Left}
        className="!-left-1.5 !z-20 !size-3 !border-0 !bg-white/45"
      />
      <Handle
        id="node-out"
        type="source"
        position={Position.Right}
        className="!-right-1.5 !z-20 !size-3 !border-0 !bg-white/55"
      />

      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("grid size-8 place-items-center rounded-full", meta.glow)}>
            <Icon className={cn("size-4", meta.accent)} stroke={1.8} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[11px] font-semibold uppercase tracking-[0.16em] text-white/38">
              {data.eyebrow}
            </p>
            <h3 className="truncate text-[17px] font-semibold text-white/92">{data.label}</h3>
          </div>
        </div>
        <StatusPill status={data.status ?? "ready"} />
      </div>

      {data.image ? <NodeVisual type={data.image} /> : null}

      <p className="mt-3 line-clamp-3 text-[13px] leading-6 text-white/58">{data.summary}</p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {(data.chips ?? []).map((chip) => (
          <span
            key={chip}
            className="rounded-full bg-white/[0.065] px-2.5 py-1 text-[11px] text-white/58"
          >
            {chip}
          </span>
        ))}
      </div>

      <div className="mt-4">
        <NodeEditButton onClick={data.onEditNode} />
      </div>
    </article>
  );
}

const NODE_TYPES = { narrative: NarrativeNodeCard };

function useViewerClose(onClose: () => void) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      onClose();
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const closeFromPointer = useCallback(
    (event: SyntheticEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      window.requestAnimationFrame(onClose);
    },
    [onClose]
  );

  const closeFromClick = useCallback(
    (event: SyntheticEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    },
    [onClose]
  );

  return { closeFromClick, closeFromPointer };
}

function StoryRootViewer({
  storyRoot,
  onClose,
}: {
  storyRoot: NarrativeNodeData;
  onClose: () => void;
}) {
  const { closeFromClick, closeFromPointer } = useViewerClose(onClose);
  const sections =
    storyRoot.storyRootSections && storyRoot.storyRootSections.length > 0
      ? storyRoot.storyRootSections
      : STORY_ROOT_DOCUMENT_SECTIONS;
  const overviewCards = storyRoot.storyRootOverviewCards ?? [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="故事总纲查看器"
      className="fixed inset-0 z-[90] overflow-hidden bg-[oklch(0.03_0_0)] text-white duration-300 animate-in fade-in-0"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_28%,rgba(242,26,167,0.08),transparent_28%),radial-gradient(circle_at_52%_18%,rgba(255,255,255,0.05),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.025),transparent_24%,rgba(0,0,0,0.5))] duration-500 animate-in fade-in-0 zoom-in-95" />

      <button
        type="button"
        className="absolute left-8 top-7 z-[110] grid size-11 place-items-center rounded-full bg-white/10 text-white/58 backdrop-blur-xl transition duration-300 animate-in fade-in-0 slide-in-from-top-3 hover:bg-white/15 hover:text-white"
        aria-label="查看历史"
      >
        <IconClock className="size-5" />
      </button>

      <div className="absolute right-8 top-7 z-[110] flex items-center gap-3 duration-300 animate-in fade-in-0 slide-in-from-top-3">
        <div className="flex h-11 items-center gap-1 rounded-full bg-white/10 p-1 text-white/58 backdrop-blur-xl">
          <button
            type="button"
            className="grid size-9 place-items-center rounded-full transition hover:bg-white/10 hover:text-white"
            aria-label="刷新"
          >
            <IconRefresh className="size-5" />
          </button>
          <button
            type="button"
            className="grid size-9 place-items-center rounded-full transition hover:bg-white/10 hover:text-white"
            aria-label="编辑"
          >
            <IconEdit className="size-5" />
          </button>
        </div>
        <button
          type="button"
          data-testid="close-story-root-viewer"
          onPointerDown={closeFromPointer}
          onClick={closeFromClick}
          className="grid size-11 place-items-center rounded-full bg-white/10 text-white/62 backdrop-blur-xl transition hover:bg-white/15 hover:text-white"
          aria-label="关闭故事总纲"
        >
          <IconX className="size-5" />
        </button>
      </div>

      <article className="relative mx-auto h-full w-full max-w-[860px] overflow-y-auto px-8 pb-40 pt-14 duration-500 animate-in fade-in-0 slide-in-from-bottom-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <header className="mb-10">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/30">
            Story Root
          </p>
          <h1 className="mt-3 text-[42px] font-black leading-tight tracking-tight text-white/94">
            {storyRoot.label}
          </h1>
          <p className="mt-5 text-[18px] font-semibold leading-8 text-white/56">
            {storyRoot.summary}
          </p>
          {overviewCards.length > 0 ? (
            <div className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {overviewCards.slice(0, 3).map((card) => (
                <div key={card.label} className="rounded-[22px] bg-white/[0.055] p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/28">
                    {card.label}
                  </p>
                  <p className="mt-2 text-sm font-semibold leading-6 text-white/66">{card.value}</p>
                </div>
              ))}
            </div>
          ) : null}
        </header>

        <div className="space-y-10">
          {sections.map((section) => (
            <section key={section.heading}>
              <h2 className="text-[27px] font-black leading-tight tracking-normal text-white/92">
                {section.heading}
              </h2>
              <div className="mt-5 space-y-5">
                {section.paragraphs.map((paragraph) => (
                  <p
                    key={paragraph}
                    className="text-[18px] font-semibold leading-9 tracking-normal text-white/64"
                  >
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </article>

      <div className="absolute bottom-9 left-1/2 flex h-14 w-[min(560px,calc(100vw-48px))] -translate-x-1/2 items-center gap-3 rounded-[18px] bg-[oklch(0.22_0_0)/0.9] px-5 shadow-[0_18px_70px_rgba(0,0,0,0.45)] backdrop-blur-2xl duration-500 animate-in fade-in-0 slide-in-from-bottom-5 zoom-in-95">
        <input
          aria-label="描述修改内容"
          placeholder="描述你想修改的内容..."
          className="h-full min-w-0 flex-1 bg-transparent text-[15px] font-semibold text-white/80 outline-none placeholder:text-white/32"
        />
        <button
          type="button"
          className="grid size-10 place-items-center rounded-full bg-[#b33a8e] text-white shadow-[0_8px_24px_rgba(179,58,142,0.26)] transition hover:bg-[#cf49a4]"
          aria-label="发送修改"
        >
          <IconSend className="size-5" />
        </button>
      </div>
    </div>
  );
}

function CharacterViewer({
  character,
  onClose,
}: {
  character: NarrativeNodeData;
  onClose: () => void;
}) {
  const { closeFromClick, closeFromPointer } = useViewerClose(onClose);
  const isProtagonist = character.characterMode === "protagonist";
  const detailSections = isProtagonist
    ? CHARACTER_DOCUMENT_SECTIONS
    : [
        {
          heading: "角色定位",
          icon: IconFingerprint,
          paragraphs: [
            character.summary,
            `当前标签：${(character.chips ?? ["待补充"]).join("、")}。`,
          ],
        },
        {
          heading: "AI 扮演规则",
          icon: IconEye,
          paragraphs: [
            "AI 只能在当前剧情节点允许的信息范围内调用这个角色，不能让角色凭空知道未接触过的证据。",
            "当玩家自由输入触发该角色时，AI 需要先判断角色是否在场、是否愿意回应、以及回应会带来什么关系变化。",
          ],
        },
        {
          heading: "关系锚点",
          icon: IconUsersGroup,
          paragraphs: [
            "这张角色卡与故事总纲根节点相连，表示它是全局重要角色。具体出场、对话和触发条件应在剧情节点里绑定。",
          ],
        },
      ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="角色卡查看器"
      className="fixed inset-0 z-[90] overflow-hidden bg-[oklch(0.035_0_0)] text-white duration-300 animate-in fade-in-0"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_24%_18%,rgba(255,255,255,0.06),transparent_24%),radial-gradient(circle_at_72%_34%,rgba(255,255,255,0.04),transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent_24%,rgba(0,0,0,0.58))] duration-500 animate-in fade-in-0 zoom-in-95" />

      <button
        type="button"
        className="absolute left-8 top-7 z-[110] grid size-11 place-items-center rounded-full bg-white/10 text-white/58 backdrop-blur-xl transition duration-300 animate-in fade-in-0 slide-in-from-top-3 hover:bg-white/15 hover:text-white"
        aria-label="查看角色历史"
      >
        <IconClock className="size-5" />
      </button>

      <div className="absolute right-8 top-7 z-[110] flex items-center gap-3 duration-300 animate-in fade-in-0 slide-in-from-top-3">
        <div className="flex h-11 items-center gap-1 rounded-full bg-white/10 p-1 text-white/58 backdrop-blur-xl">
          <button
            type="button"
            className="grid size-9 place-items-center rounded-full transition hover:bg-white/10 hover:text-white"
            aria-label="刷新角色"
          >
            <IconRefresh className="size-5" />
          </button>
          <button
            type="button"
            className="grid size-9 place-items-center rounded-full transition hover:bg-white/10 hover:text-white"
            aria-label="编辑角色"
          >
            <IconEdit className="size-5" />
          </button>
        </div>
        <button
          type="button"
          data-testid="close-character-viewer"
          onPointerDown={closeFromPointer}
          onClick={closeFromClick}
          className="grid size-11 place-items-center rounded-full bg-white/10 text-white/62 backdrop-blur-xl transition hover:bg-white/15 hover:text-white"
          aria-label="关闭角色卡"
        >
          <IconX className="size-5" />
        </button>
      </div>

      <div className="relative mx-auto grid h-full w-full max-w-[1180px] grid-cols-[340px_1fr] gap-10 overflow-hidden px-8 pb-36 pt-20 duration-500 animate-in fade-in-0 slide-in-from-bottom-8">
        <aside className="min-h-0 rounded-[34px] bg-white/[0.055] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.34)] backdrop-blur-xl">
          <CharacterPortrait portrait={character.characterPortrait ?? "neutral"} />
          <p className="mt-5 text-xs font-semibold tracking-[0.18em] text-white/36">
            {character.eyebrow}
          </p>
          <h2 className="mt-2 text-[34px] font-black leading-tight tracking-normal text-white/94">
            {character.label}
          </h2>
          <p className="mt-4 text-[14px] font-semibold leading-7 text-white/56">
            {character.summary}
          </p>

          {isProtagonist ? (
            <div className="mt-6 space-y-4">
              {CHARACTER_ABILITIES.map((ability) => (
                <div key={ability.label} className="rounded-[22px] bg-black/16 p-4">
                  <AbilityMeter label={ability.label} value={ability.value} />
                  <p className="mt-3 text-xs font-semibold leading-5 text-white/42">
                    {ability.detail}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-6 flex flex-wrap gap-2">
              {(character.chips ?? []).map((chip) => (
                <span
                  key={chip}
                  className="rounded-full bg-black/18 px-3 py-1.5 text-xs font-semibold text-white/48"
                >
                  {chip}
                </span>
              ))}
            </div>
          )}
        </aside>

        <article className="min-h-0 overflow-y-auto pr-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="space-y-6 pb-10">
            {detailSections.map((section) => {
              const SectionIcon = section.icon;
              return (
                <section key={section.heading} className="rounded-[34px] bg-white/[0.045] p-6">
                  <div className="flex items-center gap-3">
                    <span className="grid size-10 place-items-center rounded-full bg-white/10 text-white/72">
                      <SectionIcon className="size-5" />
                    </span>
                    <h3 className="text-[24px] font-black leading-tight text-white/92">
                      {section.heading}
                    </h3>
                  </div>
                  <div className="mt-5 space-y-4">
                    {section.paragraphs.map((paragraph) => (
                      <p
                        key={paragraph}
                        className="text-[16px] font-semibold leading-8 text-white/60"
                      >
                        {paragraph}
                      </p>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </article>
      </div>

      <div className="absolute bottom-9 left-1/2 flex h-14 w-[min(560px,calc(100vw-48px))] -translate-x-1/2 items-center gap-3 rounded-[18px] bg-[oklch(0.22_0_0)/0.9] px-5 shadow-[0_18px_70px_rgba(0,0,0,0.45)] backdrop-blur-2xl duration-500 animate-in fade-in-0 slide-in-from-bottom-5 zoom-in-95">
        <input
          aria-label="描述角色修改内容"
          placeholder="描述你想修改的角色设定..."
          className="h-full min-w-0 flex-1 bg-transparent text-[15px] font-semibold text-white/80 outline-none placeholder:text-white/32"
        />
        <button
          type="button"
          className="grid size-10 place-items-center rounded-full bg-white text-black shadow-[0_8px_24px_rgba(0,0,0,0.26)] transition hover:bg-white/88"
          aria-label="发送角色修改"
        >
          <IconSend className="size-5" />
        </button>
      </div>
    </div>
  );
}

const INTENT_KEYWORDS: Record<string, string[]> = {
  观察环境: ["观察", "看看", "打量", "环境", "校门", "保安", "反应"],
  检查转学通知书: ["通知书", "转学", "文件", "日期", "检查"],
  询问接待老师: ["老师", "接待", "询问", "问"],
  联系哥哥: ["哥哥", "联系", "短信", "电话", "消息", "已读"],
  拒绝配合或保持沉默: ["拒绝", "沉默", "不配合", "不说", "站着"],
  询问同桌: ["同桌", "同学", "问", "询问"],
  观察老师反应: ["老师", "反应", "表情", "停顿", "紧张"],
  查看公告栏: ["公告", "公告栏", "栏"],
  回忆刚才的低声对话: ["回忆", "低声", "对话", "刚才", "听到"],
  用假设试探同学: ["假设", "试探", "故意", "假装", "紧张"],
  核对时间线: ["时间", "时间线", "重排", "顺序"],
  比较签名顺序: ["签名", "顺序", "排序"],
  追问报告措辞: ["报告", "措辞", "追问", "文字"],
  寻找缺失见证人: ["见证人", "名单", "缺失", "谁不在"],
  请求查看原始记录: ["原始", "记录", "查看", "调取"],
};

const BLOCKED_INPUT_KEYWORDS: Record<PlotNodeId, string[]> = {
  arrival: ["死人", "溺亡", "凶手", "真凶", "杀", "校长办公室", "校长", "监控"],
  rumor: ["真凶", "凶手是", "校长办公室", "监控权限", "删监控", "抓人"],
  report: ["真凶", "直接抓", "已经知道谁删", "调出全部监控", "校长就是"],
};

function inputHasAnyKeyword(input: string, keywords: string[]) {
  return keywords.some((keyword) => input.includes(keyword.toLowerCase()));
}

function inferPlotIntent(plot: PlotNodeDetail, normalizedInput: string) {
  return (
    plot.openIntents.find((intent) =>
      inputHasAnyKeyword(normalizedInput, INTENT_KEYWORDS[intent] ?? [intent])
    ) ?? null
  );
}

function chooseUnlockedClue(plot: PlotNodeDetail, normalizedInput: string) {
  const clueKeywords = [
    ["保安", "姓名"],
    ["哥哥", "已读"],
    ["通知书", "日期"],
    ["同学", "时间段"],
    ["老师", "水域", "停顿"],
    ["公告", "措辞"],
    ["签名", "顺序"],
    ["17", "分钟"],
    ["见证人", "名单"],
  ];

  return (
    plot.unlocksClues.find((clue) =>
      clueKeywords.some(
        (keywords) =>
          keywords.some((keyword) => normalizedInput.includes(keyword)) &&
          keywords.some((keyword) => clue.includes(keyword))
      )
    ) ?? plot.unlocksClues[0]
  );
}

function simulatePlotAnswer(plot: PlotNodeDetail, rawInput: string): PlotSimulationResult {
  const input = rawInput.trim();
  const normalizedInput = input.toLowerCase();

  if (!input) {
    return {
      status: "blocked",
      intent: "未输入",
      reason: "需要先输入一句玩家行为，才能判定它是否属于当前剧情节点。",
      unlockedClues: [],
      riskChanges: [],
      progress: "未开始判定",
      replyPreview: "等待玩家行动。",
      checks: ["输入为空", "未执行意图归类", "未触发剧情推进"],
    };
  }

  const matchedIntent = inferPlotIntent(plot, normalizedInput);
  const isBlocked = inputHasAnyKeyword(normalizedInput, BLOCKED_INPUT_KEYWORDS[plot.id]);

  if (isBlocked) {
    return {
      status: "blocked",
      intent: "越界行为",
      reason: "玩家输入触碰了当前节点不允许提前处理的内容，AI 不能让剧情跳到后续真相。",
      unlockedClues: [],
      riskChanges: plot.riskTriggers.slice(0, 2),
      progress: "不满足退出条件，停留在当前剧情节点。",
      replyPreview:
        "AI 回复预览：你刚要把话说出口，接待老师已经挡在前面。这个问题来得太早，也太危险。",
      checks: ["命中边界规则", "缺少必要线索", "阻止直接推进"],
    };
  }

  if (!matchedIntent) {
    return {
      status: "partial",
      intent: "需要二次归类",
      reason: "这句输入没有明显落入当前允许意图，但可以让 AI 追问玩家的具体做法。",
      unlockedClues: [],
      riskChanges: [],
      progress: "不直接推进，先生成澄清反馈。",
      replyPreview:
        "AI 回复预览：你可以这样做，但需要说明你打算观察谁、询问谁，或者检查哪个具体物件。",
      checks: ["未命中允许意图", "未违反硬边界", "建议追问玩家"],
    };
  }

  const unlockedClue = chooseUnlockedClue(plot, normalizedInput);
  const risky = inputHasAnyKeyword(normalizedInput, [
    "哥哥",
    "拒绝",
    "质疑",
    "公开",
    "原始",
    "记录",
  ]);

  return {
    status: "allowed",
    intent: matchedIntent,
    reason: "玩家输入可以映射到当前节点允许的自由意图，AI 可以接住并给出受控反馈。",
    unlockedClues: unlockedClue ? [unlockedClue] : [],
    riskChanges: risky ? plot.riskTriggers.slice(0, 1) : [],
    progress: "满足 1 个局部推进条件，但不会自动跳到下一剧情节点。",
    replyPreview:
      "AI 回复预览：你放慢动作，把注意力集中在细节上。表面一切正常，但某个反应和这里的秩序不太匹配。",
    checks: ["命中允许意图", "未违反边界", "返回观察/线索/风险，而不是直接给答案"],
  };
}

function SimulationStatusPill({ status }: { status: PlotSimulationStatus }) {
  const label = status === "allowed" ? "允许" : status === "partial" ? "需追问" : "阻止";

  return (
    <span
      className={cn(
        "rounded-full px-3 py-1 text-xs font-black",
        status === "allowed" && "bg-white text-black",
        status === "partial" && "bg-white/12 text-white/74",
        status === "blocked" && "bg-[#E52227]/16 text-[#ff9b9e]"
      )}
    >
      {label}
    </span>
  );
}

function PlotViewer({ plot, onClose }: { plot: PlotNodeDetail; onClose: () => void }) {
  const { closeFromClick, closeFromPointer } = useViewerClose(onClose);
  const [testInput, setTestInput] = useState(plot.sampleInputs[0]?.input ?? "");
  const [simulation, setSimulation] = useState<PlotSimulationResult | null>(null);

  const runSimulation = useCallback(
    (value = testInput) => {
      const nextResult = simulatePlotAnswer(plot, value);
      setTestInput(value);
      setSimulation(nextResult);
    },
    [plot, testInput]
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${plot.title}剧情节点详情`}
      className="fixed inset-0 z-[90] overflow-hidden bg-[oklch(0.035_0_0)] text-white duration-300 animate-in fade-in-0"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_24%_18%,rgba(255,255,255,0.06),transparent_24%),radial-gradient(circle_at_72%_34%,rgba(255,255,255,0.04),transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent_24%,rgba(0,0,0,0.58))] duration-500 animate-in fade-in-0 zoom-in-95" />

      <article className="relative mx-auto flex h-full w-full max-w-[1240px] flex-col overflow-y-auto px-8 pb-10 pt-16 duration-500 animate-in fade-in-0 slide-in-from-bottom-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="bg-white/[0.04] p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-4">
              <span className="grid size-14 shrink-0 place-items-center rounded-full bg-white text-[22px] font-black text-black">
                {plot.stage}
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/36">
                  可玩剧情节点
                </p>
                <h2 className="mt-1 text-[28px] font-black leading-tight text-white/94">
                  {plot.title}
                </h2>
                <p className="mt-2 text-sm font-semibold text-white/42">{plot.scene}</p>
              </div>
            </div>
            <button
              type="button"
              data-testid="close-plot-viewer"
              onPointerDown={closeFromPointer}
              onClick={closeFromClick}
              className="grid size-10 shrink-0 place-items-center rounded-full bg-white/8 text-white/58 transition hover:bg-white/12 hover:text-white"
              aria-label="关闭剧情节点详情"
            >
              <IconX className="size-5" />
            </button>
          </div>

          <div className="mt-5 rounded-[26px] bg-black/18 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/34">
              当前目标
            </p>
            <p className="mt-2 text-[15px] font-semibold leading-7 text-white/70">{plot.goal}</p>
          </div>

          <div className="mt-5 grid grid-cols-[minmax(0,1fr)_260px] gap-4 rounded-[28px] bg-black/18 p-4">
            <div className="relative overflow-hidden rounded-[22px] bg-black/30">
              <video
                src={plot.entryVideo.src}
                controls
                muted
                playsInline
                preload="metadata"
                className="aspect-video w-full object-cover"
              />
            </div>
            <div className="flex min-w-0 flex-col justify-between gap-4 py-1">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-white/[0.075] px-3 py-1 text-[11px] font-black text-white/58">
                  <IconVideo className="size-3.5" />
                  剧情入场视频
                </div>
                <h3 className="mt-3 text-lg font-black leading-tight text-white/88">
                  {plot.entryVideo.title}
                </h3>
                <p className="mt-3 text-xs font-semibold leading-6 text-white/46">
                  {plot.entryVideo.description}
                </p>
              </div>
              <p className="rounded-[18px] bg-white/[0.055] p-3 text-[11px] font-semibold leading-5 text-white/40">
                玩家端建议：进入新剧情节点时先播放，可跳过；播放结束后继续显示文字和自由输入。
              </p>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="grid grid-cols-2 gap-4">
            <section className="rounded-[28px] bg-white/[0.055] p-4">
              <div className="flex items-center gap-2">
                <IconMessageCircle className="size-4 text-white/60" />
                <div>
                  <h3 className="text-sm font-black text-white/86">玩家自由行动</h3>
                  <p className="mt-1 text-xs font-semibold text-white/36">
                    玩家可以自然输入，AI 会归类到这些行动方向。
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {plot.openIntents.map((intent) => (
                  <span
                    key={intent}
                    className="rounded-full bg-white/[0.075] px-3 py-1.5 text-xs font-semibold text-white/62"
                  >
                    {intent}
                  </span>
                ))}
              </div>
            </section>

            <section className="rounded-[28px] bg-white/[0.055] p-4">
              <div className="flex items-center gap-2">
                <IconMessageCircle className="size-4 text-white/60" />
                <h3 className="text-sm font-black text-white/86">剧情内行动点</h3>
              </div>
              <p className="mt-2 text-xs font-semibold leading-5 text-white/42">
                玩家自由输入或点击建议时，AI
                会把动作归类到这些行动点；命中后更新线索、风险或状态，通常仍留在当前剧情阶段。
              </p>
              <div className="mt-4 space-y-2">
                {plot.internalActions.map((action) => (
                  <div
                    key={action}
                    className="flex min-h-10 w-full items-center rounded-[18px] bg-white/[0.075] px-4 text-left text-xs font-semibold leading-5 text-white/64"
                  >
                    {action}
                  </div>
                ))}
              </div>
            </section>
          </div>

          <section className="mt-4 rounded-[28px] bg-white/[0.055] p-4">
            <div className="flex items-center gap-2">
              <IconFingerprint className="size-4 text-white/60" />
              <h3 className="text-sm font-black text-white/86">线索出现点</h3>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {plot.unlocksClues.map((clue) => (
                <div key={clue} className="rounded-[18px] bg-black/16 p-3">
                  <p className="text-xs font-semibold leading-5 text-white/62">{clue}</p>
                </div>
              ))}
            </div>
          </section>

          <div className="mt-4 grid grid-cols-2 gap-4">
            <section className="rounded-[28px] bg-white/[0.055] p-4">
              <h3 className="text-sm font-black text-white/86">进入条件</h3>
              <div className="mt-4 space-y-2">
                {plot.entryConditions.map((condition) => (
                  <div
                    key={condition}
                    className="flex gap-2 text-xs font-semibold leading-5 text-white/54"
                  >
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-white/42" />
                    {condition}
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-[28px] bg-white/[0.055] p-4">
              <h3 className="text-sm font-black text-white/86">退出条件</h3>
              <div className="mt-4 space-y-2">
                {plot.exitConditions.map((condition) => (
                  <div
                    key={condition}
                    className="flex gap-2 text-xs font-semibold leading-5 text-white/54"
                  >
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-white/42" />
                    {condition}
                  </div>
                ))}
              </div>
            </section>
          </div>

          <section className="mt-4 rounded-[28px] bg-white/[0.055] p-4">
            <div className="flex items-center gap-2">
              <IconShieldCheck className="size-4 text-white/60" />
              <h3 className="text-sm font-black text-white/86">AI 约束</h3>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-[22px] bg-black/16 p-4">
                <p className="text-xs font-black text-white/70">边界</p>
                <div className="mt-3 space-y-2">
                  {plot.guardrails.map((rule) => (
                    <p key={rule} className="text-xs font-semibold leading-5 text-white/48">
                      {rule}
                    </p>
                  ))}
                </div>
              </div>
              <div className="rounded-[22px] bg-black/16 p-4">
                <p className="text-xs font-black text-white/70">检查</p>
                <div className="mt-3 space-y-2">
                  {plot.aiChecks.map((check) => (
                    <p key={check} className="text-xs font-semibold leading-5 text-white/48">
                      {check}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="mt-4 rounded-[28px] bg-white/[0.055] p-4">
            <div className="flex items-center gap-2">
              <IconSparkles className="size-4 text-white/60" />
              <h3 className="text-sm font-black text-white/86">自由输入样例</h3>
            </div>
            <div className="mt-4 space-y-3">
              {plot.sampleInputs.map((sample) => (
                <div key={sample.input} className="rounded-[22px] bg-black/16 p-4">
                  <p className="text-sm font-semibold leading-6 text-white/74">“{sample.input}”</p>
                  <p className="mt-3 text-xs font-semibold leading-5 text-white/46">
                    {sample.result}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-4 rounded-[28px] bg-white/[0.055] p-4">
            <h3 className="text-sm font-black text-white/86">风险触发</h3>
            <div className="mt-4 space-y-2">
              {plot.riskTriggers.map((risk) => (
                <div
                  key={risk}
                  className="flex items-center gap-2 text-xs font-semibold text-white/52"
                >
                  <span className="size-1.5 rounded-full bg-[#E52227]/72" />
                  {risk}
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="p-5">
          {simulation ? (
            <div
              data-testid="plot-simulation-result"
              className="mb-3 max-h-64 overflow-y-auto rounded-[26px] bg-[oklch(0.235_0_0)] p-4 shadow-[0_16px_48px_rgba(0,0,0,0.28)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/34">
                    模拟判定
                  </p>
                  <h3 className="mt-1 text-lg font-black text-white/92">{simulation.intent}</h3>
                </div>
                <SimulationStatusPill status={simulation.status} />
              </div>

              <p className="mt-3 text-sm font-semibold leading-6 text-white/62">
                {simulation.reason}
              </p>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-[18px] bg-black/18 p-3">
                  <p className="text-[11px] font-black text-white/58">线索</p>
                  <div className="mt-2 space-y-1.5">
                    {(simulation.unlockedClues.length
                      ? simulation.unlockedClues
                      : ["无新线索"]
                    ).map((clue) => (
                      <p key={clue} className="text-xs font-semibold leading-5 text-white/48">
                        {clue}
                      </p>
                    ))}
                  </div>
                </div>
                <div className="rounded-[18px] bg-black/18 p-3">
                  <p className="text-[11px] font-black text-white/58">风险</p>
                  <div className="mt-2 space-y-1.5">
                    {(simulation.riskChanges.length ? simulation.riskChanges : ["无额外风险"]).map(
                      (risk) => (
                        <p key={risk} className="text-xs font-semibold leading-5 text-white/48">
                          {risk}
                        </p>
                      )
                    )}
                  </div>
                </div>
              </div>

              <p className="mt-3 rounded-[18px] bg-black/18 p-3 text-xs font-semibold leading-5 text-white/52">
                {simulation.progress}
              </p>
              <p className="mt-3 text-xs font-semibold leading-5 text-white/48">
                {simulation.replyPreview}
              </p>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {simulation.checks.map((check) => (
                  <span
                    key={check}
                    className="rounded-full bg-white/[0.065] px-2.5 py-1 text-[10px] font-semibold text-white/46"
                  >
                    {check}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mb-3 flex gap-2">
            {plot.sampleInputs.map((sample, index) => (
              <button
                key={sample.input}
                type="button"
                onClick={() => runSimulation(sample.input)}
                className="min-w-0 flex-1 rounded-full bg-white/[0.075] px-3 py-2 text-xs font-semibold text-white/58 transition hover:bg-white/12 hover:text-white"
              >
                {index === 0 ? "跑成功样例" : "跑阻止样例"}
              </button>
            ))}
          </div>

          <div className="flex h-14 items-center gap-3 rounded-[22px] bg-[oklch(0.235_0_0)] px-4 shadow-[0_16px_48px_rgba(0,0,0,0.28)]">
            <input
              aria-label="测试玩家自由输入"
              value={testInput}
              onChange={(event) => setTestInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  runSimulation();
                }
              }}
              placeholder="输入一句玩家行动，测试 AI 如何归类、阻止或推进..."
              className="h-full min-w-0 flex-1 bg-transparent text-sm font-semibold text-white/78 outline-none placeholder:text-white/32"
            />
            <button
              type="button"
              data-testid="run-plot-simulation"
              onClick={() => runSimulation()}
              className="grid size-10 shrink-0 place-items-center rounded-full bg-white text-black transition hover:bg-white/88 active:translate-y-0.5"
              aria-label="测试判定"
            >
              <IconSend className="size-5" />
            </button>
          </div>
        </div>
      </article>
    </div>
  );
}

function StatusPill({ status }: { status: NonNullable<NarrativeNodeData["status"]> }) {
  const label = status === "working" ? "生成中" : status === "review" ? "待审阅" : "已就绪";
  return (
    <span
      className={cn(
        "rounded-full px-2 py-1 text-[10px] font-semibold tracking-[0.08em]",
        status === "working" && "bg-white/10 text-white/64",
        status === "review" && "bg-[#e0c27a]/16 text-[#e0c27a]",
        status === "ready" && "bg-white/12 text-white/78"
      )}
    >
      {label}
    </span>
  );
}

function NodeVisual({ type }: { type: NonNullable<NarrativeNodeData["image"]> }) {
  if (type === "avatar") {
    return (
      <div className="grid h-44 place-items-center rounded-[20px] bg-[oklch(0.235_0_0)]">
        <div className="relative size-28 rounded-full bg-white/10">
          <div className="absolute left-1/2 top-7 size-14 -translate-x-1/2 rounded-full bg-white/28" />
          <div className="absolute bottom-4 left-1/2 h-12 w-20 -translate-x-1/2 rounded-[999px_999px_40px_40px] bg-white/18" />
          <div className="absolute left-7 top-12 size-2 rounded-full bg-black/70" />
          <div className="absolute right-7 top-12 size-2 rounded-full bg-black/70" />
        </div>
      </div>
    );
  }

  if (type === "scene") {
    return (
      <div className="relative h-44 overflow-hidden rounded-[20px] bg-[linear-gradient(180deg,oklch(0.28_0_0),oklch(0.16_0_0))]">
        <div className="absolute left-6 top-8 h-28 w-12 rounded-t-xl bg-white/10" />
        <div className="absolute left-24 top-4 h-36 w-16 rounded-t-xl bg-white/14" />
        <div className="absolute right-14 top-10 h-28 w-20 rounded-t-xl bg-white/9" />
        <div className="absolute bottom-0 left-0 right-0 h-16 bg-black/35" />
        <div className="absolute bottom-8 left-8 right-8 h-px bg-white/24" />
      </div>
    );
  }

  if (type === "board") {
    return (
      <div className="grid h-44 grid-cols-2 gap-2 rounded-[20px] bg-[oklch(0.235_0_0)] p-3">
        {["校门", "水域", "报告", "哥哥"].map((shot, index) => (
          <div key={shot} className="rounded-[14px] bg-white/[0.065] p-2">
            <div className="h-16 rounded-[10px] bg-white/12" />
            <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/44">
              {index + 1}. {shot}
            </p>
          </div>
        ))}
      </div>
    );
  }

  if (type === "item") {
    return (
      <div className="relative h-36 overflow-hidden rounded-[20px] bg-[linear-gradient(180deg,oklch(0.255_0_0),oklch(0.145_0_0))] p-4">
        <div className="absolute left-7 top-7 h-20 w-14 rotate-[-6deg] rounded-[10px] bg-white/14 shadow-[0_16px_34px_rgba(0,0,0,0.28)]" />
        <div className="absolute left-12 top-11 h-16 w-20 rotate-[5deg] rounded-[12px] bg-white/10 shadow-[0_16px_34px_rgba(0,0,0,0.28)]" />
        <div className="absolute bottom-5 left-6 right-6 h-px bg-white/20" />
        <div className="absolute bottom-4 left-4 inline-flex items-center gap-2 rounded-full bg-black/24 px-3 py-1 text-[10px] font-semibold text-white/52">
          <IconPackage className="size-3.5" />
          Item
        </div>
      </div>
    );
  }

  if (type === "sfx") {
    return (
      <div className="relative h-28 overflow-hidden rounded-[20px] bg-[linear-gradient(180deg,oklch(0.255_0_0),oklch(0.155_0_0))] p-4">
        <div className="absolute inset-x-4 top-1/2 h-px bg-white/12" />
        <div className="relative flex h-full items-center justify-between gap-1.5">
          {[18, 52, 34, 72, 26, 60, 38, 86, 30, 54, 24, 46].map((height, index) => (
            <span
              key={`${height}-${index}`}
              className="w-1.5 rounded-full bg-[#e0c27a]/55"
              style={{ height: `${height}%` }}
            />
          ))}
        </div>
        <div className="absolute bottom-4 left-4 inline-flex items-center gap-2 rounded-full bg-black/24 px-3 py-1 text-[10px] font-semibold text-white/52">
          <IconWaveSine className="size-3.5" />
          One-shot
        </div>
      </div>
    );
  }

  if (type === "music") {
    return (
      <div className="relative h-36 overflow-hidden rounded-[20px] bg-[linear-gradient(180deg,oklch(0.255_0_0),oklch(0.16_0_0))] p-4">
        <div className="absolute inset-x-4 top-1/2 h-px bg-white/14" />
        <div className="relative flex h-full items-center justify-between gap-2">
          {[32, 58, 44, 82, 36, 68, 52, 74, 40, 62].map((height, index) => (
            <span
              key={`${height}-${index}`}
              className="w-2 rounded-full bg-white/28"
              style={{ height: `${height}%` }}
            />
          ))}
        </div>
        <div className="absolute bottom-4 left-4 inline-flex items-center gap-2 rounded-full bg-black/24 px-3 py-1 text-[10px] font-semibold text-white/52">
          <IconMusic className="size-3.5" />
          BGM Cue
        </div>
      </div>
    );
  }

  if (type === "video") {
    return (
      <div className="relative h-44 overflow-hidden rounded-[20px] bg-[oklch(0.235_0_0)] p-3">
        <div className="grid h-full grid-cols-[1fr_72px] gap-3">
          <div className="relative overflow-hidden rounded-[16px] bg-[linear-gradient(180deg,oklch(0.31_0_0),oklch(0.13_0_0))]">
            <div className="absolute left-4 top-5 h-20 w-12 rounded-t-xl bg-white/12" />
            <div className="absolute bottom-4 left-4 right-4 h-px bg-white/22" />
            <span className="absolute left-1/2 top-1/2 grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-black">
              <IconPlayerPlay className="size-5" />
            </span>
          </div>
          <div className="grid gap-2">
            {[1, 2, 3].map((shot) => (
              <div key={shot} className="rounded-[12px] bg-white/[0.075]" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid h-36 place-items-center rounded-[20px] bg-[oklch(0.235_0_0)]">
      <div className="grid size-20 place-items-center rounded-3xl bg-white/10 text-[26px]">◇</div>
    </div>
  );
}

function AssetStatusPill({ status }: { status: AssetStatus }) {
  const label =
    status === "ready"
      ? "已就绪"
      : status === "draft"
        ? "草稿"
        : status === "generating"
          ? "生成中"
          : "缺素材";

  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-1 text-[10px] font-semibold",
        status === "ready" && "bg-white/12 text-white/76",
        status === "draft" && "bg-white/[0.075] text-white/52",
        status === "generating" && "bg-white/10 text-white/66",
        status === "missing" && "bg-[#E52227]/14 text-[#ff9b9e]"
      )}
    >
      {label}
    </span>
  );
}

function AssetDrawer({
  activeKind,
  onSelectKind,
  onClose,
  onAddAsset,
}: {
  activeKind: AssetKind;
  onSelectKind: (kind: AssetKind) => void;
  onClose: () => void;
  onAddAsset: (asset: AssetItem) => void;
}) {
  const [query, setQuery] = useState("");
  const activeMeta = ASSET_KIND_META[activeKind];
  const ActiveIcon = activeMeta.icon;

  const visibleAssets = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return ASSET_LIBRARY[activeKind];
    }

    return ASSET_LIBRARY[activeKind].filter((asset) =>
      [asset.title, asset.eyebrow, asset.summary, asset.meta, ...asset.tags]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery)
    );
  }, [activeKind, query]);

  return (
    <aside
      data-testid="asset-drawer"
      className="flex h-full w-[418px] flex-col overflow-hidden bg-[oklch(0.18_0_0)/0.96] text-white backdrop-blur-2xl duration-300 animate-in fade-in-0 slide-in-from-left-5"
      aria-label="资产抽屉"
    >
      <div className="bg-white/[0.04] p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-white/12">
              <ActiveIcon className="size-5 text-white/82" />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/36">
                {activeMeta.eyebrow}
              </p>
              <h2 className="mt-1 text-[24px] font-black leading-tight text-white/94">
                {activeMeta.label}资产
              </h2>
              <p className="mt-2 text-sm font-semibold leading-6 text-white/52">
                {activeMeta.description}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-10 shrink-0 place-items-center rounded-full bg-white/8 text-white/56 transition hover:bg-white/12 hover:text-white"
            aria-label="关闭资产抽屉"
          >
            <IconX className="size-5" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-1 rounded-[22px] bg-black/16 p-1">
          {ASSET_KIND_ORDER.map((kind) => {
            const meta = ASSET_KIND_META[kind];
            const Icon = meta.icon;
            const isActive = activeKind === kind;

            return (
              <button
                key={kind}
                type="button"
                onClick={() => onSelectKind(kind)}
                className={cn(
                  "flex h-10 items-center justify-center gap-1.5 rounded-[18px] text-xs font-semibold transition",
                  isActive
                    ? "bg-white text-black"
                    : "text-white/52 hover:bg-white/8 hover:text-white"
                )}
              >
                <Icon className="size-4" />
                {meta.label}
              </button>
            );
          })}
        </div>

        <label className="mt-4 flex h-11 items-center gap-3 rounded-full bg-black/18 px-4 text-white/48">
          <IconSearch className="size-4" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索当前资产..."
            className="h-full min-w-0 flex-1 bg-transparent text-sm font-semibold text-white/78 outline-none placeholder:text-white/32"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="mb-3 flex items-center justify-between px-1">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/34">
            {visibleAssets.length} 个资产
          </p>
          <button
            type="button"
            onClick={() => onAddAsset(ASSET_LIBRARY[activeKind][0])}
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white/10 px-3 text-xs font-semibold text-white/68 transition hover:bg-white/14 hover:text-white"
          >
            <IconSparkles className="size-3.5" />
            生成同类
          </button>
        </div>

        <div className="space-y-3">
          {visibleAssets.map((asset) => {
            const NodeIcon = KIND_META[asset.node.kind].icon;

            return (
              <article
                key={`${activeKind}-${asset.title}`}
                className="rounded-[26px] bg-white/[0.055] p-4 shadow-[0_14px_44px_rgba(0,0,0,0.22)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-white/10 text-white/72">
                      <NodeIcon className="size-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/34">
                        {asset.eyebrow}
                      </p>
                      <h3 className="mt-1 line-clamp-2 text-[17px] font-black leading-tight text-white/90">
                        {asset.title}
                      </h3>
                    </div>
                  </div>
                  <AssetStatusPill status={asset.status} />
                </div>

                <p className="mt-4 text-[13px] font-semibold leading-6 text-white/54">
                  {asset.summary}
                </p>
                <p className="mt-3 text-xs font-semibold text-white/34">{asset.meta}</p>

                <div className="mt-4 flex flex-wrap gap-1.5">
                  {asset.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-black/18 px-2.5 py-1 text-[11px] font-semibold text-white/46"
                    >
                      {tag}
                    </span>
                  ))}
                </div>

                <div className="mt-4 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    className="inline-flex h-9 items-center gap-2 rounded-full bg-white/[0.075] px-3 text-xs font-semibold text-white/58 transition hover:bg-white/12 hover:text-white"
                  >
                    <IconEye className="size-4" />
                    详情
                  </button>
                  <button
                    type="button"
                    onClick={() => onAddAsset(asset)}
                    className="inline-flex h-9 items-center gap-2 rounded-full bg-white px-3 text-xs font-black text-black transition hover:bg-white/88 active:translate-y-0.5"
                  >
                    <IconPlus className="size-4" />
                    加入画布
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

function parseEditorList(value: string) {
  return value
    .split(/[，,、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatEditorList(value?: string[]) {
  return (value ?? []).join("、");
}

function EditorField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="block">
      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/34">
        {label}
      </span>
      <div className="mt-2">{children}</div>
      {hint ? (
        <span className="mt-2 block text-xs font-semibold leading-5 text-white/34">{hint}</span>
      ) : null}
    </div>
  );
}

function EditorInput({
  value,
  onChange,
  placeholder,
}: {
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="h-11 w-full rounded-[18px] bg-black/18 px-4 text-sm font-semibold text-white/82 outline-none transition placeholder:text-white/24 focus:bg-black/26"
    />
  );
}

function EditorTextarea({
  value,
  onChange,
  placeholder,
  rows = 4,
}: {
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full resize-none rounded-[20px] bg-black/18 px-4 py-3 text-sm font-semibold leading-6 text-white/82 outline-none transition placeholder:text-white/24 focus:bg-black/26"
    />
  );
}

function NodeEditorPanel({
  node,
  onClose,
  onChange,
  onDelete,
}: {
  node: NarrativeNode;
  onClose: () => void;
  onChange: (patch: Partial<NarrativeNodeData>) => void;
  onDelete: () => void;
}) {
  const data = node.data;
  const meta = KIND_META[data.kind];
  const MetaIcon = meta.icon;

  const commonFields = (
    <div className="space-y-4">
      <EditorField label="标题">
        <EditorInput value={data.label} onChange={(label) => onChange({ label })} />
      </EditorField>
      <EditorField label="节点说明">
        <EditorTextarea
          value={data.summary}
          onChange={(summary) => onChange({ summary })}
          placeholder="这个节点在故事结构里负责什么？"
        />
      </EditorField>
      <EditorField label="标签">
        <EditorInput
          value={formatEditorList(data.chips)}
          onChange={(value) => onChange({ chips: parseEditorList(value) })}
          placeholder="用顿号、逗号或换行分隔"
        />
      </EditorField>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/34">状态</p>
        <div className="mt-2 grid grid-cols-3 gap-2 rounded-[20px] bg-black/16 p-1">
          {(
            [
              ["ready", "已就绪"],
              ["working", "生成中"],
              ["review", "待审阅"],
            ] as const
          ).map(([status, label]) => (
            <button
              key={status}
              type="button"
              onClick={() => onChange({ status })}
              className={cn(
                "h-10 rounded-[16px] text-xs font-black transition",
                data.status === status
                  ? "bg-white text-black"
                  : "text-white/46 hover:bg-white/8 hover:text-white"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  const typeFields = (() => {
    if (data.kind === "sfx") {
      return (
        <div className="space-y-4">
          <EditorField label="触发词" hint="AI 输出正文命中这些词时，玩家端才播放短音效。">
            <EditorTextarea
              value={formatEditorList(data.triggerPhrases)}
              onChange={(value) => onChange({ triggerPhrases: parseEditorList(value) })}
              rows={3}
            />
          </EditorField>
          <EditorField label="触发范围">
            <EditorInput
              value={data.triggerScope}
              onChange={(triggerScope) => onChange({ triggerScope })}
            />
          </EditorField>
          <EditorField label="绑定素材">
            <EditorInput
              value={data.boundAsset}
              onChange={(boundAsset) => onChange({ boundAsset })}
            />
          </EditorField>
          <EditorField label="播放规则">
            <EditorTextarea
              value={data.playbackRule}
              onChange={(playbackRule) => onChange({ playbackRule })}
              rows={3}
            />
          </EditorField>
        </div>
      );
    }

    if (data.kind === "condition") {
      return (
        <div className="space-y-4">
          <EditorField label="条件表达式">
            <EditorTextarea
              value={data.conditionExpression}
              onChange={(conditionExpression) => onChange({ conditionExpression })}
              rows={3}
            />
          </EditorField>
          <EditorField label="通过后">
            <EditorTextarea
              value={data.conditionPass}
              onChange={(conditionPass) => onChange({ conditionPass })}
              rows={3}
            />
          </EditorField>
          <EditorField label="未通过">
            <EditorTextarea
              value={data.conditionFail}
              onChange={(conditionFail) => onChange({ conditionFail })}
              rows={3}
            />
          </EditorField>
        </div>
      );
    }

    if (data.kind === "state") {
      return (
        <div className="space-y-4">
          <EditorField label="状态键">
            <EditorInput value={data.stateKey} onChange={(stateKey) => onChange({ stateKey })} />
          </EditorField>
          <EditorField label="初始值">
            <EditorTextarea
              value={data.stateValue}
              onChange={(stateValue) => onChange({ stateValue })}
              rows={3}
            />
          </EditorField>
          <EditorField label="更新规则">
            <EditorTextarea
              value={data.stateRule}
              onChange={(stateRule) => onChange({ stateRule })}
              rows={4}
            />
          </EditorField>
        </div>
      );
    }

    if (data.kind === "relationship") {
      return (
        <div className="space-y-4">
          <EditorField label="关系起点">
            <EditorInput
              value={data.relationshipFrom}
              onChange={(relationshipFrom) => onChange({ relationshipFrom })}
            />
          </EditorField>
          <EditorField label="关系终点">
            <EditorInput
              value={data.relationshipTo}
              onChange={(relationshipTo) => onChange({ relationshipTo })}
            />
          </EditorField>
          <EditorField label="关系类型">
            <EditorInput
              value={data.relationshipType}
              onChange={(relationshipType) => onChange({ relationshipType })}
            />
          </EditorField>
        </div>
      );
    }

    if (data.kind === "ending") {
      return (
        <div className="space-y-4">
          <EditorField label="结局类型">
            <div className="grid grid-cols-2 gap-2 rounded-[20px] bg-black/16 p-1">
              {(
                [
                  ["truth", "主线"],
                  ["intervention", "中断"],
                  ["failure", "失败"],
                  ["hidden", "隐藏"],
                ] as const
              ).map(([endingType, label]) => (
                <button
                  key={endingType}
                  type="button"
                  onClick={() => onChange({ endingType })}
                  className={cn(
                    "rounded-[16px] px-3 py-2 text-sm font-semibold transition",
                    data.endingType === endingType
                      ? "bg-white text-black"
                      : "text-white/46 hover:bg-white/8 hover:text-white"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </EditorField>
          <EditorField label="达成方式">
            <EditorTextarea
              value={data.endingTrigger}
              onChange={(endingTrigger) => onChange({ endingTrigger })}
              rows={4}
            />
          </EditorField>
          <EditorField label="结局复盘">
            <EditorTextarea
              value={data.endingReview}
              onChange={(endingReview) => onChange({ endingReview })}
              rows={4}
            />
          </EditorField>
        </div>
      );
    }

    if (data.kind === "clue") {
      return (
        <div className="space-y-4">
          <EditorField label="线索类型">
            <EditorInput value={data.clueType} onChange={(clueType) => onChange({ clueType })} />
          </EditorField>
          <EditorField label="来源">
            <EditorTextarea
              value={data.clueSource}
              onChange={(clueSource) => onChange({ clueSource })}
              rows={3}
            />
          </EditorField>
          <EditorField label="用途">
            <EditorTextarea
              value={data.clueUse}
              onChange={(clueUse) => onChange({ clueUse })}
              rows={3}
            />
          </EditorField>
          <EditorField label="AI 约束">
            <EditorTextarea
              value={data.clueRule}
              onChange={(clueRule) => onChange({ clueRule })}
              rows={4}
            />
          </EditorField>
        </div>
      );
    }

    if (data.kind === "role") {
      return (
        <div className="space-y-4">
          <EditorField label="角色定位">
            <div className="grid grid-cols-2 gap-2 rounded-[20px] bg-black/16 p-1">
              {(
                [
                  ["protagonist", "主角"],
                  ["relation", "关系角色"],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onChange({ characterMode: mode })}
                  className={cn(
                    "h-10 rounded-[16px] text-xs font-black transition",
                    data.characterMode === mode
                      ? "bg-white text-black"
                      : "text-white/46 hover:bg-white/8 hover:text-white"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </EditorField>
          <EditorField label="角色图片">
            <div className="grid grid-cols-2 gap-2 rounded-[20px] bg-black/16 p-1">
              {(
                [
                  ["protagonist", "少女主角"],
                  ["brother", "哥哥"],
                  ["victim", "溺亡同学"],
                  ["school", "校方"],
                  ["police", "警方"],
                  ["female", "女性"],
                  ["male", "男性"],
                  ["neutral", "中性"],
                ] as const
              ).map(([portrait, label]) => (
                <button
                  key={portrait}
                  type="button"
                  onClick={() => onChange({ characterPortrait: portrait, image: "avatar" })}
                  className={cn(
                    "h-10 rounded-[16px] text-xs font-black transition",
                    data.characterPortrait === portrait
                      ? "bg-white text-black"
                      : "text-white/46 hover:bg-white/8 hover:text-white"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </EditorField>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <EditorField label="补充信息">
          <EditorTextarea
            value={data.meta}
            onChange={(metaValue) => onChange({ meta: metaValue })}
            placeholder="素材规格、生成状态、运行说明或创作备注。"
            rows={4}
          />
        </EditorField>
      </div>
    );
  })();

  return (
    <aside
      data-testid="node-editor-panel"
      className="absolute bottom-6 right-6 top-[104px] z-50 flex w-[430px] flex-col overflow-hidden rounded-[32px] bg-[oklch(0.18_0_0)/0.94] text-white shadow-[0_28px_100px_rgba(0,0,0,0.52)] backdrop-blur-2xl duration-300 animate-in fade-in-0 slide-in-from-right-5"
      aria-label="节点编辑器"
    >
      <div className="bg-white/[0.04] px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className={cn("grid size-11 shrink-0 place-items-center rounded-full", meta.glow)}
            >
              <MetaIcon className={cn("size-5", meta.accent)} stroke={1.8} />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/36">
                {NODE_LIBRARY.find((item) => item.kind === data.kind)?.title ?? data.kind}
              </p>
              <h2 className="mt-1 line-clamp-2 text-xl font-black leading-tight text-white/94">
                {data.label}
              </h2>
              <p className="mt-2 text-xs font-semibold text-white/40">
                双击节点也可以快速打开这里。
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-10 shrink-0 place-items-center rounded-full bg-white/8 text-white/58 transition hover:bg-white/12 hover:text-white"
            aria-label="关闭节点编辑器"
          >
            <IconX className="size-5" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {commonFields}
        <div className="my-5 h-px bg-white/8" />
        {typeFields}
      </div>

      <div className="bg-black/14 p-5">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-[#E52227]/14 px-4 text-sm font-black text-[#ff9b9e] transition hover:bg-[#E52227]/20"
          >
            <IconX className="size-4" />
            移除节点
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-black text-black transition hover:bg-white/88 active:translate-y-0.5"
          >
            保存到画布
            <IconArrowUpRight className="size-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}

function getClientPoint(event: MouseEvent | TouchEvent) {
  if ("clientX" in event) {
    return {
      x: event.clientX,
      y: event.clientY,
    };
  }

  if ("changedTouches" in event && event.changedTouches.length > 0) {
    return {
      x: event.changedTouches[0].clientX,
      y: event.changedTouches[0].clientY,
    };
  }

  return { x: 0, y: 0 };
}

type NarrativeStudioInnerProps = {
  projectId?: string | null;
};

function NarrativeStudioInner({ projectId }: NarrativeStudioInnerProps) {
  const reactFlow = useReactFlow<NarrativeNode, NarrativeEdge>();
  const [nodes, setNodes, onNodesChange] = useNodesState<NarrativeNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<NarrativeEdge>([]);
  const [activeAssetKind, setActiveAssetKind] = useState<AssetKind | null>(null);
  const [activePlotId, setActivePlotId] = useState<PlotNodeId | null>(null);
  const [activeStoryRoot, setActiveStoryRoot] = useState<NarrativeNodeData | null>(null);
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedNodeCount, setSelectedNodeCount] = useState(0);
  const [activeCharacter, setActiveCharacter] = useState<NarrativeNodeData | null>(null);
  const [activeEditNodeId, setActiveEditNodeId] = useState<string | null>(null);
  const [canvasDocument, setCanvasDocument] = useState<ModeDocumentRef | null>(null);
  const [canvasTitle, setCanvasTitle] = useState("未命名故事");
  const [isCanvasLoading, setIsCanvasLoading] = useState(Boolean(projectId));
  const [hasHydratedCanvas, setHasHydratedCanvas] = useState(false);
  const [canvasLoadError, setCanvasLoadError] = useState<string | null>(null);
  const [canvasSaveState, setCanvasSaveState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  );
  const [canvasSaveError, setCanvasSaveError] = useState<string | null>(null);
  const [emptyCanvasPrompt, setEmptyCanvasPrompt] = useState("");
  const [emptyCanvasUploadName, setEmptyCanvasUploadName] = useState<string | null>(null);
  const [emptyCanvasUploadContent, setEmptyCanvasUploadContent] = useState<string | null>(null);
  const [emptyCanvasAnalyzeState, setEmptyCanvasAnalyzeState] = useState<
    "idle" | "loading" | "error"
  >("idle");
  const [emptyCanvasAnalyzeError, setEmptyCanvasAnalyzeError] = useState<string | null>(null);
  const connectStartRef = useRef<Parameters<OnConnectStart>[1] | null>(null);
  const emptyCanvasUploadRef = useRef<HTMLInputElement | null>(null);
  const emptyCanvasInputRef = useRef<HTMLInputElement | null>(null);
  const snapshotBaseRef = useRef<StoryCanvasSnapshot>({});
  const lastSavedSnapshotRef = useRef("");
  const portDraftCounterRef = useRef<Record<ConnectionPortId, number>>({
    roles: 0,
    clues: 0,
    assets: 0,
  });
  const isAssetDockOpen = activeAssetKind !== null;
  const leftDockWidth = isAssetDockOpen ? 500 : 82;
  const activeEditNode = useMemo(
    () => nodes.find((node) => node.id === activeEditNodeId) ?? null,
    [activeEditNodeId, nodes]
  );

  useEffect(() => {
    let isCancelled = false;

    async function hydrateCanvas() {
      setCanvasLoadError(null);
      setCanvasSaveError(null);
      setCanvasSaveState("idle");
      setHasHydratedCanvas(false);

      if (!projectId) {
        const emptySnapshot = buildStoryCanvasSnapshot({}, [], []);
        snapshotBaseRef.current = {};
        lastSavedSnapshotRef.current = JSON.stringify(emptySnapshot);
        setCanvasDocument(null);
        setCanvasTitle("未命名故事");
        setNodes([]);
        setEdges([]);
        setIsCanvasLoading(false);
        setHasHydratedCanvas(true);
        return;
      }

      setIsCanvasLoading(true);

      try {
        const ensuredDocument = await ensureCanvasDocument(projectId);
        const detailedDocument =
          ensuredDocument.contentSnapshot === undefined
            ? await getDocument(ensuredDocument.id)
            : ensuredDocument;

        if (isCancelled) return;

        const parsed = parseStoryCanvasSnapshot(detailedDocument.contentSnapshot);
        const title =
          typeof parsed.base.title === "string" && parsed.base.title.trim()
            ? parsed.base.title
            : detailedDocument.title;
        const snapshotForSignature = buildStoryCanvasSnapshot(
          parsed.base,
          parsed.nodes,
          parsed.edges
        );

        snapshotBaseRef.current = parsed.base;
        lastSavedSnapshotRef.current = JSON.stringify(snapshotForSignature);
        setCanvasDocument(detailedDocument);
        setCanvasTitle(title || "未命名故事");
        setNodes(parsed.nodes);
        setEdges(parsed.edges);
      } catch (error) {
        if (isCancelled) return;
        setCanvasDocument(null);
        setCanvasTitle("未命名故事");
        setNodes([]);
        setEdges([]);
        setCanvasLoadError(error instanceof Error ? error.message : "无法读取项目画布");
      } finally {
        if (!isCancelled) {
          setIsCanvasLoading(false);
          setHasHydratedCanvas(true);
        }
      }
    }

    void hydrateCanvas();

    return () => {
      isCancelled = true;
    };
  }, [projectId, setEdges, setNodes]);

  useEffect(() => {
    if (!hasHydratedCanvas || isCanvasLoading || !canvasDocument?.id) return;

    const nextSnapshot = buildStoryCanvasSnapshot(snapshotBaseRef.current, nodes, edges);
    const nextSignature = JSON.stringify(nextSnapshot);

    if (nextSignature === lastSavedSnapshotRef.current) return;

    const timer = window.setTimeout(async () => {
      setCanvasSaveState("saving");
      setCanvasSaveError(null);

      try {
        const updatedDocument = await updateDocumentSnapshot(canvasDocument.id, {
          title: canvasTitle || canvasDocument.title,
          contentSnapshot: nextSnapshot,
        });

        snapshotBaseRef.current = nextSnapshot;
        lastSavedSnapshotRef.current = nextSignature;
        setCanvasDocument(updatedDocument);
        setCanvasSaveState("saved");
      } catch (error) {
        setCanvasSaveState("error");
        setCanvasSaveError(error instanceof Error ? error.message : "保存画布失败");
      }
    }, 700);

    return () => window.clearTimeout(timer);
  }, [
    canvasDocument?.id,
    canvasDocument?.title,
    canvasTitle,
    edges,
    hasHydratedCanvas,
    isCanvasLoading,
    nodes,
  ]);

  const openNodeEditor = useCallback((nodeId: string) => {
    setIsAssistantOpen(false);
    setActiveEditNodeId(nodeId);
  }, []);

  const updateNodeData = useCallback(
    (nodeId: string, patch: Partial<NarrativeNodeData>) => {
      setNodes((current) =>
        current.map((node) =>
          node.id === nodeId ? { ...node, data: { ...node.data, ...patch } } : node
        )
      );
    },
    [setNodes]
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      setNodes((current) => current.filter((node) => node.id !== nodeId));
      setEdges((current) =>
        current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId)
      );
      setActiveEditNodeId(null);
    },
    [setEdges, setNodes]
  );

  const nodesWithActions = useMemo(() => {
    const storyRootStats: StoryRootStats = {
      roleCount: nodes.filter((node) => node.data.kind === "role").length,
      plotCount: nodes.filter((node) => node.data.kind === "plot").length,
      clueCount: nodes.filter((node) => node.data.kind === "clue").length,
      endingCount: nodes.filter((node) => node.data.kind === "ending").length,
    };

    return nodes.map((node) => {
      const dataWithEdit = {
        ...node.data,
        onEditNode: () => openNodeEditor(node.id),
      };

      if (node.id === "storyRoot") {
        return {
          ...node,
          data: {
            ...dataWithEdit,
            storyRootStats,
            onViewStoryRoot: () => setActiveStoryRoot(node.data),
          },
        };
      }

      if (node.data.kind === "role") {
        return {
          ...node,
          data: {
            ...dataWithEdit,
            onViewCharacter: () => setActiveCharacter(node.data),
          },
        };
      }

      if (node.data.kind === "plot" && node.data.plotId) {
        return {
          ...node,
          data: {
            ...dataWithEdit,
            onViewPlot: () => setActivePlotId(node.data.plotId ?? null),
          },
        };
      }

      return { ...node, data: dataWithEdit };
    });
  }, [nodes, openNodeEditor]);

  const onConnect = useCallback(
    (connection: Connection) => {
      const targetNode = nodes.find((node) => node.id === connection.target);

      if (
        !isConnectionTargetKindAllowed(
          connection.sourceHandle,
          targetNode?.data.kind,
          connection.source
        )
      ) {
        return;
      }

      const targetHandle =
        connection.targetHandle ??
        targetHandleForPort(connection.sourceHandle, targetNode?.data.kind);

      setEdges((current) =>
        addEdge(
          {
            ...connection,
            id: `${connection.source}-${connection.sourceHandle ?? "default"}-${connection.target}-${
              targetHandle ?? connection.targetHandle ?? "default"
            }-${Date.now()}`,
            targetHandle,
            ...edgeOptionsForPort(connection.sourceHandle),
          },
          current
        )
      );
    },
    [nodes, setEdges]
  );

  const onConnectStart = useCallback<OnConnectStart>((_event, params) => {
    connectStartRef.current = params;
  }, []);

  const onConnectEnd = useCallback<OnConnectEnd>(
    (event, connectionState) => {
      const start = connectStartRef.current;
      connectStartRef.current = null;

      if (
        !start?.nodeId ||
        start.handleType !== "source" ||
        !start.handleId ||
        !(start.handleId in CONNECTION_PORTS) ||
        connectionState.toNode
      ) {
        return;
      }

      const sourceNode = nodes.find((node) => node.id === start.nodeId);

      if (!sourceNode) {
        return;
      }

      const portId = start.handleId as ConnectionPortId;
      const pointer = getClientPoint(event);
      const position = reactFlow.screenToFlowPosition(pointer);
      const nextDraftIndex = portDraftCounterRef.current[portId] + 1;
      portDraftCounterRef.current[portId] = nextDraftIndex;
      const draftNode = nextDraftNodeForPort({
        portId,
        index: nextDraftIndex,
      });
      const nextNodeId = `${draftNode.data.kind}-${portId}-${Date.now()}`;

      setNodes((current) => [
        ...current,
        {
          id: nextNodeId,
          type: "narrative",
          position: { x: position.x - draftNode.offset.x, y: position.y - draftNode.offset.y },
          data: draftNode.data,
        },
      ]);

      setEdges((current) =>
        addEdge(
          {
            ...edgeOptionsForPort(portId),
            ...edgeLabelOptions(draftNode.label, portId),
            id: `${sourceNode.id}-${nextNodeId}`,
            source: sourceNode.id,
            sourceHandle: portId,
            target: nextNodeId,
            targetHandle: draftNode.targetHandle,
          },
          current
        )
      );
    },
    [nodes, reactFlow, setEdges, setNodes]
  );

  const onSelectionChange = useCallback<OnSelectionChangeFunc<NarrativeNode, NarrativeEdge>>(
    ({ nodes: selectedNodes }) => {
      setSelectedNodeCount(selectedNodes.length);
    },
    []
  );

  const addNode = useCallback(
    (kind: NarrativeNodeKind) => {
      const nextIndex = nodes.length + 1;
      const x = 260 + (nextIndex % 4) * 380;
      const y = 500 + Math.floor(nextIndex / 4) * 260;
      setNodes((current) => [
        ...current,
        {
          id: `${kind}-${Date.now()}`,
          type: "narrative",
          position: { x, y },
          data: nodeDefaults(kind, nextIndex),
        },
      ]);
    },
    [nodes.length, setNodes]
  );

  const createStoryRootFromEmptyState = useCallback(async () => {
    const prompt = emptyCanvasPrompt.trim();

    if (!prompt && !emptyCanvasUploadContent) {
      setEmptyCanvasAnalyzeState("error");
      setEmptyCanvasAnalyzeError("Please describe the story or upload a text document first.");
      emptyCanvasInputRef.current?.focus();
      return;
    }

    setEmptyCanvasAnalyzeState("loading");
    setEmptyCanvasAnalyzeError(null);

    try {
      const locale =
        typeof window === "undefined"
          ? "en-US"
          : (window.location.pathname.split("/").filter(Boolean)[0] ?? "en-US");
      const response = await fetch("/api/story-studio/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          prompt,
          uploadedFileName: emptyCanvasUploadName,
          uploadedContent: emptyCanvasUploadContent,
          locale,
        }),
      });
      const result = (await response.json().catch(() => null)) as StoryStudioAnalyzeResponse | null;

      if (!response.ok || !result?.success) {
        throw new Error(
          result && "message" in result
            ? result.message
            : `Analyze failed with HTTP ${response.status}.`
        );
      }

      const generated = buildNodesAndEdgesFromAnalysis(result.analysis);
      snapshotBaseRef.current = {
        ...snapshotBaseRef.current,
        title: result.analysis.title,
        summary: result.analysis.summary,
        storyAnalysis: result.analysis as unknown as Record<string, unknown>,
      };
      setCanvasTitle(result.analysis.title);
      setNodes(generated.nodes);
      setEdges(generated.edges);
      setEmptyCanvasAnalyzeState("idle");
      setEmptyCanvasAnalyzeError(null);
      window.setTimeout(() => {
        reactFlow.setViewport({ x: 80, y: 390, zoom: 0.44 }, { duration: 420 });
      }, 0);
    } catch (error) {
      setEmptyCanvasAnalyzeState("error");
      setEmptyCanvasAnalyzeError(error instanceof Error ? error.message : "Analyze failed.");
    }
  }, [
    emptyCanvasPrompt,
    emptyCanvasUploadContent,
    emptyCanvasUploadName,
    projectId,
    reactFlow,
    setEdges,
    setNodes,
  ]);

  const addAssetNode = useCallback(
    (asset: AssetItem) => {
      setNodes((current) => {
        const nextIndex = current.length + 1;
        const x = 420 + (nextIndex % 5) * 340;
        const y = 760 + Math.floor(nextIndex / 5) * 260;

        return [
          ...current,
          {
            id: `${asset.node.kind}-${Date.now()}`,
            type: "narrative",
            position: { x, y },
            data: asset.node,
          },
        ];
      });
    },
    [setNodes]
  );

  const toggleAssetDrawer = useCallback((kind: AssetKind) => {
    setActiveAssetKind((current) => (current === kind ? null : kind));
  }, []);

  return (
    <main className="relative h-screen overflow-hidden bg-[oklch(0.105_0_0)] text-white">
      <div
        className="absolute inset-y-0 right-0 transition-[left] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{ left: leftDockWidth }}
      >
        <ReactFlow
          nodes={nodesWithActions}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectStart={onConnectStart}
          onConnectEnd={onConnectEnd}
          onSelectionChange={onSelectionChange}
          onNodeDoubleClick={(_event, node) => openNodeEditor(node.id)}
          nodeTypes={NODE_TYPES}
          defaultEdgeOptions={CURVED_EDGE_OPTIONS}
          connectionLineStyle={CURVED_EDGE_OPTIONS.style}
          colorMode="dark"
          proOptions={{ hideAttribution: true }}
          minZoom={0.18}
          maxZoom={1.8}
          defaultViewport={{ x: 80, y: 390, zoom: 0.44 }}
          snapToGrid
          snapGrid={[20, 20]}
          panOnScroll
          panOnDrag={!isSelectionMode}
          selectionOnDrag={isSelectionMode}
          elementsSelectable
          nodesDraggable
          selectNodesOnDrag={false}
          zoomOnDoubleClick={false}
          className="[&_.react-flow__selection]:!border-white/36 [&_.react-flow__selection]:!bg-white/8 [&_.react-flow__nodesselection-rect]:!stroke-white/40"
          style={{ backgroundColor: "oklch(0.105 0 0)" }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={18}
            size={1.2}
            color="rgb(255 255 255 / 0.12)"
            bgColor="oklch(0.105 0 0)"
          />
          <MiniMap
            pannable
            zoomable
            position="bottom-left"
            className="!bottom-6 !left-[82px] !m-0 overflow-hidden rounded-[22px] !bg-[oklch(0.18_0_0)] shadow-[0_18px_60px_rgba(0,0,0,0.4)]"
            bgColor="oklch(0.18 0 0)"
            maskColor="rgba(0,0,0,0.42)"
            maskStrokeColor="rgba(255,255,255,0.32)"
            nodeColor="rgba(255,255,255,0.46)"
            nodeStrokeWidth={0}
          />
          <Controls
            position="bottom-left"
            className="!bottom-6 !left-6 overflow-hidden rounded-full !bg-[oklch(0.18_0_0)] !p-1 shadow-[0_18px_60px_rgba(0,0,0,0.35)] [&_button]:!size-9 [&_button]:!border-0 [&_button]:!bg-transparent [&_button]:!text-white/70 [&_button:hover]:!bg-white/10 [&_svg]:!fill-white/70"
            showInteractive={false}
          />
        </ReactFlow>
      </div>

      {isCanvasLoading ? (
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/10 px-5 py-3 text-sm font-semibold text-white/62 shadow-[0_18px_60px_rgba(0,0,0,0.32)] backdrop-blur-xl"
          role="status"
        >
          正在读取项目画布...
        </div>
      ) : null}

      {!isCanvasLoading && canvasLoadError ? (
        <div className="absolute left-1/2 top-1/2 z-20 w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-[28px] bg-[oklch(0.18_0_0)/0.92] p-6 text-center shadow-[0_24px_90px_rgba(0,0,0,0.5)] backdrop-blur-2xl">
          <p className="text-sm font-semibold text-[#ff8b8e]">项目画布读取失败</p>
          <p className="mt-3 text-sm leading-6 text-white/52">{canvasLoadError}</p>
        </div>
      ) : null}

      {!isCanvasLoading && hasHydratedCanvas && !canvasLoadError && nodes.length === 0 ? (
        <section
          className="pointer-events-none absolute bottom-0 top-[104px] z-10 flex items-start justify-center overflow-hidden px-8 pt-[72px] transition-[left] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
          style={{ left: leftDockWidth, right: 0 }}
          aria-label="StoryOS empty canvas intake"
        >
          <div className="pointer-events-auto w-full max-w-[1160px] text-center">
            <p className="text-[20px] font-semibold tracking-tight text-white/44">
              Double-click the canvas or describe what to generate.
            </p>

            <div className="mx-auto mt-7 flex h-[64px] max-w-[920px] items-center gap-2 rounded-full bg-white/[0.105] p-2 shadow-[0_24px_90px_rgba(0,0,0,0.34)] backdrop-blur-2xl">
              <input
                ref={emptyCanvasInputRef}
                value={emptyCanvasPrompt}
                onChange={(event) => setEmptyCanvasPrompt(event.target.value)}
                placeholder="Describe the story you want StoryOS to generate..."
                disabled={emptyCanvasAnalyzeState === "loading"}
                className="h-full min-w-0 flex-1 bg-transparent px-6 text-[17px] font-semibold text-white/86 outline-none placeholder:text-white/32"
              />
              <input
                ref={emptyCanvasUploadRef}
                type="file"
                accept=".txt,.md,.json,text/plain,text/markdown,application/json"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  setEmptyCanvasAnalyzeError(null);
                  setEmptyCanvasUploadName(file?.name ?? null);
                  setEmptyCanvasUploadContent(null);

                  if (!file) return;

                  const reader = new FileReader();
                  reader.onload = () => {
                    setEmptyCanvasUploadContent(
                      typeof reader.result === "string" ? reader.result.slice(0, 80000) : ""
                    );
                  };
                  reader.onerror = () => {
                    setEmptyCanvasAnalyzeState("error");
                    setEmptyCanvasAnalyzeError("Could not read the selected text document.");
                  };
                  reader.readAsText(file);
                }}
              />
              <button
                type="button"
                disabled={emptyCanvasAnalyzeState === "loading"}
                onClick={() => emptyCanvasUploadRef.current?.click()}
                className="inline-flex h-12 shrink-0 items-center justify-center rounded-full bg-white/10 px-6 text-[15px] font-semibold text-white/72 transition hover:bg-white/15 hover:text-white active:translate-y-0.5 disabled:pointer-events-none disabled:opacity-45"
              >
                {emptyCanvasUploadName ? "Uploaded" : "Upload"}
              </button>
              <button
                type="button"
                disabled={emptyCanvasAnalyzeState === "loading"}
                onClick={createStoryRootFromEmptyState}
                className="inline-flex h-12 shrink-0 items-center justify-center rounded-full bg-white px-7 text-[15px] font-black text-black shadow-[0_7px_0_0_rgba(255,255,255,0.18)] transition-[transform,box-shadow,background] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-white/90 active:translate-y-1 active:shadow-[0_2px_0_0_rgba(255,255,255,0.18)] disabled:pointer-events-none disabled:translate-y-1 disabled:opacity-70 disabled:shadow-[0_2px_0_0_rgba(255,255,255,0.18)]"
              >
                {emptyCanvasAnalyzeState === "loading" ? "Analyzing..." : "Analyze"}
              </button>
            </div>

            {emptyCanvasUploadName ? (
              <p className="mt-3 text-xs font-semibold text-white/36">
                Selected text document: {emptyCanvasUploadName}
              </p>
            ) : null}

            {emptyCanvasAnalyzeState === "error" && emptyCanvasAnalyzeError ? (
              <p className="mx-auto mt-3 max-w-[760px] text-sm font-semibold leading-6 text-[#ff8b8e]">
                {emptyCanvasAnalyzeError}
              </p>
            ) : null}

            <div className="mt-7 grid grid-cols-4 gap-4">
              {EMPTY_CANVAS_STARTERS.map((starter) => (
                <button
                  key={starter.kind}
                  type="button"
                  onClick={() => {
                    setEmptyCanvasPrompt((current) => current || starter.prompt);
                    setEmptyCanvasAnalyzeError(null);
                    window.setTimeout(() => emptyCanvasInputRef.current?.focus(), 0);
                  }}
                  className="group relative h-[96px] overflow-hidden rounded-[22px] bg-cover bg-center p-5 text-left shadow-[0_22px_72px_rgba(0,0,0,0.26)] transition duration-200 hover:-translate-y-1 hover:shadow-[0_30px_90px_rgba(0,0,0,0.42)]"
                  style={{
                    backgroundImage: `linear-gradient(90deg, rgba(18,18,18,0.86), rgba(18,18,18,0.48)), url(${starter.image})`,
                  }}
                >
                  <span className="absolute inset-0 bg-black/18 opacity-0 transition group-hover:opacity-100" />
                  <span className="relative block text-[20px] font-black leading-tight text-white/94">
                    {starter.title}
                  </span>
                  <span className="relative mt-2 block text-sm font-semibold leading-5 text-white/56 transition group-hover:text-white/68">
                    {starter.description}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <header
        className="pointer-events-none absolute right-6 top-6 z-20 flex items-start justify-between gap-4 transition-[left] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{ left: leftDockWidth + 24 }}
      >
        <div className="pointer-events-auto flex h-14 items-center gap-4 rounded-full bg-[oklch(0.18_0_0)/0.86] px-5 shadow-[0_18px_60px_rgba(0,0,0,0.36)] backdrop-blur-xl">
          <span className="text-[18px] font-black tracking-tight text-white">Fizz</span>
          <div className="h-5 w-px bg-white/10" />
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/38">
              叙事工作台
            </p>
            <h1 className="max-w-[260px] truncate text-[15px] font-semibold text-white/88">
              {canvasTitle}
            </h1>
          </div>
          <IconChevronDown className="size-4 text-white/45" />
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          {projectId ? (
            <span
              title={canvasLoadError ?? canvasSaveError ?? undefined}
              className={cn(
                "inline-flex h-11 items-center rounded-full px-4 text-xs font-semibold shadow-[0_14px_44px_rgba(0,0,0,0.24)] backdrop-blur-xl",
                canvasSaveState === "error" || canvasLoadError
                  ? "bg-[#E52227]/18 text-[#ff8b8e]"
                  : "bg-white/8 text-white/50"
              )}
            >
              {isCanvasLoading
                ? "读取项目中"
                : canvasLoadError
                  ? "读取失败"
                  : canvasSaveState === "saving"
                    ? "保存中"
                    : canvasSaveState === "saved"
                      ? "已保存"
                      : "真实项目"}
            </span>
          ) : null}
          <button
            type="button"
            data-testid="toggle-selection-mode"
            aria-pressed={isSelectionMode}
            onClick={() => setIsSelectionMode((current) => !current)}
            className={cn(
              "inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold shadow-[0_14px_44px_rgba(0,0,0,0.3)] transition",
              isSelectionMode
                ? "bg-white text-black hover:bg-white/88"
                : "bg-white/10 text-white/78 hover:bg-white/15 hover:text-white"
            )}
          >
            <IconBoxMultiple className="size-4" />
            {selectedNodeCount > 0 ? `已选 ${selectedNodeCount}` : "框选"}
          </button>
          <button
            type="button"
            className="inline-flex h-11 items-center gap-2 rounded-full bg-white/10 px-4 text-sm font-semibold text-white/78 shadow-[0_14px_44px_rgba(0,0,0,0.3)] transition hover:bg-white/15 hover:text-white"
          >
            <IconArrowUpRight className="size-4" />
            分享
          </button>
          <button
            type="button"
            className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-black shadow-[0_14px_44px_rgba(0,0,0,0.35)] transition hover:bg-white/88"
          >
            <IconRocket className="size-4" />
            发布
          </button>
        </div>
      </header>

      {activeEditNode ? (
        <NodeEditorPanel
          key={activeEditNode.id}
          node={activeEditNode}
          onClose={() => setActiveEditNodeId(null)}
          onChange={(patch) => updateNodeData(activeEditNode.id, patch)}
          onDelete={() => deleteNode(activeEditNode.id)}
        />
      ) : null}

      {!activeEditNode && isAssistantOpen ? (
        <aside
          data-testid="storyos-assistant-panel"
          className="absolute bottom-6 right-6 top-[104px] z-20 flex w-[430px] flex-col overflow-hidden rounded-[32px] bg-[oklch(0.18_0_0)/0.9] shadow-[0_28px_100px_rgba(0,0,0,0.48)] backdrop-blur-2xl duration-300 animate-in fade-in-0 slide-in-from-right-5"
        >
          <div className="flex items-center justify-between bg-white/[0.04] px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-full bg-white/12">
                <IconSparkles className="size-5 text-white/82" />
              </span>
              <div>
                <p className="text-sm font-semibold text-white/90">StoryOS 助手</p>
                <p className="text-xs text-white/42">规划剧本、证据链和可玩回合</p>
              </div>
            </div>
            <button
              type="button"
              data-testid="collapse-storyos-assistant"
              onClick={() => setIsAssistantOpen(false)}
              className="grid size-9 place-items-center rounded-full bg-white/8 text-white/58 transition hover:bg-white/12 hover:text-white"
              aria-label="收起 StoryOS 助手"
            >
              <IconX className="size-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="max-w-[310px] rounded-[26px] bg-white/[0.055] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/38">
                画布诊断
              </p>
              <h2 className="mt-2 text-xl font-semibold text-white">故事核心已经建立。</h2>
              <p className="mt-3 text-sm leading-6 text-white/56">
                剧本节点已经锁定现代中国、精英学校、17
                岁少女和首宗溺亡案。下一步建议拆出证据链、嫌疑关系和哥哥干预规则。
              </p>
            </div>

            <div className="mt-6 space-y-3">
              {AGENT_ACTIONS.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={() => addNode(action.kind)}
                  className="flex w-full items-center justify-between rounded-[20px] bg-white/[0.06] px-4 py-3 text-left text-sm font-semibold text-white/72 transition hover:bg-white/[0.095] hover:text-white"
                >
                  {action.label}
                  <IconPlus className="size-4 text-white/38" />
                </button>
              ))}
            </div>
          </div>

          <div className="p-5">
            <div className="rounded-[28px] bg-[oklch(0.235_0_0)] p-3 shadow-[0_16px_48px_rgba(0,0,0,0.28)]">
              <div className="min-h-20 rounded-[20px] bg-black/18 px-4 py-3 text-sm leading-6 text-white/52">
                让 Agent 扩写剧本、生成角色，或编译一次推理试玩……
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-full bg-white/8 px-3 py-2 text-xs font-semibold text-white/56"
                >
                  <IconLayoutGridAdd className="size-4" />
                  技能
                </button>
                <button
                  type="button"
                  className="grid size-11 place-items-center rounded-full bg-white text-black shadow-[0_6px_0_0_rgba(255,255,255,0.18)] transition-[transform,box-shadow] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-px hover:shadow-[0_7px_0_0_rgba(255,255,255,0.18)] active:translate-y-1 active:shadow-[0_2px_0_0_rgba(255,255,255,0.18)]"
                >
                  <IconSend className="size-5" />
                </button>
              </div>
            </div>
          </div>
        </aside>
      ) : !activeEditNode ? (
        <button
          type="button"
          data-testid="expand-storyos-assistant"
          onClick={() => setIsAssistantOpen(true)}
          className="absolute right-6 top-[104px] z-20 inline-flex h-14 items-center gap-3 rounded-full bg-[oklch(0.18_0_0)/0.88] px-4 text-white shadow-[0_18px_60px_rgba(0,0,0,0.42)] backdrop-blur-2xl transition hover:bg-[oklch(0.22_0_0)/0.92]"
          aria-label="打开 StoryOS 助手"
        >
          <span className="grid size-9 place-items-center rounded-full bg-white/12">
            <IconSparkles className="size-5 text-white/82" />
          </span>
          <span className="text-sm font-semibold text-white/86">StoryOS</span>
          <IconMessageCircle className="size-4 text-white/48" />
        </button>
      ) : null}

      <div
        className="absolute inset-y-0 left-0 z-30 flex overflow-hidden bg-[oklch(0.13_0_0)] shadow-[18px_0_80px_rgba(0,0,0,0.32)] transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{ width: leftDockWidth }}
      >
        <aside className="flex h-full w-[82px] shrink-0 flex-col items-center justify-between bg-[oklch(0.13_0_0)] px-3 py-6">
          <div className="flex flex-col gap-2">
            {ASSET_KIND_ORDER.map((kind) => {
              const meta = ASSET_KIND_META[kind];
              const AssetIcon = meta.icon;
              const isActive = activeAssetKind === kind;

              return (
                <button
                  key={kind}
                  type="button"
                  data-testid={`asset-entry-${kind}`}
                  onClick={() => toggleAssetDrawer(kind)}
                  className={cn(
                    "grid size-12 place-items-center rounded-full transition",
                    isActive
                      ? "bg-white text-black"
                      : "text-white/48 hover:bg-white/10 hover:text-white"
                  )}
                  aria-label={`打开${meta.label}资产`}
                  title={meta.label}
                >
                  <AssetIcon className="size-5" />
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => addNode("storyRoot")}
            className="grid size-12 place-items-center rounded-full bg-[#E52227] text-white shadow-[0_10px_30px_rgba(229,34,39,0.28)] transition hover:bg-[#ff3d42]"
            aria-label="新增节点"
            title="新增节点"
          >
            <IconPlus className="size-6" />
          </button>
        </aside>

        {activeAssetKind ? (
          <AssetDrawer
            activeKind={activeAssetKind}
            onSelectKind={setActiveAssetKind}
            onClose={() => setActiveAssetKind(null)}
            onAddAsset={addAssetNode}
          />
        ) : null}
      </div>

      <section
        className={cn(
          "absolute bottom-[104px] z-20 hidden w-[280px] rounded-[28px] bg-[oklch(0.18_0_0)/0.82] p-4 shadow-[0_20px_70px_rgba(0,0,0,0.42)] backdrop-blur-xl transition-[right] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] xl:block",
          isAssistantOpen ? "right-[480px]" : "right-6"
        )}
      >
        <div className="flex items-center gap-2">
          <IconPlayerPlay className="size-4 text-white/62" />
          <p className="text-sm font-semibold text-white/82">试玩编译</p>
        </div>
        <div className="mt-4 space-y-2">
          {["玩家可自由输入行动", "证据链不能跳步", "真凶暂不可提前揭露"].map((item) => (
            <div key={item} className="flex items-center gap-2 text-xs text-white/48">
              <span className="size-1.5 rounded-full bg-white/42" />
              {item}
            </div>
          ))}
        </div>
        <button
          type="button"
          className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-full bg-white text-sm font-semibold text-black"
        >
          <IconBook2 className="size-4" />
          运行当前路线
        </button>
      </section>

      {activePlotId ? (
        <PlotViewer
          key={activePlotId}
          plot={PLOT_NODE_DETAILS[activePlotId]}
          onClose={() => setActivePlotId(null)}
        />
      ) : null}
      {activeStoryRoot ? (
        <StoryRootViewer storyRoot={activeStoryRoot} onClose={() => setActiveStoryRoot(null)} />
      ) : null}
      {activeCharacter ? (
        <CharacterViewer character={activeCharacter} onClose={() => setActiveCharacter(null)} />
      ) : null}
    </main>
  );
}

type StoryStudioCanvasProps = {
  projectId?: string | null;
};

export function StoryStudioCanvas({ projectId = null }: StoryStudioCanvasProps) {
  return (
    <ReactFlowProvider>
      <NarrativeStudioInner projectId={projectId} />
    </ReactFlowProvider>
  );
}
