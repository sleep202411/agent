"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  IconChartBar,
  IconChevronDown,
  IconCreditCard,
  IconGauge,
  IconLayoutGrid,
  IconSettings,
  IconUsers,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import {
  openSettings,
  parseSettingsHash,
  SETTINGS_HASH,
  type SettingsSection,
} from "@/lib/settings-hash";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/app/_components/auth-provider";
import { useWorkspace } from "@/app/_components/workspace-context";
import type { WorkspaceRef } from "@/lib/collab/projects-api";
import { LetterAvatar } from "../settings/_components/settings-ui";
import AccountSettingsPage from "../settings/account/page";
import AnalyticsSettingsPage from "../settings/analytics/page";
import BillingSettingsPage from "../settings/billing/page";
import MembersSettingsPage from "../settings/members/page";
import OverviewSettingsPage from "../settings/overview/page";
import UsageSettingsPage from "../settings/usage/page";

/**
 * Settings as a HASH-driven modal overlay (`#settings/<section>`), mounted once
 * app-wide. Like Claude (`/recents#settings/general`): the route never changes,
 * so the underlying app stays mounted/dimmed behind the modal — and a refresh of
 * `…#settings/usage` re-opens the SAME modal over the same page (the hash is read
 * on mount). Sub-pages are the same prop-less client components as the full-page
 * fallback routes. Open it from anywhere with `openSettings("usage")`.
 */

const SECTIONS: Record<SettingsSection, React.ComponentType> = {
  account: AccountSettingsPage,
  overview: OverviewSettingsPage,
  members: MembersSettingsPage,
  usage: UsageSettingsPage,
  analytics: AnalyticsSettingsPage,
  billing: BillingSettingsPage,
};

export function SettingsOverlay() {
  const { user, loading, requireAuth } = useAuth();
  const [section, setSection] = useState<SettingsSection | null>(null);

  useEffect(() => {
    const sync = () => setSection(parseSettingsHash(window.location.hash));
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const close = useCallback(() => {
    // Drop the hash without adding a history entry or scrolling.
    history.replaceState(null, "", window.location.pathname + window.location.search);
    setSection(null);
  }, []);

  // Settings is a signed-in surface (account / billing / team). A signed-out
  // user reaching a #settings hash (link or refresh) gets the sign-in dialog
  // instead of a broken modal; the section reopens automatically after login.
  useEffect(() => {
    if (!section || loading || user) return;
    const target = section;
    close();
    requireAuth(() => openSettings(target));
  }, [section, user, loading, requireAuth, close]);

  const open = section != null && !!user;
  const Content = open && section ? SECTIONS[section] : null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent
        aria-describedby={undefined}
        className="h-[85vh] max-h-[860px] w-[calc(100%-2rem)] max-w-5xl overflow-hidden p-0 sm:max-w-5xl"
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <div className="flex h-full min-h-0">
          <OverlaySidebar active={section} />
          <div className="min-w-0 flex-1 overflow-y-auto">{Content && <Content />}</div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function teamSubNav(isPersonal: boolean) {
  return [
    { section: "overview" as const, labelKey: "navOverview" as const, Icon: IconLayoutGrid },
    ...(isPersonal
      ? []
      : [{ section: "members" as const, labelKey: "navMembers" as const, Icon: IconUsers }]),
    { section: "usage" as const, labelKey: "navUsage" as const, Icon: IconGauge },
    { section: "analytics" as const, labelKey: "navAnalytics" as const, Icon: IconChartBar },
    { section: "billing" as const, labelKey: "navBilling" as const, Icon: IconCreditCard },
  ];
}

/** Hash-based mirror of SettingsSidebar — nav switches the hash, not the route. */
function OverlaySidebar({ active }: { active: SettingsSection | null }) {
  const t = useTranslations("settings");
  const { workspaces, activeWorkspace, setActiveWorkspaceId } = useWorkspace();
  const { user } = useAuth();
  const accountName = user?.nickName || user?.email || user?.phone || t("account");

  const selectWorkspace = (ws: WorkspaceRef) => {
    setActiveWorkspaceId(ws.id);
    openSettings("overview");
  };

  return (
    <aside className="flex w-64 shrink-0 flex-col bg-card px-3 py-5">
      <div className="flex items-center gap-2 px-2">
        <IconSettings className="size-5" stroke={1.8} />
        <h1 className="text-lg font-semibold">{t("settings")}</h1>
      </div>

      <nav className="mt-5 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
        <Group title={t("groupProfile")}>
          <NavItem
            section="account"
            active={active === "account"}
            leading={<LetterAvatar name={accountName} size="size-6" />}
          >
            {t("account")}
          </NavItem>
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
                    {subNav.map(({ section, labelKey, Icon }) => (
                      <NavItem
                        key={section}
                        section={section}
                        active={active === section}
                        leading={<Icon className="size-4" stroke={1.8} />}
                      >
                        {t(labelKey)}
                      </NavItem>
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

function NavItem({
  section,
  active,
  leading,
  children,
}: {
  section: SettingsSection;
  active: boolean;
  leading?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <a
      href={`#${SETTINGS_HASH}/${section}`}
      className={cn(
        "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
        active
          ? "bg-secondary text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      {leading}
      {children}
    </a>
  );
}
