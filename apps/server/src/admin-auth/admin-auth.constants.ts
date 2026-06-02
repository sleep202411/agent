export const ADMIN_SESSION_COOKIE = 'fd_admin_session';

export const ADMIN_PERMISSION_KEYS = {
  AdminManage: 'admin.manage',
  AuditRead: 'audit.read',
  IpRead: 'ip.read',
  IpPublish: 'ip.publish',
  IpModerate: 'ip.moderate',
  BillingRead: 'billing.read',
  BillingWrite: 'billing.write',
  WorkspaceRead: 'workspace.read',
  MediaRead: 'media.read',
  CertificateRead: 'certificate.read',
  CertificateManage: 'certificate.manage',
} as const;

export const ADMIN_ROLE_KEYS = {
  SuperAdmin: 'super_admin',
  Admin: 'admin',
  Operations: 'operations',
} as const;

export type AdminRoleKey =
  (typeof ADMIN_ROLE_KEYS)[keyof typeof ADMIN_ROLE_KEYS];

export const ADMIN_PERMISSION_CATALOG = [
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
    key: ADMIN_PERMISSION_KEYS.WorkspaceRead,
    description: '查看工作区、项目和成员信息',
  },
  {
    key: ADMIN_PERMISSION_KEYS.MediaRead,
    description: '查看媒体资产和上传记录',
  },
  {
    key: ADMIN_PERMISSION_KEYS.CertificateRead,
    description: '查看用户证书记录',
  },
  {
    key: ADMIN_PERMISSION_KEYS.CertificateManage,
    description: '签发、修改、吊销和删除用户证书',
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
      ADMIN_PERMISSION_KEYS.IpRead,
      ADMIN_PERMISSION_KEYS.IpPublish,
      ADMIN_PERMISSION_KEYS.IpModerate,
      ADMIN_PERMISSION_KEYS.BillingRead,
      ADMIN_PERMISSION_KEYS.BillingWrite,
      ADMIN_PERMISSION_KEYS.WorkspaceRead,
      ADMIN_PERMISSION_KEYS.MediaRead,
      ADMIN_PERMISSION_KEYS.CertificateRead,
      ADMIN_PERMISSION_KEYS.CertificateManage,
    ],
  },
  {
    key: ADMIN_ROLE_KEYS.Operations,
    name: '运营',
    description: '处理内容审核、媒体资产、工作区和订单查询',
    permissions: [
      ADMIN_PERMISSION_KEYS.IpRead,
      ADMIN_PERMISSION_KEYS.IpModerate,
      ADMIN_PERMISSION_KEYS.BillingRead,
      ADMIN_PERMISSION_KEYS.WorkspaceRead,
      ADMIN_PERMISSION_KEYS.MediaRead,
      ADMIN_PERMISSION_KEYS.CertificateRead,
    ],
  },
];

export const ADMIN_SUPER_ROLE_KEY = ADMIN_ROLE_KEYS.SuperAdmin;
