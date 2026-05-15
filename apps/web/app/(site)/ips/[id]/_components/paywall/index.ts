/**
 * Public-facing paywall barrel — the surfaces a caller (IP detail
 * page) needs:
 *
 *   • <PricingProvider>      — wraps the page, owns paywall state
 *   • usePricing()            — read state inside subtree (rarely
 *                                 needed at the top; used by chips
 *                                 and dialogs internally)
 *   • <PreviewModeBar>        — top bar (renders nothing outside
 *                                 preview mode)
 *   • <BundleHeroCta>         — top hero card (renders nothing when
 *                                 paywall inactive or bundle absent)
 *   • <EpisodePaywallChip>    — per-row access affordance
 */

export { PricingProvider, usePricing } from "./pricing-context";
export type {
  EpisodeAccess,
  PreviewIdentity,
  PricingContextValue,
  PricingDisplayState,
} from "./pricing-context";
export { PreviewModeBar } from "./preview-mode-bar";
export { BundleHeroCta } from "./bundle-hero-cta";
export { EpisodePaywallChip } from "./episode-paywall-chip";
