"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { IconBolt, IconCopy, IconLogout } from "@tabler/icons-react";
import { encodeUserId } from "@repo/shared";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FrostedPanel } from "@/components/ui/frosted-panel";
import { useAuth } from "@/app/_components/auth-provider";
import { useWorkspace } from "@/app/_components/workspace-context";
import { useComputeWalletBalance } from "@/app/_components/credits-badge";
import { SubscriptionDialog } from "@/app/_components/subscription-dialog";
import { PageHeader, Panel } from "../_components/settings-ui";

/**
 * Account (Profile) — the signed-in identity + per-user compute credits. Profile
 * fields are owned by the upstream account system, so they render read-only here
 * (no fake-editable controls); credits + upgrade are the real, wired actions.
 */
export default function AccountSettingsPage() {
  const t = useTranslations("settings");
  const common = useTranslations("common");
  const { user, signIn, signOut } = useAuth();
  const { workspaces } = useWorkspace();
  const personalWorkspace = workspaces.find((ws) => ws.isDefault);
  const {
    data: credits,
    error,
    isFetching,
    refetch,
  } = useComputeWalletBalance(Boolean(user && personalWorkspace), personalWorkspace?.id);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  if (!user) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-8">
        <PageHeader title={t("account")} />
        <FrostedPanel className="mt-6 p-10 text-center">
          <p className="text-sm text-muted-foreground">{t("signInToManageAccount")}</p>
          <Button className="mt-4" onClick={signIn}>
            {t("signIn")}
          </Button>
        </FrostedPanel>
      </main>
    );
  }

  const name = user.nickName || user.email || user.phone || t("account");
  const contact = user.email || user.phone || "";
  const publicId = encodeUserId(user.id);

  const copyId = async () => {
    if (!publicId) return;
    try {
      await navigator.clipboard.writeText(publicId);
      toast.success(t("publicIdCopied"));
    } catch {
      toast.error(t("publicIdCopyFailed"));
    }
  };

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8">
      <PageHeader title={t("account")} subtitle={t("accountSubtitle")} />

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
                <span className="truncate">{t("publicId", { id: publicId })}</span>
                <IconCopy className="size-3 shrink-0" stroke={1.8} />
              </button>
            )}
          </div>
          <Button variant="secondary" onClick={() => void signOut()}>
            <IconLogout className="size-4" />
            {t("signOut")}
          </Button>
        </div>
      </Panel>

      <Panel
        title={t("computeCredits")}
        icon={<IconBolt className="size-4 text-muted-foreground" />}
      >
        {error && (
          <div
            role="alert"
            className="mb-3 flex flex-wrap items-center gap-3 text-sm text-muted-foreground"
          >
            <span>{error.message || t("creditsLoadFailed")}</span>
            <Button
              variant="secondary"
              size="sm"
              disabled={isFetching}
              onClick={() => void refetch()}
            >
              {common("retry")}
            </Button>
          </div>
        )}
        <div className="grid grid-cols-3 gap-3">
          <CreditStat label={t("available")} value={credits?.available} />
          <CreditStat label={t("held")} value={credits?.held} />
          <CreditStat label={t("total")} value={credits?.total} />
        </div>
        <Button className="mt-4" onClick={() => setUpgradeOpen(true)}>
          {t("upgrade")}
        </Button>
      </Panel>

      <SubscriptionDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} />
    </main>
  );
}

function CreditStat({ label, value }: { label: string; value: bigint | undefined }) {
  return (
    <FrostedPanel className="px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">
        {value != null ? value.toLocaleString() : "—"}
      </div>
    </FrostedPanel>
  );
}
