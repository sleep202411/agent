"use client";

import { Link } from "@/i18n/navigation";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import {
  IconArrowLeft,
  IconChartBar,
  IconChevronDown,
  IconCreditCard,
  IconLayoutGrid,
  IconSettings,
  IconUsers,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/app/_components/auth-provider";
import { useWorkspace } from "@/app/_components/workspace-context";
import type { WorkspaceRef } from "@/lib/collab/projects-api";
import { LetterAvatar } from "./settings-ui";

/**
 * Standalone Settings navigation. Layout/IA modeled on imagine.art's
 * /settings/team (Profile → Account; Teams Settings → per-workspace nav), but
 * dark/monochrome/borderless per DESIGN.md. Model Settings is intentionally
 * omitted. The active workspace (shared WorkspaceProvider) drives which team
 * the Overview / Members / Analytics / Billing sub-pages operate on.
 */

function teamSubNav(isPersonal: boolean) {
  return [
    { href: "/settings/overview", labelKey: "navOverview" as const, Icon: IconLayoutGrid },
    ...(isPersonal
      ? []
      : [{ href: "/settings/members", labelKey: "navMembers" as const, Icon: IconUsers }]),
    { href: "/settings/analytics", labelKey: "navAnalytics" as const, Icon: IconChartBar },
    { href: "/settings/billing", labelKey: "navBilling" as const, Icon: IconCreditCard },
  ];
}

export function SettingsSidebar() {
  const t = useTranslations("settings");
  const pathname = usePathname();
  const router = useRouter();
  const { workspaces, activeWorkspace, setActiveWorkspaceId } = useWorkspace();
  const { user } = useAuth();

  const accountName = user?.nickName || user?.email || user?.phone || t("account");

  const selectWorkspace = (ws: WorkspaceRef) => {
    setActiveWorkspaceId(ws.id);
    router.push("/settings/overview");
  };

  return (
    <aside className="flex w-64 shrink-0 flex-col bg-card px-3 py-5">
      <Link
        href="/canvas"
        className="inline-flex items-center gap-1.5 px-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <IconArrowLeft className="size-4" />
        {t("goBack")}
      </Link>

      <div className="mt-4 flex items-center gap-2 px-2">
        <IconSettings className="size-5" stroke={1.8} />
        <h1 className="text-lg font-semibold">{t("settings")}</h1>
      </div>

      <nav className="mt-5 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
        <Group title={t("groupProfile")}>
          <NavLink
            href="/settings/account"
            active={pathname === "/settings/account"}
            leading={<LetterAvatar name={accountName} size="size-6" />}
          >
            {t("account")}
          </NavLink>
        </Group>

        <Group title={t("groupTeamsSettings")}>
          {workspaces.map((ws) => {
            const isActive = activeWorkspace?.id === ws.id;
            const subNav = teamSubNav(ws.type === "personal");
            return (
              <div key={ws.id} className="flex flex-col">
                <button
                  type="button"
                  onClick={() => (isActive ? undefined : selectWorkspace(ws))}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
                    isActive ? "bg-secondary" : "hover:bg-accent"
                  )}
                >
                  <LetterAvatar name={ws.name} src={ws.avatarUrl} size="size-6" />
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="truncate font-medium">{ws.name}</span>
                    {ws.role && (
                      <span className="truncate text-xs text-muted-foreground">
                        {t(`role.${ws.role}`)}
                      </span>
                    )}
                  </span>
                  <IconChevronDown
                    className={cn(
                      "size-4 shrink-0 text-muted-foreground transition-transform",
                      isActive ? "" : "-rotate-90"
                    )}
                  />
                </button>

                {isActive && (
                  <div className="mt-1 ml-3 flex flex-col gap-0.5 pl-3">
                    {subNav.map(({ href, labelKey, Icon }) => (
                      <NavLink
                        key={href}
                        href={href}
                        active={pathname === href}
                        leading={<Icon className="size-4" stroke={1.8} />}
                      >
                        {t(labelKey)}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </Group>
      </nav>
    </aside>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </span>
      {children}
    </div>
  );
}

function NavLink({
  href,
  active,
  leading,
  children,
}: {
  href: string;
  active: boolean;
  leading?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
        active
          ? "bg-secondary text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      {leading}
      {children}
    </Link>
  );
}
