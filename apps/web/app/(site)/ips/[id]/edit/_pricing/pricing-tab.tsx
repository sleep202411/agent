"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { IconExternalLink, IconLoader2, IconRocket } from "@tabler/icons-react";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { useProjectEpisodes } from "@/app/(site)/ips/_hooks/use-ip";
import { useIpPricing } from "@/app/(site)/ips/_hooks/use-pricing";
import type { IpPricing } from "@/app/(site)/ips/_hooks/use-pricing";
import { PaywallPreview } from "./paywall-preview";
import { FreePreviewCard } from "./free-preview-card";
import { DefaultPriceCard } from "./default-price-card";
import { BundleDealCard } from "./bundle-deal-card";
import { EpisodeOverridesList } from "./episode-overrides-list";

interface PricingTabProps {
  ipId: string;
  /** Locale segment for the "preview as viewer" deep link. */
  locale: string;
}

/**
 * Pricing tab orchestrator — fetches the current IP's pricing config
 * and episode list, keeps a local draft that the cards mutate, and
 * commits the whole config in one `useUpdateIpPricing` call on Save.
 *
 * The draft pattern matters: tweaking the free-episode slider or the
 * default-price input shouldn't burst-fire mutations. The IP owner
 * iterates locally; the wire is hit once at the end.
 */
export function PricingTab({ ipId, locale }: PricingTabProps) {
  const t = useTranslations("ipEdit");
  const tc = useTranslations("common");

  const { data: episodes = [], isLoading: episodesLoading } = useProjectEpisodes(ipId);
  const { data: remote, isLoading: pricingLoading } = useIpPricing(ipId);
  // `useUpdateIpPricing` intentionally not consumed yet — pricing save
  // is gated behind a coming-soon toast until backend ships. Re-wire
  // when /project/pricing/save lands.

  const [draft, setDraft] = useState<IpPricing | null>(remote ?? null);

  // Sync draft when the remote config (re)loads. Doesn't clobber an
  // in-progress edit because we only adopt remote on first arrival;
  // saves update both via `setQueryData` so this also fires post-save.
  useEffect(() => {
    if (remote) setDraft(remote);
  }, [remote]);

  const dirty = useMemo(() => {
    if (!remote || !draft) return false;
    return JSON.stringify(remote) !== JSON.stringify(draft);
  }, [remote, draft]);

  // Save is gated until backend ships. UI is otherwise fully functional —
  // creators can fiddle, see the preview update, and even open the
  // viewer-preview route — they just can't persist yet. Wire the real
  // mutation in when the `/project/pricing/save` endpoint lands (see
  // pricing-spec.md). For now: clicking Save surfaces a toast that
  // explains the status; the actual mutation never fires.
  const handleSaveComingSoon = () => {
    toast.info(t("pricingSaveComingSoonToast"));
  };

  const handleDiscard = () => {
    if (remote) setDraft(remote);
  };

  if (episodesLoading || pricingLoading || !draft) {
    return (
      <div className="flex h-48 items-center justify-center text-muted-foreground">
        <IconLoader2 className="size-5 animate-spin" />
      </div>
    );
  }

  const totalEpisodes = episodes.length;
  // Free episodes can be sparse picks — count by intersecting the
  // draft's id list with currently-existing episodes (filters out
  // stale ids for episodes that have since been deleted).
  const episodeIds = new Set(episodes.map((e) => e.id));
  const freeCount = draft.freeEpisodeIds.filter((id) => episodeIds.has(id)).length;
  const paidEpisodeCount = Math.max(0, totalEpisodes - freeCount);

  return (
    <div className="space-y-4">
      {/* Beta banner — pricing config persistence isn't wired yet, so
          warn creators their changes are local-only until backend ships.
          Drop this banner when /project/pricing/save lands. */}
      <div className="flex items-start gap-3 rounded-lg border border-amber-400/30 bg-gradient-to-br from-amber-400/[0.08] to-orange-400/[0.04] px-4 py-3">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-amber-400/15 text-amber-400">
          <IconRocket className="size-4" />
        </span>
        <div className="min-w-0 flex-1 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">
              {t("pricingBetaBannerTitle")}
            </span>
            <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-400">
              {t("pricingBetaTag")}
            </span>
          </div>
          <p className="mt-1 leading-relaxed text-muted-foreground">{t("pricingBetaBannerBody")}</p>
        </div>
      </div>

      {/* Header — title + save bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-foreground">{t("pricingTabTitle")}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("pricingTabSubtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/${locale}/ips/${ipId}?preview=pricing`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground"
          >
            <IconExternalLink className="size-3" />
            {t("pricingPreviewAsViewer")}
          </Link>
          {dirty ? (
            <Button type="button" variant="outline" color="muted" size="sm" onClick={handleDiscard}>
              {tc("discard")}
            </Button>
          ) : null}
          {/* Save stays present in the layout — clicking shows the
              coming-soon toast so creators discover the status without
              hunting for an explanation. Disabled-but-clickable via
              not setting `disabled`; visual treatment is muted to
              telegraph the gate. */}
          <Button
            type="button"
            variant="solid"
            color="primary"
            size="sm"
            onClick={handleSaveComingSoon}
            className="cursor-not-allowed opacity-60"
            title={t("pricingSaveComingSoonToast")}
          >
            {t("pricingSaveComingSoon")}
          </Button>
        </div>
      </div>

      {/* Top — paywall preview */}
      <PaywallPreview episodes={episodes} pricing={draft} />

      {/* Middle — 3 config cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <FreePreviewCard
          value={draft.freeEpisodeIds}
          episodes={episodes}
          onChange={(ids) => setDraft({ ...draft, freeEpisodeIds: ids })}
        />
        <DefaultPriceCard
          value={draft.defaultPriceIntegral}
          onChange={(n) => setDraft({ ...draft, defaultPriceIntegral: n })}
        />
        <BundleDealCard
          value={draft.bundleIntegral}
          defaultPriceIntegral={draft.defaultPriceIntegral}
          paidEpisodeCount={paidEpisodeCount}
          onChange={(v) => setDraft({ ...draft, bundleIntegral: v })}
        />
      </div>

      {/* Bottom — per-episode overrides */}
      <EpisodeOverridesList
        episodes={episodes}
        freeEpisodeIds={draft.freeEpisodeIds}
        defaultPriceIntegral={draft.defaultPriceIntegral}
        overrides={draft.overrides}
        onChangeOverride={(episodeId, price) => {
          if (price === draft.defaultPriceIntegral) {
            const next = { ...draft.overrides };
            delete next[episodeId];
            setDraft({ ...draft, overrides: next });
          } else {
            setDraft({
              ...draft,
              overrides: { ...draft.overrides, [episodeId]: price },
            });
          }
        }}
        onClearOverride={(episodeId) => {
          const next = { ...draft.overrides };
          delete next[episodeId];
          setDraft({ ...draft, overrides: next });
        }}
      />
    </div>
  );
}
