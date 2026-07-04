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
  useUpdateNodeInternals,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type OnConnectEnd,
  type OnConnectStart,
  type OnSelectionChangeFunc,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toast } from "sonner";
import {
  IconArrowUpRight,
  IconBoxMultiple,
  IconCards,
  IconChevronDown,
  IconEdit,
  IconEye,
  IconFileText,
  IconFingerprint,
  IconGitBranch,
  IconPackage,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconRocket,
  IconVideo,
  IconUsersGroup,
  IconUserCircle,
  IconX,
  type Icon,
} from "@tabler/icons-react";
import { useRouter } from "@/i18n/navigation";
import {
  createStoryProject,
  draftPipelineState,
  draftRevisionConflict,
  getStoryProject,
  pollStoryAnalysis,
  putStoryDraft,
  startStoryAnalysis,
  type DraftRevisionConflict,
  type StoryDraft,
  type StoryStudioAnalysis,
} from "@/lib/story-projects-api";
import { fetchRandomIpSeeds, type IpStarterSeed } from "@/lib/ip-seeds-api";
import { cn } from "@/lib/utils";
import { AiEdgeGlow, AiSketchGhost } from "./ai-edge-glow";

type NarrativeNodeKind = "storyRoot" | "plot" | "ending" | "role" | "clue" | "item" | "video";

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
  image?: "avatar" | "item" | "video";
  storyRootMode?: "document";
  storyRootSections?: StoryRootDocumentSection[];
  storyRootOverviewCards?: StoryRootOverviewCard[];
  storyRootStats?: StoryRootStats;
  /** Stage letter (A/B/C…) of a GENERATED plot node — presentational order. */
  plotStage?: string;
  /** The analysis `entryGoal` of a GENERATED plot node (real data). */
  plotGoal?: string;
  characterMode?: "protagonist" | "relation";
  characterPortrait?: CharacterPortraitKey;
  endingType?: "truth" | "intervention" | "failure" | "hidden";
  endingTrigger?: string;
  endingReview?: string;
  clueType?: string;
  clueSource?: string;
  clueUse?: string;
  clueRule?: string;
  onViewStoryRoot?: () => void;
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

/** Draft snapshot format written by THIS client (v2 carries storySpec).
 *  The server refuses schema downgrades, so newer drafts survive old
 *  clients. */
const STORY_CANVAS_SCHEMA_VERSION = "story-studio-canvas-v2";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPersistedNarrativeNode(value: unknown): value is NarrativeNode {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string") return false;
  if (!isRecord(value.position)) return false;
  if (typeof value.position.x !== "number" || typeof value.position.y !== "number") {
    return false;
  }
  if (!isRecord(value.data)) return false;
  // Unknown kinds are PRESERVED (forward compat): a draft written by a newer
  // client must survive a round-trip through this one, not lose nodes.
  if (typeof value.data.kind !== "string" || !value.data.kind) return false;
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
    ? canvas.nodes.filter(isPersistedNarrativeNode).map((node) => ({
        ...node,
        type: "narrative" as const,
        data: { ...node.data },
        selected: false,
        dragging: false,
      }))
    : [];
  const normalizedNodes = nodes;
  const nodeKindById = new Map(normalizedNodes.map((node) => [node.id, node.data.kind]));
  const edges = Array.isArray(canvas.edges)
    ? canvas.edges
        .filter(isPersistedNarrativeEdge)
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
  edges: NarrativeEdge[],
  storySpec?: Record<string, unknown> | null
): Record<string, unknown> {
  return {
    ...base,
    // This client always writes the CURRENT format — the server refuses the
    // reverse direction (schema downgrade guard).
    schemaVersion: STORY_CANVAS_SCHEMA_VERSION,
    ...(storySpec ? { storySpec } : {}),
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

type CharacterPortraitKey = "female" | "male" | "neutral";

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
} as const;

type ConnectionPortId = keyof typeof CONNECTION_PORTS;

const ROLE_CARD_WIDTH = 320;
const ROLE_CARD_HEIGHT = 168;
const ROLE_PORTRAIT_WIDTH = 82;
const ROLE_PORTRAIT_HEIGHT = Math.round((ROLE_PORTRAIT_WIDTH * 16) / 9);

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

const CHARACTER_PORTRAITS: Record<CharacterPortraitKey, { src: string; alt: string }> = {
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
  clue: {
    icon: IconFingerprint,
    accent: "text-white",
    glow: "bg-white/14",
  },
  item: {
    icon: IconCards,
    accent: "text-[#e0c27a]",
    glow: "bg-[#e0c27a]/18",
  },
  video: {
    icon: IconVideo,
    accent: "text-white",
    glow: "bg-white/14",
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

  // ── Fan geometry ──────────────────────────────────────────────────────
  // The 16:9 root (720×405 at x=0/y=0) sits on the LEFT; four lanes fan
  // RIGHT off its edge ports, top→bottom: 角色 · 剧情节点 · 结局 · 线索.
  // The plot lane is the ordered A→B chain; the other lanes fan per card.
  const LANE_X = 1040;
  const LANE_Y = { roles: -520, plots: -40, endings: 430, clues: 950 } as const;
  const LANE_STEP = { roles: 380, plots: 420, endings: 420, clues: 380 } as const;

  const storyRootNode: NarrativeNode = {
    id: rootId,
    type: "narrative",
    position: { x: 0, y: 0 },
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
      portrait: "neutral" as CharacterPortraitKey,
    },
    ...analysis.characters.map((character) => ({
      name: character.name,
      role: character.role,
      summary: character.summary,
      tags: character.tags,
      mode: "relation" as const,
      // The analysis carries no imagery — every generated character gets
      // the neutral placeholder until a real portrait is generated.
      portrait: "neutral" as CharacterPortraitKey,
    })),
  ].slice(0, 5);

  const roleNodes: NarrativeNode[] = characterSeeds.map((character, index) => ({
    id: `role-${now}-${index}`,
    type: "narrative",
    position: { x: LANE_X + index * LANE_STEP.roles, y: LANE_Y.roles },
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

  // Plots arrive from the server already in narrative order — the canvas
  // renders them as a plain A/B/C chain, nothing more.
  const beatsInOrder = analysis.plots.slice(0, 16);

  const plotNodes: NarrativeNode[] = beatsInOrder.map((plot, index) => ({
    id: `plot-${now}-${index}`,
    type: "narrative",
    position: { x: LANE_X + index * LANE_STEP.plots, y: LANE_Y.plots },
    data: {
      ...nodeDefaults("plot", index + 1),
      eyebrow: "剧情节点",
      label: compactText(plot.title, `Plot Beat ${index + 1}`),
      summary: compactText(
        plot.summary || plot.entryGoal,
        "Playable plot node pending refinement."
      ),
      status: "ready",
      chips: compactChips(plot.tags, ["自由行动", "行动点", "进入条件"]),
      plotStage: String.fromCharCode(65 + index),
      plotGoal: compactText(plot.entryGoal, ""),
    },
  }));

  const clueNodes: NarrativeNode[] = analysis.clues.slice(0, 6).map((clue, index) => ({
    id: `clue-${now}-${index}`,
    type: "narrative",
    position: { x: LANE_X + index * LANE_STEP.clues, y: LANE_Y.clues },
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
    position: { x: LANE_X + index * LANE_STEP.endings, y: LANE_Y.endings },
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

  // Draw order = staged-reveal order, lanes top→bottom:
  // root → 角色 → 剧情 → 结局 → 线索.
  const nodes = [storyRootNode, ...roleNodes, ...plotNodes, ...endingNodes, ...clueNodes];
  const edges: NarrativeEdge[] = [];

  // Every group fans RIGHT off its own root port; every card anchors on its
  // LEFT edge. The plot lane additionally chains left→right in play order.
  // No fabricated plot→ending mapping (the analysis has none).
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

  plotNodes.forEach((node, index) => {
    const previous = index === 0 ? null : plotNodes[index - 1];
    edges.push({
      ...CURVED_EDGE_OPTIONS,
      ...edgeLabelOptions(index === 0 ? "剧情入口" : `进入 ${String.fromCharCode(65 + index)}`),
      id: `${previous?.id ?? rootId}-${node.id}`,
      source: previous?.id ?? rootId,
      sourceHandle: previous ? undefined : "plots",
      target: node.id,
    });
  });

  endingNodes.forEach((node, index) => {
    edges.push({
      ...CURVED_EDGE_OPTIONS,
      ...edgeLabelOptions(index === 0 ? "结局" : "结局"),
      id: `${rootId}-${node.id}`,
      source: rootId,
      sourceHandle: "endings",
      target: node.id,
      targetHandle: "ending-in",
    });
  });

  clueNodes.forEach((node, index) => {
    edges.push({
      ...edgeOptionsForPort("clues"),
      ...edgeLabelOptions(index === 0 ? "全局线索" : "线索", "clues"),
      id: `${rootId}-${node.id}`,
      source: rootId,
      sourceHandle: "clues",
      target: node.id,
      targetHandle: "clue-in",
    });
  });

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
  const storyRootSections = data.storyRootSections ?? [];
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
    <div className="relative w-[720px] pt-10">
      <div className="absolute left-0 top-0 z-10 inline-flex h-8 items-center gap-2 rounded-full bg-[#7b4be8]/42 px-3 text-[13px] font-semibold text-white shadow-[0_10px_30px_rgba(0,0,0,0.3)] backdrop-blur-xl">
        <span className="grid size-6 place-items-center rounded-full bg-[#8f65ff]/70">
          <IconFileText className="size-3.5" stroke={2} />
        </span>
        故事总纲
      </div>

      <article
        className={cn(
          // 16:9 canvas hero — the tree of global groups fans out below it.
          "group relative h-[405px] overflow-visible rounded-[28px] bg-[linear-gradient(180deg,oklch(0.21_0_0),oklch(0.17_0_0))] p-7 shadow-[0_28px_100px_rgba(0,0,0,0.48)] transition duration-200",
          selected && "bg-[linear-gradient(180deg,oklch(0.24_0_0),oklch(0.18_0_0))]"
        )}
      >
        {/* Fan ports, top→bottom on the RIGHT edge: 角色 · 剧情 · 结局 · 线索 —
            each group hangs off its own anchor. */}
        <Handle
          id="roles"
          type="source"
          position={Position.Right}
          className="!-right-1.5 !z-30 !size-3 !border-0"
          style={{
            top: "18%",
            backgroundColor: CONNECTION_PORTS.roles.color,
            boxShadow: `0 0 18px ${CONNECTION_PORTS.roles.glow}`,
          }}
        />
        <Handle
          id="plots"
          type="source"
          position={Position.Right}
          className="!-right-1.5 !z-30 !size-3 !border-0 !bg-white/70"
          style={{ top: "40%" }}
        />
        <Handle
          id="endings"
          type="source"
          position={Position.Right}
          className="!-right-1.5 !z-30 !size-3 !border-0 !bg-white/45"
          style={{ top: "62%" }}
        />
        <Handle
          id="clues"
          type="source"
          position={Position.Right}
          className="!-right-1.5 !z-30 !size-3 !border-0"
          style={{
            top: "84%",
            backgroundColor: CONNECTION_PORTS.clues.color,
            boxShadow: `0 0 18px ${CONNECTION_PORTS.clues.glow}`,
          }}
        />

        <div className="flex h-full min-h-0 gap-6">
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/32">
              故事总纲
            </p>
            <h2 className="mt-2 line-clamp-1 text-[22px] font-semibold leading-tight tracking-tight text-white/92">
              {data.label}
            </h2>
            <p className="mt-3 line-clamp-3 text-[13px] font-medium leading-6 text-white/54">
              {data.summary}
            </p>
            <div className="mt-auto rounded-[20px] bg-black/18 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/28">
                故事核
              </p>
              <p className="mt-2 line-clamp-2 text-[12px] font-medium leading-5 text-white/54">
                {storyKernel}
              </p>
              <p className="mt-2 line-clamp-1 text-[11px] font-medium leading-4 text-white/38">
                {worldview}
              </p>
            </div>
          </div>

          <div className="flex w-[236px] shrink-0 flex-col gap-2">
            <div className="grid grid-cols-2 gap-2">
              <StoryRootStatTile label="角色" value={stats.roleCount} />
              <StoryRootStatTile label="剧情" value={stats.plotCount} />
              <StoryRootStatTile label="线索" value={stats.clueCount} />
              <StoryRootStatTile label="结局" value={stats.endingCount} />
            </div>
            <div className="min-h-0 flex-1 rounded-[18px] bg-white/[0.045] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/28">
                地点 · {direction}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5 overflow-hidden">
                {(locations.length > 0 ? locations : ["待生成"]).slice(0, 3).map((location) => (
                  <span
                    key={location}
                    className="max-w-full truncate rounded-full bg-white/[0.07] px-2 py-1 text-[10px] font-medium text-white/44"
                  >
                    {location}
                  </span>
                ))}
              </div>
            </div>
            <button
              type="button"
              data-testid="open-story-root-viewer"
              onClick={(event) => {
                event.stopPropagation();
                data.onViewStoryRoot?.();
              }}
              className="nodrag nopan inline-flex h-10 items-center justify-center gap-2 self-end rounded-full bg-[#E52227] px-5 text-[13px] font-medium text-white shadow-[0_12px_34px_rgba(229,34,39,0.28)] transition hover:bg-[#ff3d42] active:translate-y-0.5"
            >
              查看
              <IconFileText className="size-4" stroke={2} />
            </button>
          </div>
        </div>
      </article>
    </div>
  );
}

function PlotNodeCard({ data, selected }: Pick<NodeProps<NarrativeNode>, "data" | "selected">) {
  return (
    <div className="relative w-[330px] pt-10">
      <NodeTypeChip
        label="剧情节点"
        icon={IconGitBranch}
        color="rgba(255,255,255,0.14)"
        iconBg="rgba(255,255,255,0.22)"
      />
      <article
        className={cn(
          "relative w-[330px] overflow-visible rounded-[28px] bg-[oklch(0.19_0_0)] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.38)] transition duration-200",
          selected && "bg-[oklch(0.23_0_0)] shadow-[0_28px_90px_rgba(0,0,0,0.5)]"
        )}
      >
        {/* Anchors sit at a FIXED offset from the card top (aligned with the
          title row) — card heights vary with content, so percentage anchors
          would zigzag the lane. */}
        <Handle
          type="target"
          position={Position.Left}
          className="!-left-1.5 !z-20 !size-3 !border-0 !bg-white/45"
          style={{ top: 44 }}
        />
        <Handle
          type="source"
          position={Position.Right}
          className="!-right-1.5 !z-20 !size-3 !border-0 !bg-white/62"
          style={{ top: 44 }}
        />

        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-12 shrink-0 place-items-center rounded-full bg-white text-[18px] font-black text-black">
              {data.plotStage ?? "?"}
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

        {data.plotGoal ? (
          // Generated plots carry only the REAL analysis fields — no faked
          // action counts or media until they are actually produced.
          <div className="mt-4 rounded-[18px] bg-white/[0.06] px-3.5 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/32">
              Entry goal
            </p>
            <p className="mt-1.5 line-clamp-2 text-[12px] font-medium leading-5 text-white/60">
              {data.plotGoal}
            </p>
          </div>
        ) : null}

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
        </div>
      </article>
    </div>
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
  // Persisted drafts are untyped at runtime — an unknown key (e.g. a portrait
  // that no longer exists) must degrade to the neutral placeholder, not crash.
  const asset = CHARACTER_PORTRAITS[portrait] ?? CHARACTER_PORTRAITS.neutral;

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

function NodeTypeChip({
  label,
  icon: ChipIcon,
  color,
  iconBg,
}: {
  label: string;
  icon: Icon;
  color: string;
  iconBg: string;
}) {
  return (
    <div
      className="absolute top-0 left-0 z-10 inline-flex h-8 items-center gap-2 rounded-full px-3 text-[13px] font-semibold text-white shadow-[0_10px_30px_rgba(0,0,0,0.3)] backdrop-blur-xl"
      style={{ backgroundColor: color }}
    >
      <span
        className="grid size-6 place-items-center rounded-full"
        style={{ backgroundColor: iconBg }}
      >
        <ChipIcon className="size-3.5" stroke={2} />
      </span>
      {label}
    </div>
  );
}

function CharacterCardNode({
  data,
  selected,
}: Pick<NodeProps<NarrativeNode>, "data" | "selected">) {
  const roleLabel = data.characterMode === "protagonist" ? "主角" : "角色";

  return (
    <div className="relative pt-10" style={{ width: ROLE_CARD_WIDTH }}>
      <NodeTypeChip
        label="角色"
        icon={IconUsersGroup}
        color="rgba(167,139,250,0.40)"
        iconBg="rgba(167,139,250,0.65)"
      />
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
            top: 44,
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
    </div>
  );
}

function ClueNodeCard({ data, selected }: Pick<NodeProps<NarrativeNode>, "data" | "selected">) {
  return (
    <div className="relative w-[300px] pt-10">
      <NodeTypeChip
        label="线索"
        icon={IconFingerprint}
        color="rgba(91,157,255,0.38)"
        iconBg="rgba(91,157,255,0.62)"
      />
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
            top: 44,
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
    </div>
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
    <div className="relative w-[330px] pt-10">
      <NodeTypeChip
        label="结局"
        icon={IconRocket}
        color="rgba(229,34,39,0.36)"
        iconBg="rgba(229,34,39,0.60)"
      />
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
          style={{ top: 44 }}
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
    </div>
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

  const meta = KIND_META[data.kind] ?? {
    icon: IconFileText,
    accent: "text-white",
    glow: "bg-white/14",
  };
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
  const sections = storyRoot.storyRootSections ?? [];
  const overviewCards = storyRoot.storyRootOverviewCards ?? [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="故事总纲查看器"
      className="fixed inset-0 z-[90] overflow-hidden bg-[oklch(0.03_0_0)] text-white duration-300 animate-in fade-in-0"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_28%,rgba(242,26,167,0.08),transparent_28%),radial-gradient(circle_at_52%_18%,rgba(255,255,255,0.05),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.025),transparent_24%,rgba(0,0,0,0.5))] duration-500 animate-in fade-in-0 zoom-in-95" />

      <div className="absolute right-8 top-7 z-[110] flex items-center gap-3 duration-300 animate-in fade-in-0 slide-in-from-top-3">
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
  // Always render from the node's REAL data — no hardcoded character sheet.
  const detailSections = [
    {
      heading: isProtagonist ? "角色定位 · 玩家角色" : "角色定位",
      icon: IconFingerprint,
      paragraphs: [character.summary, `当前标签：${(character.chips ?? ["待补充"]).join("、")}。`],
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

      <div className="absolute right-8 top-7 z-[110] flex items-center gap-3 duration-300 animate-in fade-in-0 slide-in-from-top-3">
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
  const updateNodeInternals = useUpdateNodeInternals();
  const [nodes, setNodes, onNodesChange] = useNodesState<NarrativeNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<NarrativeEdge>([]);
  const [activeStoryRoot, setActiveStoryRoot] = useState<NarrativeNodeData | null>(null);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedNodeCount, setSelectedNodeCount] = useState(0);
  const [activeCharacter, setActiveCharacter] = useState<NarrativeNodeData | null>(null);
  const [activeEditNodeId, setActiveEditNodeId] = useState<string | null>(null);
  /** The live story project id — set by hydrate (the prop's project) or by
   *  the lazy create. Null until a project is actually loaded/created. */
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [canvasTitle, setCanvasTitle] = useState("未命名故事");
  const [isCanvasLoading, setIsCanvasLoading] = useState(Boolean(projectId));
  const [hasHydratedCanvas, setHasHydratedCanvas] = useState(false);
  const [canvasLoadError, setCanvasLoadError] = useState<string | null>(null);
  const [canvasSaveState, setCanvasSaveState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  );
  const [canvasSaveError, setCanvasSaveError] = useState<string | null>(null);
  /** Unresolved stale-write conflict (someone else's session updated the
   *  draft) — autosave pauses until the user picks a side. */
  const [draftConflict, setDraftConflict] = useState<DraftRevisionConflict | null>(null);
  const [conflictBusy, setConflictBusy] = useState(false);
  const [emptyCanvasPrompt, setEmptyCanvasPrompt] = useState("");
  const [emptyCanvasUploadName, setEmptyCanvasUploadName] = useState<string | null>(null);
  const [emptyCanvasUploadContent, setEmptyCanvasUploadContent] = useState<string | null>(null);
  const [emptyCanvasAnalyzeState, setEmptyCanvasAnalyzeState] = useState<
    "idle" | "loading" | "error"
  >("idle");
  const [emptyCanvasAnalyzeError, setEmptyCanvasAnalyzeError] = useState<string | null>(null);
  /** Random public IPs backing the intake starter cards (null → curated
   *  fallback while loading / when the plaza pool is empty). */
  const [ipStarters, setIpStarters] = useState<IpStarterSeed[] | null>(null);
  /** True while the analyzed story is being staged onto the canvas node by
   *  node — the AI edge glow stays on and autosave/lazy-create hold off
   *  until the full result has landed. */
  const [isAiDrawing, setIsAiDrawing] = useState(false);
  const aiDrawTokenRef = useRef(0);
  /** fizzstory-v3 story spec (genre / generator stamp / pipeline state) —
   *  REACT STATE, not a ref: pure spec changes must trigger autosave and
   *  join the snapshot signature. */
  const [storySpec, setStorySpec] = useState<Record<string, unknown> | null>(null);
  /** Set when hydration finds a generation still running server-side — a
   *  dedicated effect resumes the poll (survives refresh mid-generation). */
  const [resumeGenerationId, setResumeGenerationId] = useState<string | null>(null);

  // Feed the intake starter cards with REAL plaza IPs, randomly picked.
  useEffect(() => {
    let cancelled = false;
    const locale =
      typeof window === "undefined"
        ? undefined
        : window.location.pathname.split("/").filter(Boolean)[0];
    fetchRandomIpSeeds(4, locale)
      .then((items) => {
        if (!cancelled && items.length > 0) setIpStarters(items);
      })
      .catch(() => {
        // Plaza unreachable / empty — the intake simply shows no seed cards.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const emptyCanvasStarters = useMemo(
    () =>
      ipStarters && ipStarters.length > 0
        ? ipStarters.map((seed) => ({
            key: seed.id,
            title: seed.title,
            description: "Generate with StoryOS",
            prompt:
              `Turn the IP "${seed.title}" into a playable text story with a clear story root, ` +
              `plot spine, clues, characters, and endings.` +
              (seed.summary ? ` Synopsis: ${seed.summary}` : ""),
            image: seed.coverUrl,
          }))
        : [],
    [ipStarters]
  );
  const connectStartRef = useRef<Parameters<OnConnectStart>[1] | null>(null);
  const emptyCanvasUploadRef = useRef<HTMLInputElement | null>(null);
  const emptyCanvasInputRef = useRef<HTMLInputElement | null>(null);
  const snapshotBaseRef = useRef<StoryCanvasSnapshot>({});
  const lastSavedSnapshotRef = useRef("");
  /** CAS token — the last draft revision this client read or received. */
  const revisionRef = useRef(0);
  /** Per-mount save session — lets the server tell us when a conflicting
   *  revision was in fact our own racing write (adopt silently). */
  const [sessionId] = useState(() => crypto.randomUUID());
  /** Mirrors activeProjectId so the hydrate effect can skip re-fetching the
   *  project we just lazily created (router.replace re-runs the page). Only
   *  ever set AFTER a successful hydrate or lazy create — never from the prop,
   *  or the initial load would be skipped. */
  const activeProjectIdRef = useRef<string | null>(null);
  /** Single-flight lock for the lazy create. */
  const lazyCreateInFlightRef = useRef(false);
  const router = useRouter();
  const portDraftCounterRef = useRef<Record<ConnectionPortId, number>>({
    roles: 0,
    clues: 0,
  });
  const leftDockWidth = 82;
  const activeEditNode = useMemo(
    () => nodes.find((node) => node.id === activeEditNodeId) ?? null,
    [activeEditNodeId, nodes]
  );

  useEffect(() => {
    let isCancelled = false;

    async function hydrateCanvas() {
      // The lazy-create path already holds the live state for this project —
      // router.replace re-runs the page with the new projectId, and re-fetching
      // here would clobber edits made between create and navigation.
      if (projectId && projectId === activeProjectIdRef.current) return;

      setCanvasLoadError(null);
      setCanvasSaveError(null);
      setCanvasSaveState("idle");
      setDraftConflict(null);
      setHasHydratedCanvas(false);

      if (!projectId) {
        // Projectless editor: fully in-memory until the first meaningful
        // action lazily creates the story project (see the effect below).
        const emptySnapshot = buildStoryCanvasSnapshot({}, [], [], null);
        snapshotBaseRef.current = {};
        lastSavedSnapshotRef.current = JSON.stringify(emptySnapshot);
        revisionRef.current = 0;
        activeProjectIdRef.current = null;
        setActiveProjectId(null);
        setStorySpec(null);
        setCanvasTitle("未命名故事");
        setNodes([]);
        setEdges([]);
        setIsCanvasLoading(false);
        setHasHydratedCanvas(true);
        return;
      }

      setIsCanvasLoading(true);

      try {
        const project = await getStoryProject(projectId);

        if (isCancelled) return;

        const parsed = parseStoryCanvasSnapshot(project.draft.content);
        const parsedSpec = isRecord(parsed.base.storySpec)
          ? (parsed.base.storySpec as Record<string, unknown>)
          : null;
        const title =
          typeof parsed.base.title === "string" && parsed.base.title.trim()
            ? parsed.base.title
            : project.title;
        const snapshotForSignature = buildStoryCanvasSnapshot(
          parsed.base,
          parsed.nodes,
          parsed.edges,
          parsedSpec
        );

        snapshotBaseRef.current = parsed.base;
        lastSavedSnapshotRef.current = JSON.stringify(snapshotForSignature);
        revisionRef.current = project.draft.revision;
        activeProjectIdRef.current = project.id;
        setActiveProjectId(project.id);
        setStorySpec(parsedSpec);
        setCanvasTitle(title || "未命名故事");

        // Pipeline resume: the generation stage persists its state into the
        // draft server-side. Still RUNNING → re-enter the waiting experience
        // and poll (the run continues regardless of tabs). DONE but never
        // painted (timeout / closed tab) → rebuild the canvas from the
        // persisted analysis instead of re-burning the model; the next
        // autosave persists the painted canvas.
        const pipeline = draftPipelineState(project.draft.content);
        const persistedAnalysis = parsed.base.storyAnalysis;
        let paintedCount = parsed.nodes.length;
        if (parsed.nodes.length === 0 && pipeline?.status === "running") {
          setNodes([]);
          setEdges([]);
          setEmptyCanvasAnalyzeState("loading");
          setResumeGenerationId(project.id);
        } else if (
          parsed.nodes.length === 0 &&
          isRecord(persistedAnalysis) &&
          Array.isArray(persistedAnalysis.plots) &&
          persistedAnalysis.plots.length > 0
        ) {
          const rebuilt = buildNodesAndEdgesFromAnalysis(
            persistedAnalysis as unknown as StoryStudioAnalysis
          );
          paintedCount = rebuilt.nodes.length;
          setNodes(rebuilt.nodes);
          setEdges(rebuilt.edges);
        } else {
          setNodes(parsed.nodes);
          setEdges(parsed.edges);
        }
        // Frame the hydrated story once the nodes have been measured.
        window.setTimeout(() => {
          if (!isCancelled && paintedCount > 0) {
            void reactFlow.fitView({ padding: 0.1, maxZoom: 0.7 });
          }
        }, 80);
      } catch (error) {
        if (isCancelled) return;
        activeProjectIdRef.current = null;
        setActiveProjectId(null);
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
  }, [projectId, reactFlow, setEdges, setNodes]);

  /** Adopt server draft state into the local tracking refs + canvas. */
  const adoptServerDraft = useCallback(
    (content: Record<string, unknown>, revision: number) => {
      const parsed = parseStoryCanvasSnapshot(content);
      const parsedSpec = isRecord(parsed.base.storySpec)
        ? (parsed.base.storySpec as Record<string, unknown>)
        : null;
      snapshotBaseRef.current = parsed.base;
      lastSavedSnapshotRef.current = JSON.stringify(
        buildStoryCanvasSnapshot(parsed.base, parsed.nodes, parsed.edges, parsedSpec)
      );
      revisionRef.current = revision;
      setStorySpec(parsedSpec);
      if (typeof parsed.base.title === "string" && parsed.base.title.trim()) {
        setCanvasTitle(parsed.base.title);
      }
      setNodes(parsed.nodes);
      setEdges(parsed.edges);
    },
    [setEdges, setNodes]
  );

  // Debounced CAS autosave to the sovereign story-draft route.
  useEffect(() => {
    if (!hasHydratedCanvas || isCanvasLoading || !activeProjectId) return;
    // A stale-write conflict pauses autosave until the user picks a side —
    // retrying with a poisoned revision would just 409 every 700ms.
    if (draftConflict) return;
    // Mid staged-draw the canvas is intentionally partial — save once the
    // full analyzed story has landed.
    if (isAiDrawing) return;

    const timer = window.setTimeout(async () => {
      // Snapshot + signature are computed INSIDE the debounce window: doing
      // it per render tick would stringify the whole canvas on every drag
      // frame for nothing.
      const nextSnapshot = buildStoryCanvasSnapshot(
        snapshotBaseRef.current,
        nodes,
        edges,
        storySpec
      );
      const nextSignature = JSON.stringify(nextSnapshot);
      if (nextSignature === lastSavedSnapshotRef.current) return;

      setCanvasSaveState("saving");
      setCanvasSaveError(null);

      try {
        const saved = await putStoryDraft(activeProjectId, {
          content: nextSnapshot,
          revision: revisionRef.current,
          sessionId,
        });

        snapshotBaseRef.current = nextSnapshot;
        lastSavedSnapshotRef.current = nextSignature;
        revisionRef.current = saved.revision;
        setCanvasSaveState("saved");
      } catch (error) {
        const conflict = draftRevisionConflict(error);
        if (conflict) {
          if (conflict.updatedBySessionId === sessionId) {
            // Our own racing write already landed (e.g. a retried request) —
            // adopt the revision silently and re-save the latest local state.
            try {
              const retried = await putStoryDraft(activeProjectId, {
                content: nextSnapshot,
                revision: conflict.currentRevision,
                sessionId,
              });
              snapshotBaseRef.current = nextSnapshot;
              lastSavedSnapshotRef.current = nextSignature;
              revisionRef.current = retried.revision;
              setCanvasSaveState("saved");
              return;
            } catch (retryError) {
              const retryConflict = draftRevisionConflict(retryError);
              if (retryConflict && retryConflict.updatedBySessionId !== sessionId) {
                setDraftConflict(retryConflict);
                setCanvasSaveState("error");
                return;
              }
              setCanvasSaveState("error");
              setCanvasSaveError(
                retryError instanceof Error ? retryError.message : "Failed to save the canvas"
              );
              return;
            }
          }
          // Someone else's session updated the draft — surface the banner.
          setDraftConflict(conflict);
          setCanvasSaveState("error");
          return;
        }
        setCanvasSaveState("error");
        setCanvasSaveError(error instanceof Error ? error.message : "Failed to save the canvas");
      }
    }, 700);

    return () => window.clearTimeout(timer);
  }, [
    activeProjectId,
    draftConflict,
    edges,
    hasHydratedCanvas,
    isAiDrawing,
    isCanvasLoading,
    nodes,
    sessionId,
    storySpec,
  ]);

  // Lazy create (projectless editor ONLY): on the first meaningful action —
  // the AI analyze completing or the first node added by any path — persist
  // the in-memory canvas as a real story project and put its id in the URL.
  // A project that FAILED to hydrate must never silently fork into a new one,
  // hence the `projectId` (prop) guard.
  useEffect(() => {
    if (!hasHydratedCanvas || isCanvasLoading || projectId) return;
    if (activeProjectId || nodes.length === 0) return;
    // The staged draw is one meaningful action — create once it completes,
    // with the full analyzed canvas, not a mid-animation slice.
    if (isAiDrawing) return;
    if (lazyCreateInFlightRef.current) return;
    lazyCreateInFlightRef.current = true;

    const content = buildStoryCanvasSnapshot(snapshotBaseRef.current, nodes, edges, storySpec);
    const signature = JSON.stringify(content);

    void createStoryProject({ content })
      .then((project) => {
        lastSavedSnapshotRef.current = signature;
        revisionRef.current = project.draft.revision;
        activeProjectIdRef.current = project.id;
        setActiveProjectId(project.id);
        setCanvasSaveState("saved");
        // Reflect the project in the URL; the hydrate effect skips re-fetching
        // (activeProjectIdRef already points at this project).
        router.replace(`/story-studio/editor?projectId=${project.id}`);
      })
      .catch((error: unknown) => {
        // Stay in-memory ("Not saved yet"); the next edit retries the create.
        setCanvasSaveError(error instanceof Error ? error.message : "Failed to save the canvas");
        setCanvasSaveState("error");
      })
      .finally(() => {
        lazyCreateInFlightRef.current = false;
      });
  }, [
    activeProjectId,
    edges,
    hasHydratedCanvas,
    isAiDrawing,
    isCanvasLoading,
    nodes,
    projectId,
    router,
    storySpec,
  ]);

  /** Conflict banner: discard local edits and load the server's draft. */
  const resolveConflictLoadLatest = useCallback(() => {
    if (!draftConflict || conflictBusy) return;
    adoptServerDraft(draftConflict.content, draftConflict.currentRevision);
    setDraftConflict(null);
    setCanvasSaveState("saved");
    setCanvasSaveError(null);
  }, [adoptServerDraft, conflictBusy, draftConflict]);

  /** Conflict banner: keep local edits — retry the save on top of the server
   *  revision (a deliberate overwrite, not a blind CAS retry). */
  const resolveConflictOverwrite = useCallback(async () => {
    if (!draftConflict || conflictBusy || !activeProjectId) return;
    setConflictBusy(true);
    setCanvasSaveState("saving");
    try {
      const content = buildStoryCanvasSnapshot(snapshotBaseRef.current, nodes, edges, storySpec);
      const saved = await putStoryDraft(activeProjectId, {
        content,
        revision: draftConflict.currentRevision,
        sessionId,
      });
      snapshotBaseRef.current = content;
      lastSavedSnapshotRef.current = JSON.stringify(content);
      revisionRef.current = saved.revision;
      setDraftConflict(null);
      setCanvasSaveState("saved");
      setCanvasSaveError(null);
    } catch (error) {
      // The draft moved again mid-resolution — refresh the banner's baseline.
      const conflict = draftRevisionConflict(error);
      if (conflict) {
        setDraftConflict(conflict);
      } else {
        setCanvasSaveError(error instanceof Error ? error.message : "Failed to save the canvas");
      }
      setCanvasSaveState("error");
    } finally {
      setConflictBusy(false);
    }
  }, [activeProjectId, conflictBusy, draftConflict, edges, nodes, sessionId, storySpec]);

  const openNodeEditor = useCallback((nodeId: string) => {
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
      if (kind === "storyRoot") {
        // A story has exactly one root; jump to the existing one instead of
        // forking a second spine the compiler and edge rules would ignore.
        const existingRoot = nodes.find((node) => node.data.kind === "storyRoot");
        if (existingRoot) {
          setNodes((current) =>
            current.map((node) => ({ ...node, selected: node.id === existingRoot.id }))
          );
          void reactFlow.setCenter(
            existingRoot.position.x + (existingRoot.measured?.width ?? 380) / 2,
            existingRoot.position.y + (existingRoot.measured?.height ?? 260) / 2,
            { zoom: reactFlow.getZoom(), duration: 500 }
          );
          toast.info("A story has a single Story Root — it's already on the canvas.");
          return;
        }
      }
      const nextIndex = nodes.length + 1;
      const x = 260 + (nextIndex % 4) * 380;
      const y = 500 + Math.floor(nextIndex / 4) * 260;
      setNodes((current) => [
        ...current,
        {
          // The root keeps the FIXED id "storyRoot" — edge rules identify
          // the root by that id.
          id: kind === "storyRoot" ? "storyRoot" : `${kind}-${Date.now()}`,
          type: "narrative",
          position: { x, y },
          data: nodeDefaults(kind, nextIndex),
        },
      ]);
    },
    [nodes, reactFlow, setNodes]
  );

  /** The "AI is drawing" reveal: stage the analyzed story onto the canvas
   *  element by element — root first, then cast/plots/clues/endings in the
   *  builder's order, each edge appearing once both endpoints exist. The
   *  data is the REAL analysis result, only its arrival is choreographed.
   *  Resolves after the last element (and its entrance) has settled. */
  const playAiDrawing = useCallback(
    async (generated: { nodes: NarrativeNode[]; edges: NarrativeEdge[] }) => {
      const token = ++aiDrawTokenRef.current;
      const alive = () => aiDrawTokenRef.current === token;
      const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
      // The whole reveal targets ~5s regardless of story size.
      const stepMs = Math.max(
        110,
        Math.min(320, Math.floor(4600 / Math.max(1, generated.nodes.length)))
      );

      setIsAiDrawing(true);
      setNodes([]);
      setEdges([]);
      // Frame the fan (root + lane heads) while it draws; the exact fit
      // happens once the last element has landed.
      reactFlow.setViewport({ x: 60, y: 330, zoom: 0.4 });

      const placed = new Set<string>();
      let pendingEdges = [...generated.edges];
      try {
        for (const node of generated.nodes) {
          if (!alive()) return;
          placed.add(node.id);
          setNodes((current) => [...current, { ...node, className: "fizz-node-enter" }]);
          const ready = pendingEdges.filter(
            (edge) => placed.has(edge.source) && placed.has(edge.target)
          );
          if (ready.length > 0) {
            pendingEdges = pendingEdges.filter((edge) => !ready.includes(edge));
            setEdges((current) => [
              ...current,
              ...ready.map((edge) => ({ ...edge, className: "fizz-edge-enter" })),
            ]);
          }
          await sleep(stepMs);
        }
        if (!alive()) return;
        // Safety net: edges whose endpoints never both appeared (malformed
        // analysis) still land rather than silently vanishing.
        if (pendingEdges.length > 0) {
          setEdges((current) => [...current, ...pendingEdges]);
        }
        await sleep(380);
        if (!alive()) return;
        // Drop the entrance classes so the settled canvas is clean.
        setNodes((current) =>
          current.map((node) => (node.className ? { ...node, className: undefined } : node))
        );
        setEdges((current) =>
          current.map((edge) => (edge.className ? { ...edge, className: undefined } : edge))
        );
        // Re-measure handles now that the scale-in animation has settled —
        // React Flow captures handle offsets when a node mounts, i.e. while
        // `fizz-node-enter` still has it scaled down; without this pass the
        // edges stay anchored at the shrunken positions.
        window.requestAnimationFrame(() => {
          updateNodeInternals(generated.nodes.map((node) => node.id));
        });
        void reactFlow.fitView({ padding: 0.1, duration: 700, maxZoom: 0.7 });
      } finally {
        if (alive()) setIsAiDrawing(false);
      }
    },
    [reactFlow, setEdges, setNodes, updateNodeInternals]
  );

  /** Terminal-state painter shared by the click flow and refresh-resume:
   *  adopt the persisted draft (revision + spec), sync the snapshot base,
   *  then stage the analyzed story onto the canvas. */
  const adoptGeneratedAnalysis = useCallback(
    async (analysis: StoryStudioAnalysis, draft: StoryDraft) => {
      revisionRef.current = draft.revision;
      setStorySpec(
        isRecord(draft.content.storySpec)
          ? (draft.content.storySpec as Record<string, unknown>)
          : null
      );
      snapshotBaseRef.current = {
        ...snapshotBaseRef.current,
        title: analysis.title,
        summary: analysis.summary,
        storyAnalysis: analysis as unknown as Record<string, unknown>,
      };
      setCanvasTitle(analysis.title);
      setEmptyCanvasAnalyzeState("idle");
      setEmptyCanvasAnalyzeError(null);
      await playAiDrawing(buildNodesAndEdgesFromAnalysis(analysis));
    },
    [playAiDrawing]
  );

  // Refresh-resume: hydration found a generation still running server-side —
  // poll the draft to its terminal state and paint exactly like a live run.
  useEffect(() => {
    if (!resumeGenerationId) return;
    let cancelled = false;

    void (async () => {
      try {
        const { analysis, draft } = await pollStoryAnalysis(resumeGenerationId);
        if (cancelled) return;
        await adoptGeneratedAnalysis(analysis, draft);
      } catch (error) {
        if (cancelled) return;
        setEmptyCanvasAnalyzeState("error");
        setEmptyCanvasAnalyzeError(error instanceof Error ? error.message : "Analyze failed.");
      } finally {
        if (!cancelled) setResumeGenerationId(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [adoptGeneratedAnalysis, resumeGenerationId]);

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

      // Starting generation IS the first meaningful action — materialize the
      // project up front so the server-side stage has a draft to persist into
      // (resumable pipeline, docs/story-studio-creator-v3-refactor.md §D3).
      let projectId = activeProjectId;
      if (!projectId) {
        const project = await createStoryProject({ locale });
        projectId = project.id;
        activeProjectIdRef.current = project.id;
        setActiveProjectId(project.id);
        revisionRef.current = project.draft.revision;
        router.replace(`/story-studio/editor?projectId=${project.id}`);
      }

      // Async stage: start returns immediately (proxy-timeout-proof); the
      // model run persists into the draft and we poll for the terminal state.
      await startStoryAnalysis(projectId, {
        prompt: prompt || undefined,
        uploadedFileName: emptyCanvasUploadName ?? undefined,
        uploadedContent: emptyCanvasUploadContent ?? undefined,
        locale,
        sessionId,
      });
      const { analysis, draft } = await pollStoryAnalysis(projectId);
      await adoptGeneratedAnalysis(analysis, draft);
    } catch (error) {
      setEmptyCanvasAnalyzeState("error");
      setEmptyCanvasAnalyzeError(error instanceof Error ? error.message : "Analyze failed.");
    }
  }, [
    activeProjectId,
    adoptGeneratedAnalysis,
    emptyCanvasPrompt,
    emptyCanvasUploadContent,
    emptyCanvasUploadName,
    router,
    sessionId,
  ]);

  return (
    <main className="relative h-screen overflow-hidden bg-[oklch(0.105_0_0)] text-white">
      <AiEdgeGlow
        active={emptyCanvasAnalyzeState === "loading" || isAiDrawing}
        label={
          emptyCanvasAnalyzeState === "loading"
            ? "StoryOS is thinking..."
            : "StoryOS is drawing your story..."
        }
      />
      <AiSketchGhost active={emptyCanvasAnalyzeState === "loading" && nodes.length === 0} />
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

      {!isCanvasLoading &&
      hasHydratedCanvas &&
      !canvasLoadError &&
      nodes.length === 0 &&
      // From the moment Generate is pressed the intake yields to the canvas
      // (sketch ghost + edge glow) — it only returns on analyze failure.
      emptyCanvasAnalyzeState !== "loading" &&
      !isAiDrawing ? (
        <section
          className="pointer-events-none absolute bottom-0 top-[104px] z-10 flex items-center justify-center overflow-hidden px-8 transition-[left] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
          style={{ left: leftDockWidth, right: 0 }}
          aria-label="StoryOS empty canvas intake"
        >
          <div className="pointer-events-auto w-full max-w-[1160px] text-center">
            <p className="text-[15px] text-white/45">
              Double-click the canvas or describe what to generate.
            </p>

            <div className="mx-auto mt-7 flex h-[64px] max-w-[920px] items-center gap-2 rounded-full bg-white/[0.105] p-2 shadow-[0_24px_90px_rgba(0,0,0,0.34)] backdrop-blur-2xl">
              <input
                ref={emptyCanvasInputRef}
                value={emptyCanvasPrompt}
                onChange={(event) => setEmptyCanvasPrompt(event.target.value)}
                placeholder="Describe the story you want StoryOS to generate..."
                className="h-full min-w-0 flex-1 bg-transparent px-6 text-[15px] font-light text-white/85 outline-none placeholder:text-white/35"
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
                onClick={() => emptyCanvasUploadRef.current?.click()}
                className="inline-flex h-12 shrink-0 items-center justify-center rounded-full bg-white/10 px-6 text-[14px] font-medium text-white/72 transition hover:bg-white/15 hover:text-white active:translate-y-0.5"
              >
                {emptyCanvasUploadName ? "Uploaded" : "Upload"}
              </button>
              <button
                type="button"
                onClick={createStoryRootFromEmptyState}
                className="inline-flex h-12 shrink-0 items-center justify-center rounded-full bg-[#E52227] px-7 text-[14px] font-medium text-white shadow-[0_7px_0_0_rgba(122,14,17,0.9)] transition-[translate,box-shadow,background] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-[#ff3d42] active:translate-y-1 active:shadow-[0_2px_0_0_rgba(122,14,17,0.9)]"
              >
                Generate
              </button>
            </div>

            {emptyCanvasUploadName ? (
              <p className="mt-3 text-xs font-medium text-white/36">
                Selected text document: {emptyCanvasUploadName}
              </p>
            ) : null}

            {emptyCanvasAnalyzeState === "error" && emptyCanvasAnalyzeError ? (
              <p className="mx-auto mt-3 max-w-[760px] text-sm font-medium leading-6 text-[#ff8b8e]">
                {emptyCanvasAnalyzeError}
              </p>
            ) : null}

            <div className="mt-7 grid grid-cols-4 gap-4">
              {emptyCanvasStarters.map((starter) => (
                <button
                  key={starter.key}
                  type="button"
                  onClick={() => {
                    setEmptyCanvasPrompt((current) => current || starter.prompt);
                    setEmptyCanvasAnalyzeError(null);
                    window.setTimeout(() => emptyCanvasInputRef.current?.focus(), 0);
                  }}
                  className="group relative h-[96px] overflow-hidden rounded-[22px] bg-cover bg-center p-5 text-left shadow-[0_22px_72px_rgba(0,0,0,0.26)] transition duration-200 hover:-translate-y-1 hover:shadow-[0_30px_90px_rgba(0,0,0,0.42)]"
                  style={{
                    backgroundImage: starter.image
                      ? `linear-gradient(90deg, rgba(18,18,18,0.86), rgba(18,18,18,0.48)), url(${starter.image})`
                      : "linear-gradient(90deg, oklch(0.22 0 0), oklch(0.17 0 0))",
                  }}
                >
                  <span className="absolute inset-0 bg-black/18 opacity-0 transition group-hover:opacity-100" />
                  <span className="relative block text-[15px] font-semibold leading-tight text-white/94">
                    {starter.title}
                  </span>
                  <span className="relative mt-1.5 block text-[12px] font-medium leading-5 text-white/56 transition group-hover:text-white/68">
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
              ? "Loading project"
              : canvasLoadError
                ? "Load failed"
                : draftConflict
                  ? "Version conflict"
                  : canvasSaveState === "saving"
                    ? "Saving"
                    : canvasSaveState === "saved"
                      ? "Saved"
                      : !activeProjectId
                        ? "Not saved yet"
                        : canvasSaveState === "error"
                          ? "Save failed"
                          : "Synced"}
          </span>
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

      {/* Stale-write conflict: another session updated the draft. Autosave is
          paused; the user picks a side (server truth vs deliberate overwrite). */}
      {draftConflict ? (
        <div
          role="alertdialog"
          aria-label="Draft version conflict"
          className="absolute top-[92px] left-1/2 z-30 flex w-[560px] max-w-[calc(100%-48px)] -translate-x-1/2 items-center gap-4 rounded-[24px] bg-[oklch(0.18_0_0)/0.94] px-5 py-4 shadow-[0_24px_90px_rgba(0,0,0,0.5)] backdrop-blur-2xl duration-200 animate-in fade-in-0 slide-in-from-top-2"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#E52227]/16">
            <IconGitBranch className="size-4.5 text-[#ff8b8e]" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-white/90">This draft changed somewhere else</p>
            <p className="mt-0.5 text-xs leading-5 text-white/48">
              Another session saved a newer version
              {draftConflict.updatedAt
                ? ` at ${new Date(draftConflict.updatedAt).toLocaleTimeString()}`
                : ""}
              . Load it, or overwrite it with your canvas.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={resolveConflictLoadLatest}
              disabled={conflictBusy}
              className="inline-flex h-9 items-center rounded-full bg-white px-4 text-xs font-bold text-black transition hover:bg-white/88 disabled:opacity-60"
            >
              Load latest
            </button>
            <button
              type="button"
              onClick={() => void resolveConflictOverwrite()}
              disabled={conflictBusy}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/10 px-4 text-xs font-bold text-white/80 transition hover:bg-white/15 hover:text-white disabled:opacity-60"
            >
              {conflictBusy ? <IconRefresh className="size-3.5 animate-spin" /> : null}
              Overwrite with mine
            </button>
          </div>
        </div>
      ) : null}

      {activeEditNode ? (
        <NodeEditorPanel
          key={activeEditNode.id}
          node={activeEditNode}
          onClose={() => setActiveEditNodeId(null)}
          onChange={(patch) => updateNodeData(activeEditNode.id, patch)}
          onDelete={() => deleteNode(activeEditNode.id)}
        />
      ) : null}

      <div
        className="absolute inset-y-0 left-0 z-30 flex overflow-hidden bg-[oklch(0.13_0_0)] shadow-[18px_0_80px_rgba(0,0,0,0.32)] transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{ width: leftDockWidth }}
      >
        <aside className="flex h-full w-[82px] shrink-0 flex-col items-center justify-between bg-[oklch(0.13_0_0)] px-3 py-6">
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
      </div>
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
