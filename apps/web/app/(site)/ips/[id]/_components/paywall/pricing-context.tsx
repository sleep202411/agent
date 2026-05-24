"use client";

/**
 * Paywall state context for the public IP detail page.
 *
 * Hosts the pricing config + access resolution + buy actions used by
 * every paywall component on the page. Two modes:
 *
 *   • **real mode** (default): viewer is a real visitor. Access state
 *     ideally comes from the backend's per-user grants (phase-2
 *     endpoint `GET /project/pricing/access/{ipId}` — not yet shipped).
 *     For MVP we treat every viewer as a guest with no owned episodes;
 *     buy actions show a "purchase coming soon" toast instead of
 *     hitting the backend. When phase-2 lands, swap the buy actions
 *     for the real POST calls and read access from the query.
 *
 *   • **preview mode** (`?preview=pricing`): viewer is the IP owner
 *     (or admin) checking what visitors will see. Identity is a local
 *     React state — Guest / Owns-Singles / Owns-Full — and "buying"
 *     mutates that state instead of hitting the wire. Lets stakeholders
 *     experience the paywall before backend wiring.
 *
 * Owner bypass: when the current logged-in user is the IP owner AND
 * we're NOT in preview mode, paywall renders nothing — owners can
 * watch their own IP without friction. Preview mode forces the
 * paywall to render so they can audit the viewer experience.
 */

import { createContext, useContext, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { useIpPricing } from "@/app/(site)/ips/_hooks/use-pricing";
import { useCredits } from "@/src/hooks/use-user";

// ─── Types ─────────────────────────────────────────────

export type PreviewIdentity = "guest" | "owns-singles" | "owns-full";

export type EpisodeAccess =
  | { kind: "free" }
  | { kind: "owned-single" }
  | { kind: "owned-full" }
  | { kind: "locked"; price: number }
  | { kind: "locked-bundle"; price: number };

export type PricingDisplayState = "no-paywall" | "active" | "owner-bypass";

export interface PricingContextValue {
  /** Whether the paywall is currently in play. UI roots should bail
   *  early when this is `no-paywall` or `owner-bypass`. */
  state: PricingDisplayState;
  /** Per-episode access status. Constant-time-ish; backed by maps. */
  episodeAccess: (epId: string) => EpisodeAccess;
  /** Bundle (full-IP) status. `null` if creator didn't enable it. */
  bundle: { price: number; owned: boolean } | null;
  /** Viewer's available credits, used for affordability checks in the
   *  confirm dialog. Currently sourced from Studio's `scoreBalance`
   *  as a placeholder — community-score wallet hook is phase-2. */
  credits: number;

  /** Trigger a single-episode buy. In preview, mutates local mock;
   *  in real mode (post phase-2), POSTs to backend. Throws on error. */
  unlockEpisode: (epId: string) => Promise<void>;
  buyBundle: () => Promise<void>;

  /** Preview-mode controls. Components read `isPreviewMode` to decide
   *  whether to render the preview chrome (top bar + identity switch). */
  isPreviewMode: boolean;
  previewIdentity: PreviewIdentity;
  setPreviewIdentity: (id: PreviewIdentity) => void;
}

const PricingContext = createContext<PricingContextValue | null>(null);

/** Read paywall state. Throws if called outside a provider. */
export function usePricing(): PricingContextValue {
  const ctx = useContext(PricingContext);
  if (!ctx) {
    throw new Error("usePricing must be used inside <PricingProvider>");
  }
  return ctx;
}

// ─── Provider ──────────────────────────────────────────

interface PricingProviderProps {
  ipId: string;
  episodeIds?: string[];
  /** Whether the current viewer is the IP owner. Caller computes from
   *  `useCurrentUser().user?.id === project.ownerId`. */
  isOwner: boolean;
  children: React.ReactNode;
}

export function PricingProvider({
  ipId,
  episodeIds = [],
  isOwner,
  children,
}: PricingProviderProps) {
  const t = useTranslations("paywall");
  const searchParams = useSearchParams();
  const isPreviewMode = searchParams.get("preview") === "pricing";

  const { data: pricing } = useIpPricing(ipId, episodeIds);
  const { data: credits = 0 } = useCredits();

  // Preview-mode mock state. Resets on remount (acceptable — preview
  // is a transient demo affordance, not a real session).
  const [previewIdentity, setPreviewIdentity] = useState<PreviewIdentity>("guest");
  const [mockOwnedSingles, setMockOwnedSingles] = useState<Set<string>>(new Set());

  // Does this IP have ANY paid content? If everything is free (or
  // pricing was never set), skip rendering the paywall entirely.
  const hasPaidContent = useMemo(() => {
    if (!pricing) return false;
    if (pricing.defaultPriceIntegral > 0) return true;
    if (Object.values(pricing.overrides).some((p) => p > 0)) return true;
    if (typeof pricing.bundleIntegral === "number" && pricing.bundleIntegral > 0) return true;
    return false;
  }, [pricing]);

  const state: PricingDisplayState =
    isOwner && !isPreviewMode ? "owner-bypass" : !hasPaidContent ? "no-paywall" : "active";

  const bundle = useMemo(() => {
    if (!pricing || typeof pricing.bundleIntegral !== "number") return null;
    const owned = isPreviewMode && previewIdentity === "owns-full";
    return { price: pricing.bundleIntegral, owned };
  }, [pricing, isPreviewMode, previewIdentity]);

  // Episode access. priceType=2 rules govern single-episode purchase.
  // priceType=1 is the whole-IP package; if an episode has no single
  // rule but a package exists, the row is locked behind the package CTA.
  const freeSet = useMemo(() => new Set(pricing?.freeEpisodeIds ?? []), [pricing?.freeEpisodeIds]);

  const episodeAccess = (epId: string): EpisodeAccess => {
    if (!pricing) return { kind: "free" };
    if (freeSet.has(epId)) return { kind: "free" };

    if (isPreviewMode) {
      if (previewIdentity === "owns-full") return { kind: "owned-full" };
      if (previewIdentity === "owns-singles" && mockOwnedSingles.has(epId)) {
        return { kind: "owned-single" };
      }
    }

    const override = pricing.overrides[epId];
    const hasSingleEpisodeRule = typeof override === "number";
    if (!hasSingleEpisodeRule && bundle && !bundle.owned) {
      return { kind: "locked-bundle", price: bundle.price };
    }

    const price = hasSingleEpisodeRule ? Number(override) : pricing.defaultPriceIntegral;
    if (price <= 0) return { kind: "free" };

    // Real mode: phase-2 would read per-user grants here.
    return { kind: "locked", price };
  };

  const unlockEpisode = async (epId: string): Promise<void> => {
    if (isPreviewMode) {
      setMockOwnedSingles((prev) => new Set([...prev, epId]));
      // First buy in guest mode → upgrade identity so the chip styling
      // stays consistent ("guest" implies nothing owned).
      if (previewIdentity === "guest") setPreviewIdentity("owns-singles");
      toast.success(t("toastUnlockPreviewSuccess"));
      return;
    }
    // Phase-2: POST /project/pricing/purchase { ipId, episodeId }
    toast.info(t("toastPurchaseNotYetAvailable"));
  };

  const buyBundle = async (): Promise<void> => {
    if (isPreviewMode) {
      setPreviewIdentity("owns-full");
      toast.success(t("toastBundlePreviewSuccess"));
      return;
    }
    toast.info(t("toastPurchaseNotYetAvailable"));
  };

  const value: PricingContextValue = {
    state,
    episodeAccess,
    bundle,
    credits,
    unlockEpisode,
    buyBundle,
    isPreviewMode,
    previewIdentity,
    setPreviewIdentity,
  };

  return <PricingContext.Provider value={value}>{children}</PricingContext.Provider>;
}
