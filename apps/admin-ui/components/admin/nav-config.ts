import {
  IconActivity,
  IconBook2,
  IconSchool,
  IconCertificate,
  IconChecklist,
  IconCloud,
  IconCoins,
  IconCreditCard,
  IconDashboard,
  IconDatabaseSearch,
  IconDeviceDesktop,
  IconDeviceGamepad2,
  IconDeviceMobile,
  IconFileAnalytics,
  IconFileSettings,
  IconFlag,
  IconBriefcase,
  IconBuildingStore,
  IconLayoutCards,
  IconMasksTheater,
  IconNews,
  IconPackage,
  IconPhoto,
  IconPlugConnected,
  IconReceipt2,
  IconReceiptRefund,
  IconReportMoney,
  IconFolders,
  IconRobot,
  IconScale,
  IconShieldLock,
  IconCalendarCheck,
  IconConfetti,
  IconGift,
  IconSettingsAutomation,
  IconTags,
  IconTicket,
  IconTrendingUp,
  IconUserCog,
  IconUserPlus,
  IconUsersGroup,
  IconUserSearch,
  IconBadge,
  IconVersions,
  IconWallet,
  IconWriting,
} from "@tabler/icons-react";

export type NavIcon = typeof IconDashboard;

export type GlobalNavEntry = {
  /** Stable key matching the module prefix (used by `activeModule`). */
  key: string;
  href: string;
  label: string;
  icon: NavIcon;
  permission?: string;
};

export type ModuleNavItem = {
  href: string;
  label: string;
  icon: NavIcon;
  permission?: string;
};

export type ModuleNavGroup = {
  label: string;
  items: ModuleNavItem[];
};

/**
 * GLOBAL left rail — flat top-level modules with visible labels.
 * `/` (运营总览) and `/account` (我的账户) are ungated; the rest are permission-gated.
 * The `key` doubles as the module prefix used by `activeModule`.
 */
export const GLOBAL_NAV: GlobalNavEntry[] = [
  { key: "/", href: "/", label: "运营总览", icon: IconDashboard },
  { key: "/ip", href: "/ip", label: "IP管理", icon: IconVersions, permission: "ip.read" },
  {
    key: "/billing",
    href: "/billing",
    label: "计费财务",
    icon: IconCoins,
    permission: "billing.read",
  },
  {
    key: "/growth",
    href: "/growth",
    label: "增长运营",
    icon: IconTrendingUp,
    permission: "billing.read",
  },
  {
    key: "/ai-model-ops",
    href: "/ai-model-ops",
    label: "模型运营",
    icon: IconPlugConnected,
    permission: "ai_model_ops.read",
  },
  {
    key: "/ai-actors",
    href: "/ai-actors",
    label: "AI演员",
    icon: IconMasksTheater,
    permission: "ai_actors.read",
  },
  {
    key: "/media",
    href: "/media",
    label: "媒体资产",
    icon: IconPhoto,
    permission: "media.read",
  },
  { key: "/news", href: "/news", label: "新闻资讯", icon: IconNews, permission: "news.read" },
  {
    key: "/courses",
    href: "/courses",
    label: "课程管理",
    icon: IconBook2,
    permission: "courses.read",
  },
  {
    key: "/certificates",
    href: "/certificates",
    label: "证书管理",
    icon: IconCertificate,
    permission: "certificate.read",
  },
  {
    key: "/members",
    href: "/members",
    label: "用户管理",
    icon: IconUserSearch,
    permission: "user.read",
  },
  {
    key: "/crews",
    href: "/crews",
    label: "剧组管理",
    icon: IconMasksTheater,
    permission: "crew.manage",
  },
  {
    key: "/users",
    href: "/users",
    label: "账号权限",
    icon: IconUsersGroup,
    permission: "admin.manage",
  },
  {
    key: "/releases",
    href: "/releases",
    label: "应用发布",
    icon: IconDeviceMobile,
    permission: "admin.manage",
  },
  {
    key: "/audit",
    href: "/audit",
    label: "系统审计",
    icon: IconFileAnalytics,
    permission: "audit.read",
  },
  { key: "/account", href: "/account", label: "我的账户", icon: IconUserCog },
];

/**
 * Secondary (module) nav, keyed by module prefix.
 *
 * Only modules that have multi-page secondary nav appear here; a module that is
 * absent renders NO second rail (dashboard `/`, audit, account).
 *
 * P2 decision — `/billing`: now a multi-page sub-app with a second rail. The
 * `/billing` index redirects to `/billing/catalog`; the overview metrics are
 * folded into the catalog group, so there is no standalone overview page.
 */
export const MODULE_NAV: Record<string, ModuleNavGroup[]> = {
  "/courses": [
    {
      label: "课程运营",
      items: [
        {
          href: "/courses",
          label: "课程列表",
          icon: IconBook2,
          permission: "courses.read",
        },
        {
          href: "/courses/mine",
          label: "我的课程",
          icon: IconSchool,
          permission: "courses.read",
        },
        {
          href: "/courses/homework",
          label: "作业审核",
          icon: IconChecklist,
          permission: "courses.read",
        },
        {
          href: "/courses/income",
          label: "授课收入",
          icon: IconReportMoney,
          permission: "courses.read",
        },
      ],
    },
  ],
  "/billing": [
    {
      label: "商品计划",
      items: [
        {
          href: "/billing/catalog",
          label: "套餐商品",
          icon: IconPackage,
          permission: "billing.read",
        },
        {
          href: "/billing/memberships",
          label: "会员计划",
          icon: IconUsersGroup,
          permission: "billing.read",
        },
      ],
    },
    {
      label: "算力钱包",
      items: [
        {
          href: "/billing/workspace-wallet",
          label: "工作区积分",
          icon: IconWallet,
          permission: "billing.read",
        },
        {
          href: "/billing/usage",
          label: "成员消耗",
          icon: IconReportMoney,
          permission: "billing.read",
        },
        {
          href: "/billing/project-usage",
          label: "项目消耗",
          icon: IconFolders,
          permission: "billing.read",
        },
      ],
    },
    {
      label: "交易履约",
      items: [
        { href: "/billing/orders", label: "订单", icon: IconReceipt2, permission: "billing.read" },
        {
          href: "/billing/events",
          label: "支付事件",
          icon: IconActivity,
          permission: "billing.read",
        },
        {
          href: "/billing/refunds",
          label: "退款",
          icon: IconReceiptRefund,
          permission: "billing.read",
        },
      ],
    },
    {
      label: "财务账本",
      items: [
        { href: "/billing/ledger", label: "会计分录", icon: IconBook2, permission: "billing.read" },
        {
          href: "/billing/settlements",
          label: "结算批次",
          icon: IconScale,
          permission: "billing.read",
        },
        {
          href: "/billing/reconciliation",
          label: "对账任务",
          icon: IconChecklist,
          permission: "billing.read",
        },
      ],
    },
    {
      label: "支付配置",
      items: [
        {
          href: "/billing/providers",
          label: "支付方式",
          icon: IconCreditCard,
          permission: "billing.read",
        },
        {
          href: "/billing/bindings",
          label: "渠道绑定",
          icon: IconPlugConnected,
          permission: "billing.read",
        },
      ],
    },
  ],
  "/growth": [
    {
      label: "营销活动",
      items: [
        {
          href: "/growth/promotions",
          label: "促销优惠",
          icon: IconTicket,
          permission: "billing.read",
        },
        {
          href: "/growth/vouchers",
          label: "兑换券",
          icon: IconGift,
          permission: "billing.read",
        },
        {
          href: "/growth/campaigns",
          label: "免费活动",
          icon: IconConfetti,
          permission: "billing.read",
        },
      ],
    },
    {
      label: "用户增长",
      items: [
        {
          href: "/growth/check-in",
          label: "每日签到",
          icon: IconCalendarCheck,
          permission: "billing.read",
        },
        {
          href: "/growth/referrals",
          label: "邀请奖励",
          icon: IconUserPlus,
          permission: "billing.read",
        },
      ],
    },
  ],
  "/ip": [
    {
      label: "内容",
      items: [
        { href: "/ip/overview", label: "总览", icon: IconVersions, permission: "ip.read" },
        { href: "/ip/titles", label: "作品库", icon: IconBook2, permission: "ip.read" },
        { href: "/ip/reviews", label: "审核队列", icon: IconShieldLock, permission: "ip.moderate" },
        {
          href: "/ip/text-games",
          label: "文游审核",
          icon: IconWriting,
          permission: "ip.moderate",
        },
        {
          href: "/ip/interactive-films",
          label: "影游审核",
          icon: IconDeviceGamepad2,
          permission: "ip.moderate",
        },
        { href: "/ip/reports", label: "举报处理", icon: IconFlag, permission: "ip.moderate" },
      ],
    },
    {
      label: "配置",
      items: [
        { href: "/ip/taxonomy", label: "题材词库", icon: IconTags, permission: "ip.read" },
        {
          href: "/ip/publishers",
          label: "发行商库",
          icon: IconBuildingStore,
          permission: "ip.read",
        },
        {
          href: "/ip/discovery",
          label: "广场运营位",
          icon: IconLayoutCards,
          permission: "ip.read",
        },
      ],
    },
    {
      label: "商业化",
      items: [
        { href: "/ip/commerce/orders", label: "IP订单", icon: IconReceipt2, permission: "ip.read" },
        {
          href: "/ip/commerce/entitlements",
          label: "IP权益",
          icon: IconCoins,
          permission: "ip.read",
        },
        {
          href: "/ip/commerce/revenue",
          label: "创作者收益",
          icon: IconReportMoney,
          permission: "ip.read",
        },
      ],
    },
  ],
  "/ai-model-ops": [
    {
      label: "运行态",
      items: [
        {
          href: "/ai-model-ops/overview",
          label: "总览",
          icon: IconDashboard,
          permission: "ai_model_ops.read",
        },
        {
          href: "/ai-model-ops/jobs",
          label: "请求任务",
          icon: IconFileAnalytics,
          permission: "ai_model_ops.read",
        },
        {
          href: "/ai-model-ops/assets",
          label: "生成资产",
          icon: IconPhoto,
          permission: "ai_model_ops.read",
        },
        {
          href: "/ai-model-ops/agent-users",
          label: "Agent用户",
          icon: IconRobot,
          permission: "ai_model_ops.read",
        },
      ],
    },
    {
      label: "供应商路由",
      items: [
        {
          href: "/ai-model-ops/providers",
          label: "供应商账号",
          icon: IconPlugConnected,
          permission: "ai_model_ops.read",
        },
        {
          href: "/ai-model-ops/endpoints",
          label: "供应商端点",
          icon: IconDatabaseSearch,
          permission: "ai_model_ops.read",
        },
        {
          href: "/ai-model-ops/models",
          label: "统一模型",
          icon: IconDatabaseSearch,
          permission: "ai_model_ops.read",
        },
      ],
    },
  ],
  "/media": [
    {
      label: "媒体治理",
      items: [
        {
          href: "/media/overview",
          label: "总览",
          icon: IconDashboard,
          permission: "media.read",
        },
        {
          href: "/media/assets",
          label: "资产索引",
          icon: IconPhoto,
          permission: "media.read",
        },
        {
          href: "/media/moderation",
          label: "审核 / CDN",
          icon: IconCloud,
          permission: "media.read",
        },
        {
          href: "/media/processing",
          label: "处理任务",
          icon: IconSettingsAutomation,
          permission: "media.read",
        },
      ],
    },
  ],
  "/members": [
    {
      label: "用户运营",
      items: [
        {
          href: "/members/directory",
          label: "用户列表",
          icon: IconUserSearch,
          permission: "user.read",
        },
        {
          href: "/members/user-levels",
          label: "认证等级",
          icon: IconBadge,
          permission: "user.read",
        },
        {
          href: "/members/user-level-applications",
          label: "等级申请",
          icon: IconChecklist,
          permission: "user.read",
        },
      ],
    },
  ],
  "/crews": [
    {
      label: "剧组运营",
      items: [
        {
          href: "/crews",
          label: "剧组审核",
          icon: IconShieldLock,
          permission: "crew.manage",
        },
        {
          href: "/crews/positions",
          label: "岗位管理",
          icon: IconBriefcase,
          permission: "crew.manage",
        },
        {
          href: "/crews/disputes",
          label: "争议处理",
          icon: IconChecklist,
          permission: "crew.manage",
        },
        {
          href: "/crews/expenses",
          label: "报销审核",
          icon: IconChecklist,
          permission: "crew.manage",
        },
        {
          href: "/crews/delivery-catalog",
          label: "交付标准",
          icon: IconChecklist,
          permission: "crew.manage",
        },
        {
          href: "/crews/task-requests",
          label: "Task requests",
          icon: IconChecklist,
          permission: "crew.compute.review",
        },
        {
          href: "/crews/compute-requests",
          label: "算力申请",
          icon: IconChecklist,
          permission: "crew.compute.review",
        },
        {
          href: "/crews/task-templates",
          label: "任务模板",
          icon: IconFileSettings,
          permission: "crew.manage",
        },
      ],
    },
    {
      label: "收益结算",
      items: [
        {
          href: "/revenue",
          label: "剧组收益",
          icon: IconReportMoney,
          permission: "creator.revenue.manage",
        },
        {
          href: "/task-payments",
          label: "任务付款",
          icon: IconWallet,
          permission: "creator.revenue.manage",
        },
        {
          href: "/withdrawals",
          label: "提现审核",
          icon: IconWallet,
          permission: "creator.withdrawals.manage",
        },
      ],
    },
  ],
  "/users": [
    {
      label: "账号权限",
      items: [
        {
          href: "/users/accounts",
          label: "账号",
          icon: IconUsersGroup,
          permission: "admin.manage",
        },
        {
          href: "/users/roles",
          label: "角色权限",
          icon: IconShieldLock,
          permission: "admin.manage",
        },
        {
          href: "/users/sessions",
          label: "会话",
          icon: IconDeviceDesktop,
          permission: "admin.manage",
        },
      ],
    },
  ],
};

export type AdminDirectoryPage = {
  id: string;
  label: string;
  permission?: string;
};

export type AdminDirectoryGroup = {
  id: string;
  label: string;
  pages: AdminDirectoryPage[];
};

export type AdminDirectoryModule = {
  id: string;
  label: string;
  permission?: string;
  groups: AdminDirectoryGroup[];
};

/** Live admin directories: left rail + second rail, used by the role permission tree. */
export function listAdminDirectoryModules(): AdminDirectoryModule[] {
  return GLOBAL_NAV.filter((entry) => entry.key !== "/" && entry.key !== "/account").map(
    (entry) => ({
      id: entry.key,
      label: entry.label,
      permission: entry.permission,
      groups: (MODULE_NAV[entry.key] ?? []).map((group) => ({
        id: `${entry.key}:${group.label}`,
        label: group.label,
        pages: group.items.map((item) => ({
          id: item.href,
          label: item.label,
          permission: item.permission,
        })),
      })),
    })
  );
}

const MODULE_PREFIXES = GLOBAL_NAV.map((entry) => entry.key).filter((key) => key !== "/");

/** Nested pages that keep their own URL but belong to another left-rail module. */
const MODULE_PATH_ALIASES: Record<string, string> = {
  "/withdrawals": "/crews",
  "/task-payments": "/crews",
  "/revenue": "/crews",
};

function hasNavPermission(granted: (permission?: string) => boolean, permission?: string) {
  return permission ? granted(permission) : true;
}

export function moduleNavVisible(entry: GlobalNavEntry, granted: (permission?: string) => boolean) {
  if (hasNavPermission(granted, entry.permission)) return true;
  return (MODULE_NAV[entry.key] ?? [])
    .flatMap((group) => group.items)
    .some((item) => hasNavPermission(granted, item.permission));
}

export function moduleLandingHref(
  entry: GlobalNavEntry,
  granted: (permission?: string) => boolean
) {
  const first = (MODULE_NAV[entry.key] ?? [])
    .flatMap((group) => group.items)
    .find((item) => hasNavPermission(granted, item.permission));
  return first?.href ?? entry.href;
}

/**
 * Shared longest-prefix module resolver used by every rail + the header so they
 * agree on a single source of truth.
 *
 * - `/` is special-cased: it only matches the dashboard exactly.
 * - Every other prefix matches itself and its descendants (e.g. `/ip` matches
 *   `/ip`, `/ip/overview`, `/ip/commerce/orders`).
 * - Longest matching prefix wins so `/ip/commerce/...` resolves to `/ip`.
 */
export function activeModule(pathname: string): string {
  if (pathname === "/") {
    return "/";
  }
  const aliased =
    MODULE_PATH_ALIASES[pathname] ??
    Object.entries(MODULE_PATH_ALIASES).find(([prefix]) => pathname.startsWith(`${prefix}/`))?.[1];
  if (aliased) return aliased;
  const match = MODULE_PREFIXES.filter(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  ).sort((left, right) => right.length - left.length)[0];
  return match ?? "/";
}
