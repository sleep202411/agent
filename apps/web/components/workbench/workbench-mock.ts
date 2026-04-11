// ─── Types ───────────────────────────────────────────

export interface WorkbenchTask {
  id: string;
  title: string;
  crew: string;
  crewId: string;
  status: "in_progress" | "pending_review" | "to_pick_up";
  deadline: string;
  urgent: boolean;
}

export interface MyCrew {
  id: string;
  name: string;
  role: string;
  phase: string;
  progress: number;
}

// ─── Status config ───────────────────────────────────

export const TASK_STATUS_CONFIG: Record<string, { labelKey: string; color: string }> = {
  in_progress: {
    labelKey: "statusInProgress",
    color: "text-blue-400 bg-blue-400/10 border-blue-400/30",
  },
  pending_review: {
    labelKey: "statusPendingReview",
    color: "text-amber-400 bg-amber-400/10 border-amber-400/30",
  },
  to_pick_up: {
    labelKey: "statusToPickUp",
    color: "text-violet-400 bg-violet-400/10 border-violet-400/30",
  },
};

export const STATUS_FILTERS = [
  { value: "all", labelKey: "filterAll" },
  { value: "in_progress", labelKey: "statusInProgress" },
  { value: "pending_review", labelKey: "statusPendingReview" },
  { value: "to_pick_up", labelKey: "statusToPickUp" },
] as const;

// ─── Mock data ───────────────────────────────────────

export const MOCK_TASKS: WorkbenchTask[] = [
  {
    id: "t1",
    title: "角色精修全套图",
    crew: "赛博山海经预告片组",
    crewId: "s1",
    status: "in_progress",
    deadline: "3月30日",
    urgent: false,
  },
  {
    id: "t2",
    title: "分镜草稿 Act 1",
    crew: "赛博山海经预告片组",
    crewId: "s1",
    status: "pending_review",
    deadline: "3月28日",
    urgent: false,
  },
  {
    id: "t3",
    title: "配音录制 ×5 角色",
    crew: "算法女神商业片",
    crewId: "s5",
    status: "in_progress",
    deadline: "今天",
    urgent: true,
  },
  {
    id: "t4",
    title: "AI 图片生成：场景概念图",
    crew: "虚空传说10集动画",
    crewId: "s4",
    status: "to_pick_up",
    deadline: "4月5日",
    urgent: false,
  },
  {
    id: "t5",
    title: "EP03 剧本修改稿",
    crew: "深港品牌宣传片组",
    crewId: "s2",
    status: "pending_review",
    deadline: "4月1日",
    urgent: false,
  },
  {
    id: "t6",
    title: "主角立绘终稿",
    crew: "赛博山海经预告片组",
    crewId: "s1",
    status: "in_progress",
    deadline: "4月2日",
    urgent: false,
  },
];

export const MOCK_MY_CREWS: MyCrew[] = [
  { id: "s1", name: "赛博山海经预告片组", role: "AI画师", phase: "分镜阶段", progress: 35 },
  { id: "s2", name: "深港品牌宣传片组", role: "后期剪辑", phase: "视频生成", progress: 62 },
];
