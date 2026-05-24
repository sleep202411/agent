/**
 * IP-pricing mock store.
 *
 * Pricing config is per-IP and consumes **community score** (社区积分,
 * a separate wallet from Studio's `scoreBalance`). Shape mirrors the
 * planned backend contract (see `pricing-spec.md` next to this file):
 *
 *   GET  /project/pricing/{ipId}
 *     → { defaultEpisodePrice, bundlePrice|null, freeEpisodeIds[],
 *         episodeOverrides: Array<{episodeId, price}>, updateTime }
 *
 *   POST /project/pricing/save
 *     body: full config; replaces server-side state in one shot.
 *
 * Until those endpoints exist, this module is the source of truth.
 * Module-level `Map<ipId, PricingState>` lazy-seeded on first read
 * (default config when an IP has no pricing yet). All getters clone
 * so callers can't alias into the store.
 *
 * Internal shape note: frontend stores `freeEpisodeIds` as `string[]`
 * (matches `Episode.id` type after backend-to-frontend mapping) and
 * `overrides` as a `Record<episodeId, price>` for O(1) lookup at
 * render time. The wire form is `freeEpisodeIds: number[]` +
 * `episodeOverrides: Array<{episodeId, price}>` per spec — conversion
 * happens at the fetch boundary when we swap this mock for real HTTP.
 */

// ─── Types ─────────────────────────────────────────────

export interface IpPricing {
  /** Episode ids the creator marked free. Sparse — `["3", "7", "12"]`
   *  is valid; order is irrelevant. Stored as string to match the
   *  frontend `Episode.id` shape. */
  freeEpisodeIds: string[];
  /** Default per-episode unlock price (社区积分). Used for any paid
   *  episode that isn't in `overrides`. */
  defaultPriceIntegral: number;
  /** Optional whole-IP unlock price. `undefined` means the bundle
   *  offer is disabled and viewers can only buy per-episode.
   *  Per spec: a full-IP purchase covers current AND future episodes. */
  bundleIntegral?: number;
  /** Per-episode price overrides, keyed by episode id. Only set when
   *  the IP owner deliberately departs from `defaultPriceIntegral`. */
  overrides: Record<string, number>;
}

// ─── Store ─────────────────────────────────────────────

const store = new Map<string, IpPricing>();

function defaultConfig(): IpPricing {
  // Default-price = 0 so untouched IPs evaluate to `hasPaidContent =
  // false` in pricing-context (no chip / no paywall rendered). The
  // owner-side pricing tab is still gated behind `?pricing=1` (see
  // edit/page.tsx), so until backend ships real pricing + the edit
  // UI is unlocked, the public detail page must look as if there's
  // no paywall at all. Was 10 — but that 10 was leaking into every
  // IP's episode rows as "🔒 10 积分", which is misleading.
  return {
    freeEpisodeIds: [],
    defaultPriceIntegral: 0,
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
    freeEpisodeIds: [...s.freeEpisodeIds],
    defaultPriceIntegral: s.defaultPriceIntegral,
    bundleIntegral: s.bundleIntegral,
    overrides: { ...s.overrides },
  };
}

// ─── Write ────────────────────────────────────────────

export function writeIpPricing(ipId: string, patch: Partial<IpPricing>): IpPricing {
  const s = getState(ipId);
  if (patch.freeEpisodeIds) {
    // De-dupe + drop blanks; preserve creator's original order so
    // the UI list doesn't shuffle on save.
    const seen = new Set<string>();
    s.freeEpisodeIds = patch.freeEpisodeIds.filter((id) => {
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
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

/** Resolve the effective price for a single episode — `null` = free,
 *  number = paid at that many score. Free wins over everything; then
 *  override beats default. */
export function resolveEpisodePrice(ipId: string, episodeId: string): number | null {
  const s = getState(ipId);
  if (s.freeEpisodeIds.includes(episodeId)) return null;
  const override = s.overrides[episodeId];
  if (typeof override === "number") return override === 0 ? null : override;
  return s.defaultPriceIntegral === 0 ? null : s.defaultPriceIntegral;
}

// ─── Test-only ────────────────────────────────────────

export function __resetPricingMockForTest(ipId?: string): void {
  if (ipId) store.delete(ipId);
  else store.clear();
}
