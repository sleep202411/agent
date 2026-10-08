"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  IconChevronRight,
  IconDatabase,
  IconExternalLink,
  IconLogout,
  IconMenu2,
  IconX,
} from "@tabler/icons-react";
import { BrandLogo } from "@/components/admin/brand-logo";
import {
  activeModule,
  GLOBAL_NAV,
  MODULE_NAV,
  moduleLandingHref,
  moduleNavVisible,
  type GlobalNavEntry,
  type ModuleNavGroup,
} from "@/components/admin/nav-config";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { adminUiApiPath } from "@/lib/admin-api";
import { grantsAdminAccess } from "@/lib/admin-capability";
import { cn } from "@/lib/utils";
import type { AdminSession } from "@/lib/admin-session";

const GLOBAL_RAIL_WIDTH = "w-[60px]";

function hasPermission(session: AdminSession, permission?: string) {
  return grantsAdminAccess(session.user, permission);
}

export function AdminShell({
  session,
  children,
}: {
  session: AdminSession;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [avatarError, setAvatarError] = useState(false);

  // The mobile nav uses a Sheet whose portal overlay is NOT gated by md:hidden.
  // If the drawer is open and the viewport grows to desktop, that backdrop would
  // linger over the desktop UI — so force it closed once we cross the md breakpoint.
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 768px)");
    const closeOnDesktop = () => {
      if (mql.matches) setMobileNavOpen(false);
    };
    closeOnDesktop();
    mql.addEventListener("change", closeOnDesktop);
    return () => mql.removeEventListener("change", closeOnDesktop);
  }, []);

  const granted = (permission?: string) => hasPermission(session, permission);
  const visibleGlobalNav = GLOBAL_NAV.filter((entry) => moduleNavVisible(entry, granted));

  const currentModule = activeModule(pathname);
  const activeGlobalEntry =
    visibleGlobalNav.find((entry) => entry.key === currentModule) ?? visibleGlobalNav[0];

  const moduleGroups: ModuleNavGroup[] = (MODULE_NAV[currentModule] ?? [])
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => hasPermission(session, item.permission)),
    }))
    .filter((group) => group.items.length > 0);
  const hasModuleRail = moduleGroups.length > 0;

  const activeModuleItem = moduleGroups
    .flatMap((group) => group.items)
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((left, right) => right.href.length - left.href.length)[0];

  const headerTitle = activeModuleItem?.label ?? activeGlobalEntry?.label ?? "管理工作台";
  const peerAdmin =
    session.site.key === "cn"
      ? { href: "https://admin.fizzdragon.com", label: "Global admin" }
      : { href: "https://admin.fizzspace.cn", label: "China admin" };

  async function logout() {
    await fetch(adminUiApiPath("/api/admin/auth/logout"), { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  function isGlobalActive(entry: GlobalNavEntry) {
    return entry.key === currentModule;
  }

  function isModuleItemActive(href: string) {
    // Only the longest-matching item is active, so an index route (/crews) does
    // not stay lit on a sibling child route (/crews/positions).
    return activeModuleItem?.href === href;
  }

  // Combined desktop rail offset so the content area clears both rails.
  const contentOffset = hasModuleRail ? "md:pl-[268px]" : "md:pl-[60px]";

  return (
    <div className="min-h-dvh bg-[#f6f7f9] text-slate-950">
      {/* GLOBAL narrow rail (desktop) */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-slate-200 bg-white/95 px-1.5 py-3 backdrop-blur md:flex",
          GLOBAL_RAIL_WIDTH
        )}
      >
        <Link href="/" className="mb-3 flex items-center justify-center px-1" title="管理后台">
          <BrandLogo compact className="w-[40px]" />
        </Link>

        <TooltipProvider delayDuration={0}>
          <nav className="flex flex-1 flex-col items-center gap-1.5 overflow-y-auto">
            {visibleGlobalNav.map((entry) => {
              const Icon = entry.icon;
              const active = isGlobalActive(entry);
              return (
                <Tooltip key={entry.key}>
                  <TooltipTrigger asChild>
                    <Link
                      href={moduleLandingHref(entry, granted)}
                      aria-label={entry.label}
                      className={cn(
                        "flex size-10 items-center justify-center rounded-lg transition",
                        active
                          ? "bg-slate-950 text-white"
                          : "text-slate-500 hover:bg-slate-100 hover:text-slate-950"
                      )}
                    >
                      <Icon className="size-5" />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8}>
                    {entry.label}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </nav>
        </TooltipProvider>

        <div className="mt-auto flex flex-col items-center gap-1.5 border-t border-slate-200 pt-2">
          <span
            className="size-1.5 rounded-full bg-emerald-500"
            title={`${session.site.label} · ${session.site.domain}`}
          />
          <Link
            href="/account"
            className="flex size-8 items-center justify-center overflow-hidden rounded-full bg-slate-950 text-[11px] font-semibold text-white transition hover:opacity-90"
            title={`${session.user.displayName} · ${session.user.email}`}
          >
            {session.user.avatarUrl && !avatarError ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={session.user.avatarUrl}
                alt=""
                className="h-full w-full object-cover"
                onError={() => setAvatarError(true)}
              />
            ) : (
              session.user.displayName.slice(0, 1).toUpperCase()
            )}
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-slate-500 hover:text-slate-900"
            onClick={logout}
            title="退出登录"
            aria-label="退出登录"
          >
            <IconLogout className="size-4" />
          </Button>
        </div>
      </aside>

      {/* SECOND module rail (desktop) — only when the active module has secondary nav */}
      {hasModuleRail ? (
        <aside className="fixed inset-y-0 left-[60px] z-30 hidden w-[208px] flex-col border-r border-slate-200 bg-white/95 px-3 py-4 backdrop-blur md:flex">
          <p className="px-2 pb-3 text-sm font-semibold text-slate-900">
            {activeGlobalEntry?.label}
          </p>
          <nav className="space-y-4 overflow-y-auto pr-1">
            {moduleGroups.map((group) => (
              <div key={group.label} className="space-y-1">
                <p className="px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                  {group.label}
                </p>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = isModuleItemActive(item.href);
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
        </aside>
      ) : null}

      <div className={contentOffset}>
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="flex h-12 items-center justify-between px-4">
            <div className="flex min-w-0 items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-slate-600 md:hidden"
                onClick={() => setMobileNavOpen((open) => !open)}
                aria-label="切换导航"
              >
                {mobileNavOpen ? <IconX className="size-5" /> : <IconMenu2 className="size-5" />}
              </Button>
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-[12px] font-medium text-slate-500">
                  <IconDatabase className="size-3.5" />
                  <span className="truncate">{session.site.databaseLabel}</span>
                </p>
                <h1 className="truncate text-sm font-semibold">{headerTitle}</h1>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button asChild variant="outline" size="sm" className="h-8 text-[12px]">
                <a
                  href={peerAdmin.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`Open ${peerAdmin.label} in a new tab`}
                  aria-label={`Open ${peerAdmin.label} in a new tab`}
                >
                  <span className="hidden sm:inline">{peerAdmin.label}</span>
                  <IconExternalLink className="size-3.5" />
                </a>
              </Button>
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

          {/* Mobile module nav — horizontal scroll under the header */}
          {hasModuleRail ? (
            <nav className="flex gap-1 overflow-x-auto border-t border-slate-100 px-3 py-2 md:hidden">
              {moduleGroups
                .flatMap((group) => group.items)
                .map((item) => {
                  const Icon = item.icon;
                  const active = isModuleItemActive(item.href);
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
          ) : null}
        </header>

        {/* Mobile global nav drawer */}
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetContent
            side="left"
            className="w-[260px] max-w-[260px] gap-1 border-slate-200 bg-white px-3 py-4 md:hidden"
            showCloseButton={false}
          >
            <SheetTitle className="sr-only">导航</SheetTitle>
            <Link href="/" className="mb-3 block px-1" onClick={() => setMobileNavOpen(false)}>
              <BrandLogo compact className="w-[132px]" />
              <span className="mt-1 block text-[11px] font-medium text-slate-500">管理后台</span>
            </Link>
            {visibleGlobalNav.map((entry) => {
              const Icon = entry.icon;
              const active = isGlobalActive(entry);
              return (
                <Link
                  key={entry.key}
                  href={moduleLandingHref(entry, granted)}
                  onClick={() => setMobileNavOpen(false)}
                  className={cn(
                    "flex h-9 items-center gap-2 rounded-md px-2 text-[13px] font-medium transition",
                    active
                      ? "bg-slate-950 text-white"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                  )}
                >
                  <Icon className="size-4" />
                  <span className="flex-1">{entry.label}</span>
                  {active ? <IconChevronRight className="size-3.5" /> : null}
                </Link>
              );
            })}
            <div className="mt-auto border-t border-slate-200 pt-2 text-[11px] text-slate-500">
              <span className="block truncate font-medium text-slate-600">
                {session.user.displayName}
              </span>
              <span className="block truncate">
                {session.site.label} · {session.site.domain}
              </span>
            </div>
          </SheetContent>
        </Sheet>

        <main className="w-full px-4 py-5 lg:px-6">{children}</main>
      </div>
    </div>
  );
}
