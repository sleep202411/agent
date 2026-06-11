import type { Metadata } from "next";
import { Separator } from "@/components/ui/separator";
import { ComingSoonButton } from "./_components/coming-soon-button";

export const metadata: Metadata = {
  title: "Settings · FizzStudio",
};

const APP_VERSION = "0.1.0";

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 first:mt-6">
      <h2 className="px-1 text-sm font-semibold">{title}</h2>
      <div className="mt-3 rounded-xl bg-card">{children}</div>
    </section>
  );
}

function SettingsRow({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
      </div>
      {children && <div className="flex shrink-0 items-center">{children}</div>}
    </div>
  );
}

/** Inset row divider — h-px separators are the permitted hairline. */
function RowSeparator() {
  return <Separator className="mx-5 data-horizontal:w-auto" />;
}

export default function SettingsPage() {
  return (
    <main className="mx-auto w-full max-w-[1480px] px-4 py-8 sm:px-6">
      <h1 className="text-xl font-semibold">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Manage your account, workspace, and studio preferences.
      </p>

      <div className="max-w-3xl">
        <SettingsGroup title="Account">
          <SettingsRow label="Display name" description="How your name appears across FizzStudio.">
            <span className="text-sm text-muted-foreground">Not connected</span>
          </SettingsRow>
          <RowSeparator />
          <SettingsRow label="Email" description="Used for sign-in and notifications.">
            <span className="text-sm text-muted-foreground">Not connected</span>
          </SettingsRow>
          <RowSeparator />
          <SettingsRow
            label="Connected account"
            description="Sign in to sync your profile, credits, and generations."
          >
            <ComingSoonButton label="Connect account" />
          </SettingsRow>
        </SettingsGroup>

        <SettingsGroup title="Workspace">
          <SettingsRow
            label="Active workspace"
            description="Generations and boards are saved here."
          >
            <span className="flex flex-col items-end">
              <span className="text-sm">Personal</span>
              <span className="mt-0.5 text-xs text-muted-foreground">Default workspace</span>
            </span>
          </SettingsRow>
        </SettingsGroup>

        <SettingsGroup title="About">
          <SettingsRow label="Version" description="Current FizzStudio build.">
            <span className="text-sm text-muted-foreground tabular-nums">{APP_VERSION}</span>
          </SettingsRow>
          <RowSeparator />
          <SettingsRow
            label="Terms of Service"
            description="The agreement covering your use of FizzStudio."
          >
            <ComingSoonButton label="Terms" variant="text">
              View
            </ComingSoonButton>
          </SettingsRow>
          <RowSeparator />
          <SettingsRow label="Privacy Policy" description="How your data is handled and stored.">
            <ComingSoonButton label="Privacy" variant="text">
              View
            </ComingSoonButton>
          </SettingsRow>
        </SettingsGroup>
      </div>
    </main>
  );
}
