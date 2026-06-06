import {
  IconActivity,
  IconBook2,
  IconCertificate,
  IconChecklist,
  IconCoins,
  IconCreditCard,
  IconDashboard,
  IconDatabaseSearch,
  IconDeviceDesktop,
  IconFileAnalytics,
  IconFlag,
  IconLayoutCards,
  IconPackage,
  IconPlugConnected,
  IconReceipt2,
  IconReceiptRefund,
  IconReportMoney,
  IconScale,
  IconShieldLock,
  IconTags,
  IconTicket,
  IconUserCog,
  IconUsersGroup,
  IconVersions,
  IconWallet,
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
 * GLOBAL narrow left rail — flat top-level modules.
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
    key: "/ai-model-ops",
    href: "/ai-model-ops",
    label: "模型运营",
    icon: IconPlugConnected,
    permission: "ai_model_ops.read",
  },
  // 媒体资产 (/media) is hidden from nav until the module is built — the page is
  // still a ModulePlaceholder, so we don't surface it as a top-level module yet.
  {
    key: "/certificates",
    href: "/certificates",
    label: "证书管理",
    icon: IconCertificate,
    permission: "certificate.read",
  },
  {
    key: "/users",
    href: "/users",
    label: "账号权限",
    icon: IconUsersGroup,
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
 * absent renders NO second rail (dashboard `/`, media, users, audit, account).
 *
 * P2 decision — `/billing`: now a multi-page sub-app with a second rail. The
 * `/billing` index redirects to `/billing/catalog`; the overview metrics are
 * folded into the catalog group, so there is no standalone overview page.
 */
export const MODULE_NAV: Record<string, ModuleNavGroup[]> = {
  "/billing": [
    {
      label: "商品促销",
      items: [
        {
          href: "/billing/catalog",
          label: "套餐商品",
          icon: IconPackage,
          permission: "billing.read",
        },
        {
          href: "/billing/promotions",
          label: "促销优惠",
          icon: IconTicket,
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
      label: "钱包账户",
      items: [
        {
          href: "/billing/wallets",
          label: "用户钱包",
          icon: IconWallet,
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
  "/ip": [
    {
      label: "内容",
      items: [
        { href: "/ip/overview", label: "总览", icon: IconVersions, permission: "ip.read" },
        { href: "/ip/titles", label: "作品库", icon: IconBook2, permission: "ip.read" },
        { href: "/ip/reviews", label: "审核队列", icon: IconShieldLock, permission: "ip.moderate" },
        { href: "/ip/reports", label: "举报处理", icon: IconFlag, permission: "ip.moderate" },
      ],
    },
    {
      label: "配置",
      items: [
        { href: "/ip/taxonomy", label: "题材词库", icon: IconTags, permission: "ip.read" },
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

const MODULE_PREFIXES = GLOBAL_NAV.map((entry) => entry.key).filter((key) => key !== "/");

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
  const match = MODULE_PREFIXES.filter(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  ).sort((left, right) => right.length - left.length)[0];
  return match ?? "/";
}
