import { SettingsSidebar } from "./_components/settings-sidebar";

/**
 * Standalone Settings shell — its own two-pane page (sidebar + content),
 * outside the main studio chrome, like imagine.art's /settings. The active
 * workspace (provided app-wide in app/providers.tsx) drives the team-scoped
 * sub-pages.
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh overflow-hidden">
      <SettingsSidebar />
      <div className="min-w-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
