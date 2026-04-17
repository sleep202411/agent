// ─── Types ───────────────────────────────────────────

export type MessageType =
  | "task_assigned"
  | "task_review"
  | "crew_invite"
  | "crew_accepted"
  | "checkpoint_approval"
  | "payment"
  | "system";

export interface WorkbenchMessage {
  id: string;
  type: MessageType;
  title: string;
  sender: string;
  summary: string;
  body: string;
  time: string;
  read: boolean;
  crewId?: string;
  crewName?: string;
  actionUrl?: string;
  actionLabelKey?: string;
}

// ─── Type config ─────────────────────────────────────

export const MESSAGE_TYPE_CONFIG: Record<
  MessageType,
  { labelKey: string; icon: string; color: string }
> = {
  task_assigned: {
    labelKey: "typeTaskAssigned",
    icon: "📋",
    color: "text-blue-400 bg-blue-400/10",
  },
  task_review: { labelKey: "typeTaskReview", icon: "👁", color: "text-amber-400 bg-amber-400/10" },
  crew_invite: { labelKey: "typeCrewInvite", icon: "🤝", color: "text-green-400 bg-green-400/10" },
  crew_accepted: {
    labelKey: "typeCrewAccepted",
    icon: "✅",
    color: "text-green-400 bg-green-400/10",
  },
  checkpoint_approval: {
    labelKey: "typeCheckpoint",
    icon: "🔔",
    color: "text-violet-400 bg-violet-400/10",
  },
  payment: { labelKey: "typePayment", icon: "💰", color: "text-amber-400 bg-amber-400/10" },
  system: { labelKey: "typeSystem", icon: "⚙️", color: "text-muted-foreground bg-secondary" },
};

export const MESSAGE_FILTERS = [
  { value: "all", labelKey: "filterAll" },
  { value: "unread", labelKey: "filterUnread" },
  { value: "task_assigned", labelKey: "typeTaskAssigned" },
  { value: "task_review", labelKey: "typeTaskReview" },
  { value: "crew_invite", labelKey: "typeCrewInvite" },
  { value: "checkpoint_approval", labelKey: "typeCheckpoint" },
  { value: "payment", labelKey: "typePayment" },
] as const;

// ─── Mock data ───────────────────────────────────────

export const MOCK_MESSAGES: WorkbenchMessage[] = [
  {
    id: "m1",
    type: "task_assigned",
    title: "新任务：角色精修全套图",
    sender: "影子制片",
    summary: "赛博山海经预告片组分配了新任务给你，截止3月30日",
    body: "你好，赛博山海经预告片组有一个新任务需要你完成：\n\n**角色精修全套图**\n- 截止日期：3月30日\n- 交付物：10套精修角色图 + Prompt 包\n- 预算：¥2000-4000\n\n请尽快开始制作，如有问题请联系制片人。",
    time: "10分钟前",
    read: false,
    crewId: "s1",
    crewName: "赛博山海经预告片组",
    actionUrl: "/crews/s1/workspace",
    actionLabelKey: "actionGoToWorkspace",
  },
  {
    id: "m2",
    type: "task_review",
    title: "分镜草稿 Act 1 待审核",
    sender: "夜色导演",
    summary: "你提交的分镜草稿已进入审核流程",
    body: "你提交的「分镜草稿 Act 1」已进入审核流程。\n\n制片人将在24小时内完成审核，请留意后续通知。如需修改，请在审核完成前更新提交。",
    time: "1小时前",
    read: false,
    crewId: "s1",
    crewName: "赛博山海经预告片组",
  },
  {
    id: "m3",
    type: "crew_invite",
    title: "邀请你加入「虚空传说」剧组",
    sender: "虚空制作",
    summary: "虚空制作邀请你担任AI画师，项目预算¥8k-20k",
    body: "**虚空制作** 邀请你加入「虚空传说10集动画」剧组：\n\n- 职位：AI画师\n- 预算：¥2000-4000/集\n- 周期：3周\n- 项目描述：10集AI动画，横跨十个平行宇宙的奇幻史诗\n\n请在7天内回复此邀请。",
    time: "3小时前",
    read: false,
    crewId: "s4",
    crewName: "虚空传说10集动画",
    actionUrl: "/crews/s4",
    actionLabelKey: "actionViewCrew",
  },
  {
    id: "m4",
    type: "checkpoint_approval",
    title: "检查点通过：角色设计阶段",
    sender: "系统通知",
    summary: "赛博山海经预告片组的角色设计阶段已通过审核",
    body: "恭喜！赛博山海经预告片组的「角色设计」阶段已通过制片人审核。\n\n- 阶段：角色设计\n- 审核人：影子制片\n- 结果：✅ 通过\n\n项目已进入下一阶段：分镜制作。相关任务将自动分配。",
    time: "昨天",
    read: true,
    crewId: "s1",
    crewName: "赛博山海经预告片组",
  },
  {
    id: "m5",
    type: "payment",
    title: "任务报酬已释放：¥1,500",
    sender: "系统通知",
    summary: "角色设计阶段检查点通过，70%报酬已释放到你的钱包",
    body: "你在「赛博山海经预告片组」的角色设计任务报酬已释放：\n\n- 金额：¥1,500（阶段通过释放70%）\n- 剩余：¥643（精剪通过后释放）\n- 状态：已到账\n\n你可以在钱包中查看详情。",
    time: "昨天",
    read: true,
    actionUrl: "/wallet",
    actionLabelKey: "actionViewWallet",
  },
  {
    id: "m6",
    type: "crew_accepted",
    title: "你已加入「深港品牌宣传片组」",
    sender: "浪潮导演",
    summary: "你的申请已通过，现在可以进入工作台开始协作",
    body: "你的加入申请已通过！\n\n- 剧组：深港品牌宣传片组\n- 职位：后期剪辑\n- 当前阶段：视频生成\n\n你现在可以进入工作台查看任务和项目资料。",
    time: "2天前",
    read: true,
    crewId: "s2",
    crewName: "深港品牌宣传片组",
    actionUrl: "/crews/s2/workspace",
    actionLabelKey: "actionGoToWorkspace",
  },
  {
    id: "m7",
    type: "system",
    title: "平台更新：交互视频编辑器上线",
    sender: "FizzDragon",
    summary: "全新交互视频编辑器已上线，支持分支剧情创作",
    body: "FizzDragon 平台新功能上线！\n\n**交互视频编辑器**\n- 节点式编辑器，可视化管理分支剧情\n- 支持多结局设计\n- 每个节点可独立上传视频片段\n\n立即前往 IP 管理页面体验。",
    time: "3天前",
    read: true,
  },
];
