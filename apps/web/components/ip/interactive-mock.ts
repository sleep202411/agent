import type { Node, Edge } from "@xyflow/react";

// ─── Episode types ───────────────────────────────────

export type EpisodeType = "linear" | "interactive";

export interface ManagedEpisode {
  id: string;
  number: number;
  title: string;
  type: EpisodeType;
  price: number;
  status: "draft" | "published";
  videoUrl?: string;
  coverUrl?: string;
  duration?: number;
}

// ─── Interactive video node types ────────────────────

export interface VideoNodeData {
  label: string;
  description: string;
  videoUrl: string;
  duration: number;
  isStart?: boolean;
  isEnding?: boolean;
  choices: ChoiceData[];
  [key: string]: unknown;
}

export interface ChoiceData {
  id: string;
  label: string;
  targetNodeId: string;
}

export type VideoNode = Node<VideoNodeData, "video">;

// ─── Mock episodes ───────────────────────────────────

export const MOCK_MANAGED_EPISODES: ManagedEpisode[] = [
  {
    id: "ep1",
    number: 1,
    title: "新长安",
    type: "linear",
    price: 12,
    status: "published",
    duration: 480,
  },
  {
    id: "ep2",
    number: 2,
    title: "山海局",
    type: "linear",
    price: 15,
    status: "published",
    duration: 520,
  },
  {
    id: "ep3",
    number: 3,
    title: "霓虹追逐",
    type: "interactive",
    price: 18,
    status: "published",
    duration: 600,
  },
  { id: "ep4", number: 4, title: "穷奇之影", type: "linear", price: 15, status: "draft" },
  { id: "ep5", number: 5, title: "命运抉择", type: "interactive", price: 20, status: "draft" },
];

// ─── Mock interactive flow ───────────────────────────

export const MOCK_NODES: VideoNode[] = [
  {
    id: "start",
    type: "video",
    position: { x: 250, y: 0 },
    data: {
      label: "开场：城市废墟",
      description: "主角在废墟中醒来，发现自己身处陌生的城市",
      videoUrl: "",
      duration: 45,
      isStart: true,
      choices: [
        { id: "c1", label: "调查周围环境", targetNodeId: "explore" },
        { id: "c2", label: "寻找其他幸存者", targetNodeId: "survivors" },
      ],
    },
  },
  {
    id: "explore",
    type: "video",
    position: { x: 0, y: 200 },
    data: {
      label: "探索废墟",
      description: "在废墟中发现了一个神秘的装置",
      videoUrl: "",
      duration: 60,
      choices: [
        { id: "c3", label: "启动装置", targetNodeId: "activate" },
        { id: "c4", label: "带走装置继续前进", targetNodeId: "take" },
      ],
    },
  },
  {
    id: "survivors",
    type: "video",
    position: { x: 500, y: 200 },
    data: {
      label: "遇见幸存者",
      description: "找到一群幸存者，他们有自己的秘密",
      videoUrl: "",
      duration: 55,
      choices: [
        { id: "c5", label: "加入他们", targetNodeId: "join" },
        { id: "c6", label: "独自行动", targetNodeId: "alone" },
      ],
    },
  },
  {
    id: "activate",
    type: "video",
    position: { x: -100, y: 420 },
    data: {
      label: "结局A：新世界",
      description: "装置打开了通往新世界的大门",
      videoUrl: "",
      duration: 40,
      isEnding: true,
      choices: [],
    },
  },
  {
    id: "take",
    type: "video",
    position: { x: 150, y: 420 },
    data: {
      label: "继续探索",
      description: "带着装置深入城市腹地",
      videoUrl: "",
      duration: 50,
      choices: [{ id: "c7", label: "遇到幸存者", targetNodeId: "join" }],
    },
  },
  {
    id: "join",
    type: "video",
    position: { x: 350, y: 420 },
    data: {
      label: "结局B：团结",
      description: "与幸存者一起重建家园",
      videoUrl: "",
      duration: 45,
      isEnding: true,
      choices: [],
    },
  },
  {
    id: "alone",
    type: "video",
    position: { x: 600, y: 420 },
    data: {
      label: "结局C：孤独求生",
      description: "独自面对未知的命运",
      videoUrl: "",
      duration: 35,
      isEnding: true,
      choices: [],
    },
  },
];

export const MOCK_EDGES: Edge[] = [
  {
    id: "e-start-explore",
    source: "start",
    target: "explore",
    label: "调查周围环境",
    type: "smoothstep",
  },
  {
    id: "e-start-survivors",
    source: "start",
    target: "survivors",
    label: "寻找其他幸存者",
    type: "smoothstep",
  },
  {
    id: "e-explore-activate",
    source: "explore",
    target: "activate",
    label: "启动装置",
    type: "smoothstep",
  },
  {
    id: "e-explore-take",
    source: "explore",
    target: "take",
    label: "带走装置",
    type: "smoothstep",
  },
  {
    id: "e-survivors-join",
    source: "survivors",
    target: "join",
    label: "加入他们",
    type: "smoothstep",
  },
  {
    id: "e-survivors-alone",
    source: "survivors",
    target: "alone",
    label: "独自行动",
    type: "smoothstep",
  },
  { id: "e-take-join", source: "take", target: "join", label: "遇到幸存者", type: "smoothstep" },
];
