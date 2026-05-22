"use client";

/**
 * CreatorLeftRail — secondary identity column below the hero.
 *
 * Renders one card: business info (creator id, verification, joined,
 * contact).
 *
 * The marketplace-stats card was removed in Phase 1a — there is no
 * order data yet, so completed-orders / rating / response-time /
 * repeat-buyer were all stubs that read as broken to first visitors.
 * Bring it back when the Order schema lands and we can populate real
 * numbers (Phase 1b).
 */
import { useTranslations } from "@/src/i18n/i18n";
import type { Creator } from "@/app/(site)/creators/_hooks/use-creator";

interface CreatorLeftRailProps {
  creator: Creator;
  // Kept in the signature so future owner-only rail content (e.g. a
  // "boost visibility" upsell tile) doesn't require a prop change.
  isOwner: boolean;
}

export function CreatorLeftRail({ creator }: CreatorLeftRailProps) {
  const t = useTranslations("creatorCenter");
  const joined = formatJoined(creator.joinedAt);

  return (
    <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
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
