"use client";

/**
 * CreatorLeftRail — secondary identity column below the hero.
 *
 * After the hero takes over identity (avatar / name / level / bio /
 * CTAs), the left rail's job narrows to two cards:
 *
 *   1. Marketplace stats  — completed orders, rating, response,
 *      repeat-buyer rate. Phase 1a renders zeroes; Phase 1b
 *      populates from order outcomes.
 *   2. Business info       — creator id, verification status, joined
 *      date, contact channel.
 *
 * Slimmer rail = more horizontal room for the right pane, which is
 * the real content area. On mobile both cards stack above the tab
 * bar (the hero already stacks vertically there).
 */
import { useTranslations } from "@/src/i18n/i18n";
import type { Creator } from "@/app/(site)/creators/_hooks/use-creator";

interface CreatorLeftRailProps {
  creator: Creator;
  // Kept in the signature so future owner-only rail content (e.g. a
  // "boost visibility" upsell tile) doesn't require a prop change.
  isOwner: boolean;
}

export function CreatorLeftRail({ creator, isOwner: _isOwner }: CreatorLeftRailProps) {
  const t = useTranslations("creatorCenter");
  const joined = formatJoined(creator.joinedAt);

  const stats: { label: string; value: string }[] = [
    { label: t("stats.completedOrders"), value: "0" },
    { label: t("stats.rating"), value: "—" },
    { label: t("stats.responseTime"), value: "—" },
    { label: t("stats.repeatBuyers"), value: "0%" },
  ];

  return (
    <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
      <div className="overflow-hidden rounded-2xl bg-card">
        <div className="grid grid-cols-2 gap-px bg-background/60">
          {stats.map((s) => (
            <div key={s.label} className="bg-card px-4 py-4 text-center">
              <div className="text-lg font-semibold tabular-nums text-foreground">{s.value}</div>
              <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl bg-card px-5 py-4 text-xs">
        <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("info.heading")}
        </h2>
        <div className="space-y-2.5">
          <InfoRow label={t("info.userId")} value={String(creator.id ?? "—")} />
          <InfoRow
            label={t("info.kyc")}
            value={creator.contact ? t("info.kycVerified") : t("info.kycPending")}
          />
          {joined ? <InfoRow label={t("info.joined")} value={joined} /> : null}
          {creator.contact ? <InfoRow label={t("info.contact")} value={creator.contact} /> : null}
        </div>
      </div>
    </aside>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-[60%] truncate text-right font-medium text-foreground">{value}</span>
    </div>
  );
}

function formatJoined(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long" });
}
