"use client";

import { IconInfoCircle } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import type { IPCreateForm } from "@/components/ip/ip-mock";

interface Props {
  form: IPCreateForm;
  update: (patch: Partial<IPCreateForm>) => void;
}

export function StepFunding({ form, update }: Props) {
  const t = useTranslations("ipCreate");

  const isInvestment = form.fundingMode === "investment";

  // Auto-calculated values
  const pricePerShare =
    isInvestment && Number(form.valuation) && Number(form.sharesOffered) && Number(form.totalShares)
      ? Math.round(
          (Number(form.valuation) * Number(form.sharesOffered)) / 100 / Number(form.totalShares)
        )
      : 0;
  const fundingTarget =
    isInvestment && Number(form.valuation) && Number(form.sharesOffered)
      ? Math.round((Number(form.valuation) * Number(form.sharesOffered)) / 100)
      : 0;

  const presaleTotal = form.presalePrice * form.presaleTarget;
  const discount =
    form.fullPrice > 0 ? Math.round((1 - form.presalePrice / form.fullPrice) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Mode toggle */}
      <div>
        <label className="mb-2 block text-sm font-medium text-foreground">
          {t("fundingMode")} <span className="text-destructive">*</span>
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => update({ fundingMode: "investment" })}
            className={cn(
              "flex-1 rounded-xl border px-4 py-3 text-sm font-medium transition-all",
              isInvestment
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-secondary text-muted-foreground hover:text-foreground"
            )}
          >
            {t("modeInvestment")}
          </button>
          <button
            type="button"
            onClick={() => update({ fundingMode: "presale" })}
            className={cn(
              "flex-1 rounded-xl border px-4 py-3 text-sm font-medium transition-all",
              !isInvestment
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-secondary text-muted-foreground hover:text-foreground"
            )}
          >
            {t("modePresale")}
          </button>
        </div>
      </div>

      {isInvestment ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-xs font-medium text-foreground">
                {t("ipValuation")} <span className="text-destructive">*</span>
              </label>
              <input
                type="number"
                value={form.valuation}
                onChange={(e) => update({ valuation: e.target.value })}
                placeholder="1000000"
                className="w-full rounded-xl border border-border bg-secondary px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <div>
              <label className="mb-2 block text-xs font-medium text-foreground">
                {t("sharesOffered")} (%) <span className="text-destructive">*</span>
              </label>
              <input
                type="number"
                value={form.sharesOffered}
                onChange={(e) => update({ sharesOffered: e.target.value })}
                placeholder="20"
                className="w-full rounded-xl border border-border bg-secondary px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <div>
              <label className="mb-2 block text-xs font-medium text-foreground">
                {t("totalSharesLabel")} <span className="text-destructive">*</span>
              </label>
              <input
                type="number"
                value={form.totalShares}
                onChange={(e) => update({ totalShares: e.target.value })}
                placeholder="5"
                className="w-full rounded-xl border border-border bg-secondary px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <div>
              <label className="mb-2 block text-xs font-medium text-foreground">
                {t("fundingDeadline")}
              </label>
              <input
                type="date"
                value={form.deadline}
                onChange={(e) => update({ deadline: e.target.value })}
                className="w-full rounded-xl border border-border bg-secondary px-4 py-2.5 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          </div>
          {pricePerShare > 0 && (
            <div className="rounded-lg bg-amber-400/5 p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{t("calcPricePerShare")}</span>
                <span className="font-semibold text-amber-400">
                  {"\u00A5"}
                  {pricePerShare.toLocaleString()}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{t("calcFundingTarget")}</span>
                <span className="font-semibold text-foreground">
                  {"\u00A5"}
                  {fundingTarget.toLocaleString()}
                </span>
              </div>
            </div>
          )}
          <div className="flex items-start gap-2 rounded-lg bg-primary/5 p-3">
            <IconInfoCircle className="mt-0.5 size-4 shrink-0 text-primary" />
            <p className="text-xs leading-relaxed text-muted-foreground">{t("investmentTip")}</p>
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-xs font-medium text-foreground">
                {t("presalePriceLabel")} <span className="text-destructive">*</span>
              </label>
              <input
                type="number"
                value={form.presalePrice}
                onChange={(e) => update({ presalePrice: Number(e.target.value) || 0 })}
                className="w-full rounded-xl border border-border bg-secondary px-4 py-2.5 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <div>
              <label className="mb-2 block text-xs font-medium text-foreground">
                {t("fullPriceLabel")}
              </label>
              <input
                type="number"
                value={form.fullPrice}
                onChange={(e) => update({ fullPrice: Number(e.target.value) || 0 })}
                className="w-full rounded-xl border border-border bg-secondary px-4 py-2.5 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <div>
              <label className="mb-2 block text-xs font-medium text-foreground">
                {t("presaleTargetLabel")} <span className="text-destructive">*</span>
              </label>
              <input
                type="number"
                value={form.presaleTarget}
                onChange={(e) => update({ presaleTarget: Number(e.target.value) || 0 })}
                className="w-full rounded-xl border border-border bg-secondary px-4 py-2.5 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <div>
              <label className="mb-2 block text-xs font-medium text-foreground">
                {t("presaleDeadlineLabel")}
              </label>
              <input
                type="date"
                value={form.presaleDeadline}
                onChange={(e) => update({ presaleDeadline: e.target.value })}
                className="w-full rounded-xl border border-border bg-secondary px-4 py-2.5 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          </div>
          {presaleTotal > 0 && (
            <div className="rounded-lg bg-blue-400/5 p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{t("calcPresaleTotal")}</span>
                <span className="font-semibold text-blue-400">
                  {"\u00A5"}
                  {presaleTotal.toLocaleString()}
                </span>
              </div>
              {discount > 0 && (
                <div className="mt-1 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{t("calcDiscount")}</span>
                  <span className="font-semibold text-green-400">{discount}%</span>
                </div>
              )}
            </div>
          )}
          <div className="flex items-start gap-2 rounded-lg bg-primary/5 p-3">
            <IconInfoCircle className="mt-0.5 size-4 shrink-0 text-primary" />
            <p className="text-xs leading-relaxed text-muted-foreground">{t("presaleTip")}</p>
          </div>
        </>
      )}
    </div>
  );
}
