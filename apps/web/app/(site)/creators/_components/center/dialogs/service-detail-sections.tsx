"use client";

/**
 * Read-only render of a CreatorService — tags + 3-tier comparison.
 *
 * Used in two surfaces:
 *
 *   1. `ServiceDetailDialog` (visitor view of a saved service)
 *   2. The wizard's Preview step inside `CreateServiceDialog`,
 *      where we render from in-memory form state instead of a
 *      saved DTO so the creator can see the buyer-facing layout
 *      before publishing.
 *
 * Both surfaces pass the same DTO shape; the wizard builds a
 * "preview DTO" from form state and hands it in.
 */
import { IconClockHour4, IconRefresh } from "@tabler/icons-react";
import {
  SERVICE_TIERS,
  UNLIMITED_REVISIONS,
  type CreatorServiceDTO,
  type ServicePackageDTO,
  type ServiceTier,
} from "@repo/shared/creator-service";
import { ZERO_DECIMAL_CURRENCIES } from "@repo/shared/crew";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";

export function ServiceDetailSections({ service }: { service: CreatorServiceDTO }) {
  const t = useTranslations("creatorService");
  const byTier = new Map<ServiceTier, ServicePackageDTO>(service.packages.map((p) => [p.tier, p]));

  return (
    <div className="space-y-6">
      {service.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {service.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center rounded-full bg-secondary px-2.5 py-1 text-xs text-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      <section className="space-y-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("detailPackagesHeading")}
        </h3>
        {service.packages.length === 0 ? (
          <p className="rounded-lg bg-card/50 px-4 py-6 text-center text-sm text-muted-foreground">
            {t("detailNoPackages")}
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            {SERVICE_TIERS.map((tier) => {
              const pkg = byTier.get(tier);
              if (!pkg) {
                return <TierEmpty key={tier} tier={tier} />;
              }
              return <TierColumn key={tier} pkg={pkg} />;
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function TierColumn({ pkg }: { pkg: ServicePackageDTO }) {
  const t = useTranslations("creatorService");
  const isZero = ZERO_DECIMAL_CURRENCIES.has(pkg.currency);
  const priceLabel = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: pkg.currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: isZero ? 0 : 2,
  }).format(pkg.price);

  return (
    <article
      className={cn(
        // h-full so all 3 columns stretch to the tallest row,
        // keeping the comparison aligned even when one tier has
        // dense scope bullets and another has none.
        "flex h-full flex-col gap-3 rounded-xl border border-border bg-card p-4",
        pkg.tier === "premium" && "border-primary/40 ring-1 ring-primary/30"
      )}
    >
      <header className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t(`tier.${pkg.tier}`)}
          </span>
          {pkg.tier === "premium" ? (
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
              {t("tierPremiumBadge")}
            </span>
          ) : null}
        </div>
        <h4 className="line-clamp-2 text-sm font-semibold text-foreground">{pkg.title || "—"}</h4>
        <div className="text-xl font-bold tabular-nums text-foreground">{priceLabel}</div>
      </header>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <IconClockHour4 className="size-3" />
          {t("detailDeliveryDays", { days: String(pkg.deliveryDays) })}
        </span>
        <span className="inline-flex items-center gap-1">
          <IconRefresh className="size-3" />
          {pkg.revisions === UNLIMITED_REVISIONS
            ? t("detailRevisionsUnlimited")
            : t("detailRevisionsCount", { count: String(pkg.revisions) })}
        </span>
      </div>

      {pkg.description ? (
        <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
          {pkg.description}
        </p>
      ) : null}

      {pkg.scope.length > 0 ? (
        <ul className="space-y-1 text-xs text-foreground">
          {pkg.scope.map((bullet, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary/70" />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function TierEmpty({ tier }: { tier: ServiceTier }) {
  const t = useTranslations("creatorService");
  // Match TierColumn's visual weight (same border + h-full stretch)
  // so the empty stub doesn't read as a stranded label next to a
  // filled card. Lighter background + muted copy signals "not
  // offered" without breaking the row alignment.
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border bg-card/40 p-4 text-center">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
        {t(`tier.${tier}`)}
      </span>
      <span className="text-xs text-muted-foreground/70">{t("detailTierNotOffered")}</span>
    </div>
  );
}
