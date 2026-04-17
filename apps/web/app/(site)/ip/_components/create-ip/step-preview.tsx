"use client";

import { IconCircleCheck, IconAlertTriangle } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import type { IPCreateForm } from "@/app/(site)/ip/_components/ip-mock";

interface Props {
  form: IPCreateForm;
}

interface CheckItem {
  labelKey: string;
  ok: boolean;
  detail: string;
}

export function StepPreview({ form }: Props) {
  const t = useTranslations("ipCreate");

  const checks: { sectionKey: string; items: CheckItem[] }[] = [
    {
      sectionKey: "previewBasicInfo",
      items: [
        { labelKey: "previewTitle", ok: !!form.title, detail: form.title || "-" },
        {
          labelKey: "previewType",
          ok: !!form.projectType,
          detail: form.projectType ? t(`type_${form.projectType}`) : "-",
        },
        {
          labelKey: "previewTags",
          ok: form.tags.length > 0,
          detail: `${form.tags.length} ${t("previewTagCount")}`,
        },
      ],
    },
    {
      sectionKey: "previewStory",
      items: [
        { labelKey: "previewEpisodes", ok: true, detail: `${form.targetEpisodes} ${t("epsUnit")}` },
        {
          labelKey: "previewStoryLen",
          ok: form.story.length >= 30,
          detail: `${form.story.length} ${t("previewChars")}`,
        },
        {
          labelKey: "previewMotivation",
          ok: !!form.whyThisIP,
          detail: form.whyThisIP ? t("previewDone") : "-",
        },
      ],
    },
    {
      sectionKey: "previewFunding",
      items:
        form.fundingMode === "investment"
          ? [
              { labelKey: "previewMode", ok: true, detail: t("modeInvestment") },
              {
                labelKey: "previewValuation",
                ok: !!form.valuation,
                detail: form.valuation ? `\u00A5${Number(form.valuation).toLocaleString()}` : "-",
              },
              {
                labelKey: "previewShares",
                ok: !!form.totalShares,
                detail: form.totalShares || "-",
              },
            ]
          : [
              { labelKey: "previewMode", ok: true, detail: t("modePresale") },
              {
                labelKey: "previewPresalePrice",
                ok: form.presalePrice > 0,
                detail: `\u00A5${form.presalePrice}`,
              },
              {
                labelKey: "previewTarget",
                ok: form.presaleTarget > 0,
                detail: `${form.presaleTarget} ${t("previewPeople")}`,
              },
            ],
    },
    {
      sectionKey: "previewRewards",
      items: [
        {
          labelKey: "previewTierCount",
          ok: form.rewards.length > 0,
          detail: `${form.rewards.length} ${t("previewTiers")}`,
        },
        {
          labelKey: "previewMinReward",
          ok: form.rewards.length > 0,
          detail:
            form.rewards.length > 0
              ? `\u00A5${Math.min(...form.rewards.map((r) => r.amount))}`
              : "-",
        },
      ],
    },
  ];

  const totalChecks = checks.flatMap((s) => s.items);
  const passedCount = totalChecks.filter((c) => c.ok).length;
  const allPassed = passedCount === totalChecks.length;
  const pct = Math.round((passedCount / totalChecks.length) * 100);

  return (
    <div className="space-y-6">
      {/* Progress */}
      <div>
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{t("previewCompletion")}</span>
          <span className={cn("font-semibold", allPassed ? "text-green-400" : "text-amber-400")}>
            {pct}%
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              allPassed ? "bg-green-400" : "bg-amber-400"
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Checklist */}
      <div className="space-y-4">
        {checks.map((section) => (
          <div key={section.sectionKey} className="rounded-xl border border-border bg-card p-4">
            <h4 className="mb-3 text-sm font-semibold text-foreground">{t(section.sectionKey)}</h4>
            <div className="space-y-2">
              {section.items.map((item) => (
                <div key={item.labelKey} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {item.ok ? (
                      <IconCircleCheck className="size-4 text-green-400" />
                    ) : (
                      <IconAlertTriangle className="size-4 text-amber-400" />
                    )}
                    <span className="text-xs text-muted-foreground">{t(item.labelKey)}</span>
                  </div>
                  <span className="text-xs font-medium text-foreground">{item.detail}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* IP card preview */}
      <div>
        <h4 className="mb-3 text-sm font-semibold text-foreground">{t("previewCardTitle")}</h4>
        <div className="mx-auto max-w-sm overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex aspect-video items-center justify-center bg-secondary">
            {form.coverImage ? (
              <img src={form.coverImage} alt="" className="size-full object-cover" />
            ) : (
              <span className="text-sm text-muted-foreground/40">{t("previewNoCover")}</span>
            )}
          </div>
          <div className="p-4">
            <h3 className="mb-1 text-sm font-bold text-foreground">
              {form.title || t("previewUntitled")}
            </h3>
            <p className="mb-2 line-clamp-2 text-xs text-muted-foreground">
              {form.description || t("previewNoDesc")}
            </p>
            <div className="mb-2 flex flex-wrap gap-1">
              {form.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
              {form.tags.length > 3 && (
                <span className="text-[10px] text-muted-foreground">+{form.tags.length - 3}</span>
              )}
            </div>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              {form.projectType && (
                <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">
                  {t(`type_${form.projectType}`)}
                </span>
              )}
              <span>
                {form.targetEpisodes} {t("epsUnit")}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Warning */}
      {!allPassed && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-400/10 p-3">
          <IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
          <p className="text-xs leading-relaxed text-amber-400">{t("previewWarning")}</p>
        </div>
      )}
    </div>
  );
}
