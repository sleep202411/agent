// ─── Workspace types ─────────────────────────────────

export interface WorkspaceStudio {
  name: string;
  status: string;
  type: string;
  tags: string[];
  client: string;
  producer: string;
  currentEpisode: number;
  totalEpisodes: number;
  lastUpdated: string;
  memberCount: number;
  slotsTotal: number;
  slotsFilled: number;
  currentEpMembers: number;
  todoCount: number;
}

export interface EpMember {
  name: string;
  role: string;
  status: "approved" | "submitted" | "in_progress" | "rejected";
  statusLabelKey: string;
  color: string;
  updated: string;
}

export interface RoleProgress {
  role: string;
  filled: number;
  total: number;
}

export interface TodoItem {
  text: string;
  urgent: boolean;
}

export interface WorkspaceActivity {
  text: string;
  time: string;
}

export interface EpisodeData {
  ep: number;
  label: string;
  status: "completed" | "in_progress" | "not_started";
  statusLabelKey: string;
  isCurrent?: boolean;
  summary: string;
  members: number;
  passed: number;
  pending: number;
  clientStatus: string;
  clientStatusKey: string;
  membersList: EpMember[];
  activity: WorkspaceActivity[];
}

export interface DeliveryRecord {
  ep: string;
  date: string;
  statusKey: string;
  ok: boolean;
}

// ─── Status config ───────────────────────────────────

export const EP_STATUS_COLOR: Record<string, string> = {
  completed: "text-green-400 bg-green-400/10 border-green-400/30",
  in_progress: "text-blue-400 bg-blue-400/10 border-blue-400/30",
  not_started: "text-muted-foreground bg-secondary border-border",
};

export const MEMBER_STATUS_META: Record<string, { labelKey: string; color: string }> = {
  approved: { labelKey: "msApproved", color: "text-green-400 bg-green-400/10 border-green-400/30" },
  submitted: { labelKey: "msSubmitted", color: "text-blue-400 bg-blue-400/10 border-blue-400/30" },
  in_progress: {
    labelKey: "msInProgress",
    color: "text-amber-400 bg-amber-400/10 border-amber-400/30",
  },
  rejected: { labelKey: "msRejected", color: "text-red-400 bg-red-400/10 border-red-400/30" },
};

export const MEMBER_ACTIONS: Record<string, { labelKey: string; style: string; action: string }[]> =
  {
    approved: [{ labelKey: "actView", style: "ghost", action: "view" }],
    submitted: [
      { labelKey: "actView", style: "ghost", action: "view" },
      { labelKey: "actApprove", style: "primary", action: "approve" },
      { labelKey: "actReject", style: "red", action: "reject" },
    ],
    in_progress: [
      { labelKey: "actView", style: "ghost", action: "view" },
      { labelKey: "actSubmitReview", style: "warn", action: "submit" },
    ],
    rejected: [
      { labelKey: "actView", style: "ghost", action: "view" },
      { labelKey: "actSubmitReview", style: "warn", action: "submit" },
    ],
  };

// ─── Mock data ───────────────────────────────────────

export const MOCK_WORKSPACE: WorkspaceStudio = {
  name: "赛博山海经",
  status: "制作中",
  type: "AI 短剧",
  tags: ["悬疑", "赛博朋克"],
  client: "幻影传媒",
  producer: "影子制片",
  currentEpisode: 3,
  totalEpisodes: 6,
  lastUpdated: "2小时前",
  memberCount: 12,
  slotsTotal: 10,
  slotsFilled: 8,
  currentEpMembers: 6,
  todoCount: 3,
};

export const CURRENT_EP_MEMBERS: EpMember[] = [
  {
    name: "张三",
    role: "编剧",
    status: "approved",
    statusLabelKey: "msApproved",
    color: "text-green-400 bg-green-400/10 border-green-400/30",
    updated: "2小时前",
  },
  {
    name: "李四",
    role: "AI画师",
    status: "submitted",
    statusLabelKey: "msSubmitted",
    color: "text-blue-400 bg-blue-400/10 border-blue-400/30",
    updated: "1小时前",
  },
  {
    name: "王五",
    role: "配音",
    status: "in_progress",
    statusLabelKey: "msInProgress",
    color: "text-amber-400 bg-amber-400/10 border-amber-400/30",
    updated: "3小时前",
  },
  {
    name: "赵六",
    role: "剪辑",
    status: "rejected",
    statusLabelKey: "msRejected",
    color: "text-red-400 bg-red-400/10 border-red-400/30",
    updated: "昨天",
  },
];

export const ROLES_PROGRESS: RoleProgress[] = [
  { role: "编剧", filled: 1, total: 1 },
  { role: "AI画师", filled: 2, total: 3 },
  { role: "配音", filled: 4, total: 4 },
  { role: "剪辑", filled: 1, total: 1 },
];

export const TODOS: TodoItem[] = [
  { text: "李四提交待审核", urgent: true },
  { text: "王五尚未提交", urgent: true },
  { text: "第2集客户反馈需修改", urgent: false },
];

export const ACTIVITY_LIST: WorkspaceActivity[] = [
  { text: "张三提交了第3集剧本", time: "1小时前" },
  { text: "客户确认了第2集", time: "3小时前" },
  { text: "新招募1名配音演员", time: "昨天" },
  { text: "第3集分镜已开始制作", time: "昨天" },
];

export const MOCK_EPISODES: EpisodeData[] = [
  {
    ep: 1,
    label: "EP1",
    status: "completed",
    statusLabelKey: "epCompleted",
    summary: "4名成员 · 已确认 · 更新于 2026-03-08",
    members: 4,
    passed: 4,
    pending: 0,
    clientStatus: "客户已确认",
    clientStatusKey: "clientConfirmed",
    membersList: [
      {
        name: "张三",
        role: "编剧",
        status: "approved",
        statusLabelKey: "msApproved",
        color: "text-green-400 bg-green-400/10 border-green-400/30",
        updated: "2026-03-08",
      },
      {
        name: "李四",
        role: "AI绘画",
        status: "approved",
        statusLabelKey: "msApproved",
        color: "text-green-400 bg-green-400/10 border-green-400/30",
        updated: "2026-03-07",
      },
      {
        name: "王五",
        role: "配音",
        status: "approved",
        statusLabelKey: "msApproved",
        color: "text-green-400 bg-green-400/10 border-green-400/30",
        updated: "2026-03-07",
      },
      {
        name: "赵六",
        role: "剪辑",
        status: "approved",
        statusLabelKey: "msApproved",
        color: "text-green-400 bg-green-400/10 border-green-400/30",
        updated: "2026-03-08",
      },
    ],
    activity: [
      { text: "客户确认了 EP1", time: "2026-03-08" },
      { text: "制片人完成审核", time: "2026-03-07" },
    ],
  },
  {
    ep: 2,
    label: "EP2",
    status: "completed",
    statusLabelKey: "epCompleted",
    summary: "5名成员 · 已确认 · 更新于 2026-03-15",
    members: 5,
    passed: 5,
    pending: 0,
    clientStatus: "客户已确认",
    clientStatusKey: "clientConfirmed",
    membersList: [
      {
        name: "张三",
        role: "编剧",
        status: "approved",
        statusLabelKey: "msApproved",
        color: "text-green-400 bg-green-400/10 border-green-400/30",
        updated: "2026-03-14",
      },
      {
        name: "李四",
        role: "AI绘画",
        status: "approved",
        statusLabelKey: "msApproved",
        color: "text-green-400 bg-green-400/10 border-green-400/30",
        updated: "2026-03-13",
      },
      {
        name: "王五",
        role: "配音",
        status: "approved",
        statusLabelKey: "msApproved",
        color: "text-green-400 bg-green-400/10 border-green-400/30",
        updated: "2026-03-13",
      },
      {
        name: "赵六",
        role: "剪辑",
        status: "approved",
        statusLabelKey: "msApproved",
        color: "text-green-400 bg-green-400/10 border-green-400/30",
        updated: "2026-03-15",
      },
      {
        name: "小林",
        role: "角色设计",
        status: "approved",
        statusLabelKey: "msApproved",
        color: "text-green-400 bg-green-400/10 border-green-400/30",
        updated: "2026-03-12",
      },
    ],
    activity: [
      { text: "客户确认了 EP2", time: "2026-03-15" },
      { text: "制片人完成审核", time: "2026-03-14" },
    ],
  },
  {
    ep: 3,
    label: "EP3",
    status: "in_progress",
    statusLabelKey: "epInProgress",
    isCurrent: true,
    summary: "6名成员 · 2人待审 · 更新于 2小时前",
    members: 6,
    passed: 3,
    pending: 2,
    clientStatus: "未提交",
    clientStatusKey: "notSubmitted",
    membersList: [
      {
        name: "张三",
        role: "编剧",
        status: "approved",
        statusLabelKey: "msApproved",
        color: "text-green-400 bg-green-400/10 border-green-400/30",
        updated: "2小时前",
      },
      {
        name: "李四",
        role: "AI绘画",
        status: "submitted",
        statusLabelKey: "msSubmitted",
        color: "text-blue-400 bg-blue-400/10 border-blue-400/30",
        updated: "1小时前",
      },
      {
        name: "王五",
        role: "配音",
        status: "in_progress",
        statusLabelKey: "msInProgress",
        color: "text-amber-400 bg-amber-400/10 border-amber-400/30",
        updated: "3小时前",
      },
      {
        name: "赵六",
        role: "剪辑",
        status: "rejected",
        statusLabelKey: "msRejected",
        color: "text-red-400 bg-red-400/10 border-red-400/30",
        updated: "昨天",
      },
      {
        name: "小林",
        role: "角色设计",
        status: "approved",
        statusLabelKey: "msApproved",
        color: "text-green-400 bg-green-400/10 border-green-400/30",
        updated: "昨天",
      },
      {
        name: "阿杰",
        role: "场景设计",
        status: "approved",
        statusLabelKey: "msApproved",
        color: "text-green-400 bg-green-400/10 border-green-400/30",
        updated: "昨天",
      },
    ],
    activity: [
      { text: "张三提交了 EP3 剧本", time: "2小时前" },
      { text: "李四更新了绘画方案 v2", time: "1小时前" },
      { text: "赵六的剪辑稿被退回", time: "昨天" },
    ],
  },
  {
    ep: 4,
    label: "EP4",
    status: "not_started",
    statusLabelKey: "epNotStarted",
    summary: "暂无成员分配",
    members: 0,
    passed: 0,
    pending: 0,
    clientStatus: "未提交",
    clientStatusKey: "notSubmitted",
    membersList: [],
    activity: [],
  },
  {
    ep: 5,
    label: "EP5",
    status: "not_started",
    statusLabelKey: "epNotStarted",
    summary: "暂无成员分配",
    members: 0,
    passed: 0,
    pending: 0,
    clientStatus: "未提交",
    clientStatusKey: "notSubmitted",
    membersList: [],
    activity: [],
  },
];

export const DELIVERY_RECORDS: DeliveryRecord[] = [
  { ep: "第1集", date: "2026-02-10", statusKey: "deliveryConfirmed", ok: true },
  { ep: "第2集", date: "2026-03-01", statusKey: "deliveryRevising", ok: false },
];
