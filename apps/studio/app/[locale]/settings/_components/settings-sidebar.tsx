"use client";

import { Link } from "@/i18n/navigation";
import { usePathname } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import {
  IconArrowLeft,
  IconChartBar,
  IconCreditCard,
  IconGauge,
  IconLayoutGrid,
  IconSettings,
  IconUsers,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/app/_components/auth-provider";
import { useWorkspace } from "@/app/_components/workspace-context";
import { LetterAvatar } from "./settings-ui";

/**
 * Standalone Settings navigation. Layout/IA modeled on imagine.art's
 * /settings/team (Profile → Account; Teams Settings → per-workspace nav), but
 * dark/monochrome/borderless per DESIGN.md. Model Settings is intentionally
 * omitted. The active workspace (shared WorkspaceProvider) drives which team
 * the Overview / Members / Analytics / Billing sub-pages operate on.
 */

/**
 * Same nav for every workspace type: personal workspaces hold members too, and
 * how many is the server's seat policy to answer, not this list's.
 */
const TEAM_SUB_NAV = [
  { href: "/settings/overview", labelKey: "navOverview", Icon: IconLayoutGrid },
  { href: "/settings/members", labelKey: "navMembers", Icon: IconUsers },
  { href: "/settings/usage", labelKey: "navUsage", Icon: IconGauge },
  { href: "/settings/analytics", labelKey: "navAnalytics", Icon: IconChartBar },
  { href: "/settings/billing", labelKey: "navBilling", Icon: IconCreditCard },
] as const;

export function SettingsSidebar() {
  const t = useTranslations("settings");
  const pathname = usePathname();
  const { activeWorkspace } = useWorkspace();
  const { user } = useAuth();

  const accountName = user?.nickName || user?.email || user?.phone || t("account");

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

        {activeWorkspace && (
          <Group title={t("groupTeamsSettings")}>
            <div className="flex flex-col gap-0.5">
              {TEAM_SUB_NAV.map(({ href, labelKey, Icon }) => (
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
          </Group>
        )}
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
