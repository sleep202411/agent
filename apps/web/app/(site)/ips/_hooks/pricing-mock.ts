/**
 * IP-pricing mock store.
 *
 * Pricing config is per-IP and consumes **community score** (社区积分,
 * a separate wallet from Studio's `scoreBalance`). Shape mirrors the
 * planned backend contract:
 *
 *   GET  /vedio/ip/pricing?ipId={id}
 *     → { freeEpisodeCount, defaultPriceIntegral, bundleIntegral?,
 *         overrides: Record<episodeId, priceIntegral> }
 *
 *   POST /vedio/ip/pricing/update
 *     body: full config; replaces server-side state in one shot.
 *
 * Until those endpoints exist, this module is the source of truth.
 * Module-level `Map<ipId, PricingState>` lazy-seeded on first read
 * (default config when an IP has no pricing yet). All getters clone
 * so callers can't alias into the store.
 */

// ─── Types ─────────────────────────────────────────────

export interface IpPricing {
  /** First N episodes (by videoNumber asc) are always free. */
  freeEpisodeCount: number;
  /** Default per-episode unlock price (社区积分). Used for any paid
   *  episode that isn't in `overrides`. */
  defaultPriceIntegral: number;
  /** Optional whole-IP unlock price. `undefined` means the bundle
   *  offer is disabled and viewers can only buy per-episode. */
  bundleIntegral?: number;
  /** Per-episode price overrides, keyed by episode id. Only set when
   *  the IP owner deliberately departs from `defaultPriceIntegral`. */
  overrides: Record<string, number>;
}

// ─── Store ─────────────────────────────────────────────

const store = new Map<string, IpPricing>();

function defaultConfig(): IpPricing {
  return {
    freeEpisodeCount: 3,
    defaultPriceIntegral: 10,
    bundleIntegral: undefined,
    overrides: {},
  };
}

function getState(ipId: string): IpPricing {
  let s = store.get(ipId);
  if (!s) {
    s = defaultConfig();
    store.set(ipId, s);
  }
  return s;
}

// ─── Read ─────────────────────────────────────────────

export function readIpPricing(ipId: string): IpPricing {
  const s = getState(ipId);
  return {
    freeEpisodeCount: s.freeEpisodeCount,
    defaultPriceIntegral: s.defaultPriceIntegral,
    bundleIntegral: s.bundleIntegral,
    overrides: { ...s.overrides },
  };
}

// ─── Write ────────────────────────────────────────────

export function writeIpPricing(ipId: string, patch: Partial<IpPricing>): IpPricing {
  const s = getState(ipId);
  if (patch.freeEpisodeCount != null) {
    s.freeEpisodeCount = Math.max(0, Math.floor(patch.freeEpisodeCount));
  }
  if (patch.defaultPriceIntegral != null) {
    s.defaultPriceIntegral = Math.max(0, Math.floor(patch.defaultPriceIntegral));
  }
  if ("bundleIntegral" in patch) {
    // explicit `undefined` disables the bundle offer
    s.bundleIntegral =
      patch.bundleIntegral == null ? undefined : Math.max(0, Math.floor(patch.bundleIntegral));
  }
  if (patch.overrides) {
    // Replace wholesale — callers send the full override map.
    s.overrides = Object.fromEntries(
      Object.entries(patch.overrides)
        .map(([k, v]) => [k, Math.max(0, Math.floor(v))] as const)
        .filter(([, v]) => Number.isFinite(v))
    );
  }
  return readIpPricing(ipId);
}

/** Resolve the effective price for a single episode — override wins
 *  over default, and free episodes return `null`. Callers pass the
 *  episode's 1-based `videoNumber` so the free-preview window check
 *  doesn't need a separate episode-list join. */
export function resolveEpisodePrice(
  ipId: string,
  episodeId: string,
  videoNumber: number
): number | null {
  const s = getState(ipId);
  if (videoNumber <= s.freeEpisodeCount) return null;
  const override = s.overrides[episodeId];
  if (typeof override === "number") return override;
  return s.defaultPriceIntegral;
}

// ─── Test-only ────────────────────────────────────────

export function __resetPricingMockForTest(ipId?: string): void {
  if (ipId) store.delete(ipId);
  else store.clear();
}
