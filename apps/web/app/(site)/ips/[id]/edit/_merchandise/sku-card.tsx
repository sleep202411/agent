"use client";

import { IconPencil, IconPhoto, IconTrash } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SwitchControl } from "@/components/ui/schema-field/switch-control";
import { ipImageUrl } from "@/app/(site)/ips/_hooks/use-ip";
import type { MerchandiseCurrency, MerchandiseSku } from "@/app/(site)/ips/_hooks/use-merchandise";
import { KindBadge } from "./kind-badge";

interface SkuCardProps {
  sku: MerchandiseSku;
  onEdit: () => void;
  onDelete: () => void;
  onToggleStatus: (next: 0 | 1) => void;
}

/**
 * One row in the merchandise grid. Cover left (or icon fallback),
 * name + description + price middle, status switch + edit/delete
 * actions right. Status is two-state for the toggle (draft 0 vs
 * listed 1); offline (8) is admin-only so the toggle just flips
 * between draft and listed.
 */
export function SkuCard({ sku, onEdit, onDelete, onToggleStatus }: SkuCardProps) {
  const t = useTranslations("ipEdit");
  const coverUrl = sku.cover ? ipImageUrl(sku.cover) : "";
  const isListed = sku.status === 1;
  const isOffline = sku.status === 8;

  return (
    <div
      className={cn(
        "flex items-stretch gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:border-primary/30",
        isOffline && "opacity-60"
      )}
    >
      {/* Cover */}
      <div className="relative size-20 shrink-0 overflow-hidden rounded-lg bg-muted/40">
        {coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={coverUrl} alt="" className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground/40">
            <IconPhoto className="size-7" />
          </div>
        )}
        <div className="absolute top-1 left-1">
          <KindBadge kind={sku.kind} size="xs" />
        </div>
      </div>

      {/* Middle */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="truncate text-sm font-semibold text-foreground">{sku.name}</div>
        {sku.description ? (
          <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{sku.description}</div>
        ) : null}
        <div className="mt-auto flex items-center gap-2 pt-2 text-xs">
          <span className="font-bold text-foreground tabular-nums">
            {formatPrice(sku.priceGross, sku.currency, t)}
          </span>
          {sku.cogsRatio > 0 ? (
            <span className="text-muted-foreground">
              · {t("merchCogsLabel", { pct: Math.round(sku.cogsRatio * 100) })}
            </span>
          ) : null}
        </div>
      </div>

      {/* Right — status + actions */}
      <div className="flex flex-col items-end justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>
            {t(
              isListed ? "merchStatusListed" : isOffline ? "merchStatusOffline" : "merchStatusDraft"
            )}
          </span>
          <SwitchControl
            value={isListed}
            onChange={(v) => onToggleStatus(v ? 1 : 0)}
            disabled={isOffline}
          />
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onEdit}
            aria-label={t("merchEdit")}
          >
            <IconPencil className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            color="destructive"
            onClick={onDelete}
            aria-label={t("merchDelete")}
          >
            <IconTrash className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────

function formatPrice(
  amount: number,
  currency: MerchandiseCurrency,
  t: ReturnType<typeof useTranslations>
): string {
  const formatted = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(amount);
  if (currency === "community_score") return `${formatted} ${t("merchCurrencyScore")}`;
  if (currency === "USD") return `$${formatted}`;
  return `¥${formatted}`;
}
