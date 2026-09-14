"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  IconChartBar,
  IconCreditCard,
  IconGauge,
  IconLayoutGrid,
  IconSettings,
  IconUsers,
} from "@tabler/icons-react";
import { usePathname } from "@/i18n/navigation";
import { settingsMemberProject } from "@/lib/settings-member-scope";
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
  const t = useTranslations("settings");
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
    // Drop the hash URL (no setState — `open` is already false without a user,
    // so the modal stays hidden); then prompt sign-in and reopen on success.
    history.replaceState(null, "", window.location.pathname + window.location.search);
    requireAuth(() => openSettings(target));
  }, [section, user, loading, requireAuth]);

  const open = section != null && !!user;
  const Content = open && section ? SECTIONS[section] : null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent
        aria-describedby={undefined}
        className="h-[85vh] max-h-[860px] w-[calc(100%-2rem)] max-w-5xl overflow-hidden p-0 sm:max-w-5xl"
      >
        <DialogTitle className="sr-only">{t("settings")}</DialogTitle>
        <div className="flex h-full min-h-0">
          <OverlaySidebar active={section} />
          <div className="min-w-0 flex-1 overflow-y-auto">{Content && <Content />}</div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Mirrors SettingsSidebar's TEAM_SUB_NAV — same sections for every workspace type. */
const TEAM_SUB_NAV = [
  { section: "overview", labelKey: "navOverview", Icon: IconLayoutGrid },
  { section: "members", labelKey: "navMembers", Icon: IconUsers },
  { section: "usage", labelKey: "navUsage", Icon: IconGauge },
  { section: "analytics", labelKey: "navAnalytics", Icon: IconChartBar },
  { section: "billing", labelKey: "navBilling", Icon: IconCreditCard },
] as const;

/** Hash-based mirror of SettingsSidebar — nav switches the hash, not the route. */
function OverlaySidebar({ active }: { active: SettingsSection | null }) {
  const t = useTranslations("settings");
  const { activeWorkspace } = useWorkspace();
  const project = settingsMemberProject(usePathname());
  const { user } = useAuth();
  const accountName = user?.nickName || user?.email || user?.phone || t("account");

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

        {project ? (
          <Group title={t("projectSettings")}>
            <NavItem
              section="members"
              active={active === "members"}
              leading={<IconUsers className="size-4" stroke={1.8} />}
            >
              {t("projectMembers")}
            </NavItem>
          </Group>
        ) : null}
        {activeWorkspace ? (
          <Group title={t("groupTeamsSettings")}>
            <div className="flex flex-col gap-0.5">
              {TEAM_SUB_NAV.filter((item) => !project || item.section !== "members").map(
                ({ section, labelKey, Icon }) => (
                  <NavItem
                    key={section}
                    section={section}
                    active={active === section}
                    leading={<Icon className="size-4" stroke={1.8} />}
                  >
                    {t(labelKey)}
                  </NavItem>
                )
              )}
            </div>
          </Group>
        ) : null}
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
