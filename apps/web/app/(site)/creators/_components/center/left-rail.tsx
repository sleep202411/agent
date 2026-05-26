"use client";

/**
 * CreatorLeftRail — secondary identity column below the hero.
 *
 * Renders one card: business info (creator id, verification, joined,
 * contact), plus a compact certificate trust summary.
 *
 * The marketplace-stats card was removed in Phase 1a — there is no
 * order data yet, so completed-orders / rating / response-time /
 * repeat-buyer were all stubs that read as broken to first visitors.
 * Bring it back when the Order schema lands and we can populate real
 * numbers (Phase 1b).
 */
import { IconCertificate, IconShieldCheck } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import type { Creator } from "@/app/(site)/creators/_hooks/use-creator";
import { getCreatorCertificates } from "@/app/(site)/creators/_data/certificates";

interface CreatorLeftRailProps {
  creator: Creator;
  // Kept in the signature so future owner-only rail content (e.g. a
  // "boost visibility" upsell tile) doesn't require a prop change.
  isOwner: boolean;
}

export function CreatorLeftRail({ creator }: CreatorLeftRailProps) {
  const t = useTranslations("creatorCenter");
  const joined = formatJoined(creator.joinedAt);
  const certificates = getCreatorCertificates(creator.id);
  const topCertificate = certificates[0] ?? null;

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

      {topCertificate ? (
        <div className="rounded-2xl bg-card px-5 py-4 text-xs">
          <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("certificates.railHeading")}
          </h2>
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
              <IconCertificate className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-400">
                <IconShieldCheck className="size-3.5" />
                {t("certificates.verified")}
              </div>
              <p className="mt-1 line-clamp-2 text-sm font-semibold leading-snug text-foreground">
                {topCertificate.title}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t("certificates.railCount", { count: certificates.length })}
              </p>
            </div>
          </div>
        </div>
      ) : null}
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
