"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { IconGift } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { redeemVoucher } from "@/lib/billing";
import { computeWalletBalanceQueryKey } from "@/app/_components/credits-badge";
import { Panel } from "./settings-ui";

/**
 * Redeem a gift / campaign code (兑换券) for compute credits. On success the
 * server credits the personal-workspace pot; we invalidate the balance query so
 * the header pill + this page reflect it immediately.
 */
export function RedeemVoucherPanel() {
  const t = useTranslations("settings");
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = code.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      const result = await redeemVoucher(trimmed);
      const amount = Number(result.granted.amount).toLocaleString();
      toast.success(
        result.alreadyRedeemed
          ? t("redeemCode.alreadyRedeemed")
          : t("redeemCode.success", { amount })
      );
      setCode((current) => (current === code ? "" : current));
      await queryClient.invalidateQueries({ queryKey: computeWalletBalanceQueryKey });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("redeemCode.error"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Panel
      title={t("redeemCode.title")}
      icon={<IconGift className="size-4 text-muted-foreground" />}
    >
      <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <p className="text-sm text-muted-foreground sm:flex-1">{t("redeemCode.subtitle")}</p>
        <div className="flex items-center gap-2">
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder={t("redeemCode.placeholder")}
            autoCapitalize="characters"
            spellCheck={false}
            className="h-9 w-48 rounded-lg bg-white/[0.06] px-3 font-mono text-sm uppercase tracking-wide text-foreground placeholder:font-sans placeholder:normal-case placeholder:tracking-normal placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          />
          <Button type="submit" disabled={submitting || !code.trim()} className="shrink-0">
            {t("redeemCode.button")}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
