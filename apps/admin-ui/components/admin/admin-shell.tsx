"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  IconBook2,
  IconChevronRight,
  IconCoins,
  IconDatabase,
  IconDashboard,
  IconFileAnalytics,
  IconFlag,
  IconLogout,
  IconPhoto,
  IconReceipt2,
  IconShieldLock,
  IconStar,
  IconTags,
  IconUserCog,
  IconUsersGroup,
  IconVersions,
} from "@tabler/icons-react";
import { BrandLogo } from "@/components/admin/brand-logo";
import { Button } from "@/components/ui/button";
import { adminUiApiPath } from "@/lib/admin-api";
import { cn } from "@/lib/utils";
import type { AdminSession } from "@/lib/admin-session";

type NavItem = {
  href: string;
  label: string;
  icon: typeof IconDashboard;
  permission?: string;
};

const navSections: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "总览",
    items: [
      { href: "/", label: "运营总览", icon: IconDashboard },
      { href: "/ip/overview", label: "IP 总览", icon: IconVersions, permission: "ip.read" },
    ],
  },
  {
    label: "IP 内容",
    items: [
      { href: "/ip/titles", label: "标题库", icon: IconBook2, permission: "ip.read" },
      { href: "/ip/reviews", label: "审核队列", icon: IconShieldLock, permission: "ip.moderate" },
      { href: "/ip/reports", label: "举报处理", icon: IconFlag, permission: "ip.moderate" },
    ],
  },
  {
    label: "IP 配置",
    items: [
      { href: "/ip/taxonomy", label: "题材词库", icon: IconTags, permission: "ip.read" },
      { href: "/ip/discovery", label: "广场运营位", icon: IconStar, permission: "ip.read" },
    ],
  },
  {
    label: "IP 商业化",
    items: [
      { href: "/ip/commerce/orders", label: "IP 订单", icon: IconReceipt2, permission: "ip.read" },
      {
        href: "/ip/commerce/entitlements",
        label: "IP 权益",
        icon: IconCoins,
        permission: "ip.read",
      },
    ],
  },
  {
    label: "平台治理",
    items: [
      { href: "/billing", label: "订单积分", icon: IconCoins, permission: "billing.read" },
      { href: "/media", label: "媒体资产", icon: IconPhoto, permission: "media.read" },
      { href: "/users", label: "账号权限", icon: IconUsersGroup, permission: "admin.manage" },
      { href: "/audit", label: "系统审计", icon: IconFileAnalytics, permission: "audit.read" },
      { href: "/account", label: "我的账户", icon: IconUserCog },
    ],
  },
];

export function AdminShell({
  session,
  children,
}: {
  session: AdminSession;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const visibleNavSections = navSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) =>
        item.permission ? session.user.permissions.includes(item.permission) : true
      ),
    }))
    .filter((section) => section.items.length > 0);
  const visibleNavItems = visibleNavSections.flatMap((section) => section.items);
  const activeItem =
    visibleNavItems
      .filter((item) =>
        item.href === "/"
          ? pathname === "/"
          : pathname === item.href || pathname.startsWith(`${item.href}/`)
      )
      .sort((left, right) => right.href.length - left.href.length)[0] ?? visibleNavItems[0];

  const mobileNavItems = visibleNavItems.filter((item) =>
    item.permission ? session.user.permissions.includes(item.permission) : true
  );

  async function logout() {
    await fetch(adminUiApiPath("/api/admin/auth/logout"), { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="min-h-dvh bg-[#f6f7f9] text-slate-950">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[236px] border-r border-slate-200 bg-white/95 px-3 py-4 backdrop-blur md:block">
        <div className="flex h-full flex-col">
          <Link href="/" className="block px-2 pb-5 pt-1">
            <BrandLogo compact className="w-[142px]" />
            <span>
              <span className="mt-1 block text-[11px] font-medium text-slate-500">管理后台</span>
            </span>
          </Link>

          <nav className="space-y-4 overflow-y-auto pr-1">
            {visibleNavSections.map((section) => (
              <div key={section.label} className="space-y-1">
                <p className="px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                  {section.label}
                </p>
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const active =
                    item.href === "/"
                      ? pathname === "/"
                      : pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "group flex h-8 items-center gap-2 rounded-md px-2 text-[13px] font-medium text-slate-600 transition",
                        active
                          ? "bg-slate-950 text-white"
                          : "hover:bg-slate-100 hover:text-slate-950"
                      )}
                    >
                      <Icon className="size-4" />
                      <span className="flex-1">{item.label}</span>
                      {active ? <IconChevronRight className="size-3.5" /> : null}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="mt-auto border-t border-slate-200 pt-2">
            <div className="mb-1 flex items-center gap-1.5 px-1 text-[11px] text-slate-500">
              <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
              <span className="truncate font-medium text-slate-600">{session.site.label}</span>
              <span className="truncate text-slate-400">· {session.site.domain}</span>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/account"
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 transition hover:bg-slate-100"
              >
                <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-950 text-[11px] font-semibold text-white">
                  {session.user.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={session.user.avatarUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    session.user.displayName.slice(0, 1).toUpperCase()
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-medium text-slate-900">
                    {session.user.displayName}
                  </span>
                  <span className="block truncate text-[11px] text-slate-500">
                    {session.user.email}
                  </span>
                </span>
              </Link>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 text-slate-500 hover:text-slate-900"
                onClick={logout}
                title="退出登录"
                aria-label="退出登录"
              >
                <IconLogout className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </aside>

      <div className="md:pl-[236px]">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="flex h-12 items-center justify-between px-4">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[12px] font-medium text-slate-500">
                <IconDatabase className="size-3.5" />
                <span className="truncate">{session.site.databaseLabel}</span>
              </p>
              <h1 className="truncate text-sm font-semibold">
                {activeItem?.label ?? "管理工作台"}
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <span className="hidden rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600 sm:inline">
                {session.user.displayName}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-[12px] md:hidden"
                onClick={logout}
              >
                退出
              </Button>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto border-t border-slate-100 px-3 py-2 md:hidden">
            {mobileNavItems.map((item) => {
              const Icon = item.icon;
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium",
                    active ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600"
                  )}
                >
                  <Icon className="size-3.5" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </header>
        <main className="w-full px-4 py-5 lg:px-6">{children}</main>
      </div>
    </div>
  );
}
