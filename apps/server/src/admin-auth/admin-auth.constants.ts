export const ADMIN_SESSION_COOKIE = 'fd_admin_session';

export const ADMIN_PERMISSION_KEYS = {
  AdminManage: 'admin.manage',
  AuditRead: 'audit.read',
  NewsRead: 'news.read',
  NewsWrite: 'news.write',
  CoursesRead: 'courses.read',
  CoursesWrite: 'courses.write',
  IpRead: 'ip.read',
  IpPublish: 'ip.publish',
  IpModerate: 'ip.moderate',
  CreatorRevenueManage: 'creator.revenue.manage',
  CreatorWithdrawalsManage: 'creator.withdrawals.manage',
  BillingRead: 'billing.read',
  BillingWrite: 'billing.write',
  AiModelOpsRead: 'ai_model_ops.read',
  AiModelOpsWrite: 'ai_model_ops.write',
  WorkspaceRead: 'workspace.read',
  MediaRead: 'media.read',
  MediaWrite: 'media.write',
  AiActorsRead: 'ai_actors.read',
  AiActorsWrite: 'ai_actors.write',
  CertificateRead: 'certificate.read',
  CertificateManage: 'certificate.manage',
  UserRead: 'user.read',
  UserWrite: 'user.write',
  CrewManage: 'crew.manage',
  CrewComputeReview: 'crew.compute.review',
} as const;

export const ADMIN_ROLE_KEYS = {
  SuperAdmin: 'super_admin',
  Admin: 'admin',
  Operations: 'operations',
} as const;

export type AdminRoleKey =
  (typeof ADMIN_ROLE_KEYS)[keyof typeof ADMIN_ROLE_KEYS];

export const PROTECTED_ADMIN_ROLE_KEYS = [ADMIN_ROLE_KEYS.SuperAdmin] as const;

export const RETIRED_ADMIN_ROLE_KEYS = ['master_financial_controller'] as const;

export function isSystemAdminRoleKey(key: string): boolean {
  return (Object.values(ADMIN_ROLE_KEYS) as string[]).includes(key);
}

export function isProtectedAdminRoleKey(key: string): boolean {
  return (PROTECTED_ADMIN_ROLE_KEYS as readonly string[]).includes(key);
}

export const CUSTOM_ROLE_FORBIDDEN_PERMISSIONS = new Set<string>([
  ADMIN_PERMISSION_KEYS.AdminManage,
  ADMIN_PERMISSION_KEYS.CrewComputeReview,
]);

export const ADMIN_PERMISSION_CATALOG = [
  {
    key: ADMIN_PERMISSION_KEYS.CreatorRevenueManage,
    description: '上传剧组合同并分配已确认的创作者收益',
  },
  {
    key: ADMIN_PERMISSION_KEYS.CreatorWithdrawalsManage,
    description: '审核创作者银行卡并记录人工提现打款',
  },
  { key: ADMIN_PERMISSION_KEYS.NewsRead, description: '查看新闻和标签' },
  {
    key: ADMIN_PERMISSION_KEYS.NewsWrite,
    description: '创建、编辑、发布和删除新闻与标签',
  },
  { key: ADMIN_PERMISSION_KEYS.CoursesRead, description: '查看课程' },
  {
    key: ADMIN_PERMISSION_KEYS.CoursesWrite,
    description: '创建、编辑、发布、上传和删除课程',
  },
  {
    key: ADMIN_PERMISSION_KEYS.CrewComputeReview,
    description: '审批剧组算力额度',
  },
  {
    key: ADMIN_PERMISSION_KEYS.AdminManage,
    description: '管理后台账号、角色和权限',
  },
  {
    key: ADMIN_PERMISSION_KEYS.AuditRead,
    description: '查看后台操作审计日志',
  },
  {
    key: ADMIN_PERMISSION_KEYS.IpRead,
    description: '查看 IP 内容、审核队列和商业化配置',
  },
  {
    key: ADMIN_PERMISSION_KEYS.IpPublish,
    description: '审核、排期、上架、下架 IP 内容',
  },
  {
    key: ADMIN_PERMISSION_KEYS.IpModerate,
    description: '处理举报、屏蔽、恢复和风控处置',
  },
  {
    key: ADMIN_PERMISSION_KEYS.BillingRead,
    description: '查看订单、钱包、积分和订阅记录',
  },
  {
    key: ADMIN_PERMISSION_KEYS.BillingWrite,
    description: '处理账单、退款、补偿和人工调账',
  },
  {
    key: ADMIN_PERMISSION_KEYS.AiModelOpsRead,
    description: '查看 AI 模型、供应商路由、任务审计和成本追踪',
  },
  {
    key: ADMIN_PERMISSION_KEYS.AiModelOpsWrite,
    description: '配置 AI 模型、供应商绑定、套餐封装、同步和告警策略',
  },
  {
    key: ADMIN_PERMISSION_KEYS.WorkspaceRead,
    description: '查看工作区、项目和成员信息',
  },
  {
    key: ADMIN_PERMISSION_KEYS.MediaRead,
    description: '查看媒体资产和上传记录',
  },
  {
    key: ADMIN_PERMISSION_KEYS.MediaWrite,
    description: '处理媒体资产审核、下架、恢复和 CDN 清理任务',
  },
  {
    key: ADMIN_PERMISSION_KEYS.AiActorsRead,
    description: '查看 AI 演员资料与使用记录',
  },
  {
    key: ADMIN_PERMISSION_KEYS.AiActorsWrite,
    description: '创建、编辑和归档 AI 演员',
  },
  {
    key: ADMIN_PERMISSION_KEYS.CertificateRead,
    description: '查看用户证书记录',
  },
  {
    key: ADMIN_PERMISSION_KEYS.CertificateManage,
    description: '签发、修改、吊销和删除用户证书',
  },
  {
    key: ADMIN_PERMISSION_KEYS.UserRead,
    description: '查看终端用户资料、余额和积分流水',
  },
  {
    key: ADMIN_PERMISSION_KEYS.UserWrite,
    description: '给终端用户加 / 扣积分等人工运营操作',
  },
  {
    key: ADMIN_PERMISSION_KEYS.CrewManage,
    description: '管理剧组：转移 owner 等运营处置',
  },
] as const;

export const ADMIN_ROLE_CATALOG: Array<{
  key: AdminRoleKey;
  name: string;
  description: string;
  permissions: string[];
}> = [
  {
    key: ADMIN_ROLE_KEYS.SuperAdmin,
    name: '超级管理员',
    description: '拥有后台账号、安全策略、审计和所有运营权限',
    permissions: Object.values(ADMIN_PERMISSION_KEYS),
  },
  {
    key: ADMIN_ROLE_KEYS.Admin,
    name: '普通管理员',
    description: '拥有内容、账单、媒体和审计权限，不管理后台账号',
    permissions: [
      ADMIN_PERMISSION_KEYS.AuditRead,
      ADMIN_PERMISSION_KEYS.NewsRead,
      ADMIN_PERMISSION_KEYS.NewsWrite,
      ADMIN_PERMISSION_KEYS.CoursesRead,
      ADMIN_PERMISSION_KEYS.CoursesWrite,
      ADMIN_PERMISSION_KEYS.IpRead,
      ADMIN_PERMISSION_KEYS.IpPublish,
      ADMIN_PERMISSION_KEYS.IpModerate,
      ADMIN_PERMISSION_KEYS.BillingRead,
      ADMIN_PERMISSION_KEYS.BillingWrite,
      ADMIN_PERMISSION_KEYS.AiModelOpsRead,
      ADMIN_PERMISSION_KEYS.AiModelOpsWrite,
      ADMIN_PERMISSION_KEYS.WorkspaceRead,
      ADMIN_PERMISSION_KEYS.MediaRead,
      ADMIN_PERMISSION_KEYS.MediaWrite,
      ADMIN_PERMISSION_KEYS.AiActorsRead,
      ADMIN_PERMISSION_KEYS.AiActorsWrite,
      ADMIN_PERMISSION_KEYS.CertificateRead,
      ADMIN_PERMISSION_KEYS.CertificateManage,
      ADMIN_PERMISSION_KEYS.UserRead,
      ADMIN_PERMISSION_KEYS.UserWrite,
      ADMIN_PERMISSION_KEYS.CrewManage,
    ],
  },
  {
    key: ADMIN_ROLE_KEYS.Operations,
    name: '运营',
    description: '处理内容审核、媒体资产、工作区和订单查询',
    permissions: [
      ADMIN_PERMISSION_KEYS.NewsRead,
      ADMIN_PERMISSION_KEYS.NewsWrite,
      ADMIN_PERMISSION_KEYS.CoursesRead,
      ADMIN_PERMISSION_KEYS.CoursesWrite,
      ADMIN_PERMISSION_KEYS.IpRead,
      ADMIN_PERMISSION_KEYS.IpModerate,
      ADMIN_PERMISSION_KEYS.BillingRead,
      ADMIN_PERMISSION_KEYS.AiModelOpsRead,
      ADMIN_PERMISSION_KEYS.WorkspaceRead,
      ADMIN_PERMISSION_KEYS.MediaRead,
      ADMIN_PERMISSION_KEYS.MediaWrite,
      ADMIN_PERMISSION_KEYS.AiActorsRead,
      ADMIN_PERMISSION_KEYS.AiActorsWrite,
      ADMIN_PERMISSION_KEYS.CertificateRead,
      ADMIN_PERMISSION_KEYS.UserRead,
      ADMIN_PERMISSION_KEYS.CrewManage,
    ],
  },
];

export const ADMIN_SUPER_ROLE_KEY = ADMIN_ROLE_KEYS.SuperAdmin;
