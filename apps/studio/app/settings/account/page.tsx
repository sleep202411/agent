"use client";

import { useState } from "react";
import { IconBolt, IconCopy, IconLogout } from "@tabler/icons-react";
import { encodeUserId } from "@repo/shared";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/app/_components/auth-provider";
import { useComputeWalletBalance } from "@/app/_components/credits-badge";
import { SubscriptionDialog } from "@/app/_components/subscription-dialog";
import { PageHeader, Panel } from "../_components/settings-ui";

/**
 * Account (Profile) — the signed-in identity + per-user compute credits. Profile
 * fields are owned by the upstream account system, so they render read-only here
 * (no fake-editable controls); credits + upgrade are the real, wired actions.
 */
export default function AccountSettingsPage() {
  const { user, signIn, signOut } = useAuth();
  const { data: credits } = useComputeWalletBalance(Boolean(user));
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  if (!user) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-8">
        <PageHeader title="Account" />
        <div className="mt-6 rounded-2xl bg-card p-10 text-center">
          <p className="text-sm text-muted-foreground">Sign in to manage your account.</p>
          <Button className="mt-4" onClick={signIn}>
            Sign in
          </Button>
        </div>
      </main>
    );
  }

  const name = user.nickName || user.email || user.phone || "Account";
  const contact = user.email || user.phone || "";
  const publicId = encodeUserId(user.id);

  const copyId = async () => {
    if (!publicId) return;
    try {
      await navigator.clipboard.writeText(publicId);
      toast.success("Public ID copied");
    } catch {
      toast.error("Could not copy Public ID");
    }
  };

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8">
      <PageHeader title="Account" subtitle="Your profile and compute credits." />

      <Panel>
        <div className="flex items-center gap-4">
          {user.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element -- external avatar URL
            <img
              src={user.avatar}
              alt={name}
              className="size-14 shrink-0 rounded-full object-cover"
            />
          ) : (
            <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-secondary text-lg font-semibold">
              {name.charAt(0).toUpperCase()}
            </span>
          )}
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-base font-medium">{name}</span>
            {contact && <span className="truncate text-sm text-muted-foreground">{contact}</span>}
            {publicId && (
              <button
                type="button"
                onClick={copyId}
                className="mt-1 inline-flex max-w-full items-center gap-1 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <span className="truncate">Public ID {publicId}</span>
                <IconCopy className="size-3 shrink-0" stroke={1.8} />
              </button>
            )}
          </div>
          <Button variant="secondary" onClick={() => void signOut()}>
            <IconLogout className="size-4" />
            Sign out
          </Button>
        </div>
      </Panel>

      <Panel title="Compute credits" icon={<IconBolt className="size-4 text-muted-foreground" />}>
        <div className="grid grid-cols-3 gap-3">
          <CreditStat label="Available" value={credits?.available} />
          <CreditStat label="Held" value={credits?.held} />
          <CreditStat label="Total" value={credits?.total} />
        </div>
        <Button className="mt-4" onClick={() => setUpgradeOpen(true)}>
          Upgrade
        </Button>
      </Panel>

      <SubscriptionDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} />
    </main>
  );
}

function CreditStat({ label, value }: { label: string; value: bigint | undefined }) {
  return (
    <div className="rounded-xl bg-white/[0.05] px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">
        {value != null ? value.toLocaleString() : "—"}
      </div>
    </div>
  );
}
