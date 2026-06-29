/**
 * AppLovin AXON web Pixel.
 *
 * Conversion tracking for AppLovin web ad campaigns (AXON optimisation +
 * ROAS measurement). Spec:
 * https://support.applovin.com/en/growth/promoting-your-websites/track-and-optimize
 *
 * Loaded ONLY on the international (.com / non-CN) build — AppLovin has no
 * China ad presence — and ONLY when `NEXT_PUBLIC_AXON_PIXEL_KEY` is set. Both
 * gates are build-time constants, so the whole pixel is dead-code-eliminated
 * from the CN bundle. Independent of PostHog (product analytics): this feeds
 * the ad platform, PostHog feeds our own dashboards.
 *
 * Every `axon*` call is a safe no-op when the pixel isn't loaded, so call
 * sites never need to guard.
 */
import { siteConfig } from "@/src/config/site";
import { env } from "@/src/env";

/** AppLovin "Axon item" object (GA4-ecommerce shaped). */
export interface AxonItem {
  item_id: string;
  item_name?: string;
  price?: number;
  quantity?: number;
  item_category_id?: number;
  item_variant_id?: string;
  image_url?: string;
  item_brand?: string;
  discount?: number;
  affiliation?: string;
}

/**
 * AppLovin "User data" object. `email`/`phone` are hashed by the pixel before
 * leaving the browser — pass `email` lowercased and `phone` as digits-only with
 * country code. `user_id` must be ≥ 6 chars.
 */
export interface AxonUserData {
  email?: string;
  phone?: string;
  user_id?: string;
}

/** Per-event payload shapes, per AppLovin's events reference. */
interface AxonEventMap {
  page_view: { user_data?: AxonUserData } | undefined;
  view_item: { items: AxonItem[]; currency?: string; value?: number; user_data?: AxonUserData };
  add_to_cart: { items: AxonItem[]; currency?: string; value?: number; user_data?: AxonUserData };
  begin_checkout: { items: AxonItem[]; currency: string; value: number; user_data?: AxonUserData };
  purchase: {
    items: AxonItem[];
    currency: string;
    value: number;
    transaction_id: string;
    shipping: number;
    tax: number;
    user_data?: AxonUserData;
  };
  sign_up: { method?: string; user_data?: AxonUserData } | undefined;
  login: { user_data?: AxonUserData } | undefined;
  generate_lead: { currency: string; value: number; user_data?: AxonUserData };
}

type AxonStub = ((...args: unknown[]) => void) & {
  performOperation?: (...args: unknown[]) => void;
  operationQueue: unknown[][];
  ts: number;
  eventKey: string;
};

declare global {
  interface Window {
    axon?: AxonStub;
  }
}

// Build-time constants → the `if (!ENABLED) return` branches below let the
// bundler strip the pixel entirely from the CN build.
const ENABLED = siteConfig.region !== "cn" && Boolean(env.AXON_PIXEL_KEY);

/**
 * Inject the official AppLovin loader and call `axon("init")`. Idempotent;
 * safe to call on every startup. The loader installs a queuing stub
 * synchronously, so events fired before the remote scripts finish loading are
 * queued and replayed — call sites don't need to wait.
 */
export function loadAxonPixel(): void {
  if (typeof window === "undefined" || !ENABLED || window.axon) return;

  const sources = ["https://s.axon.ai/pixel.js", "https://res4.applovin.com/p/l/loader.iife.js"];
  const queue: unknown[][] = [];
  const stub = function (...args: unknown[]) {
    if (stub.performOperation) stub.performOperation(...args);
    else queue.push(args);
  } as AxonStub;
  stub.operationQueue = queue;
  stub.ts = Date.now();
  stub.eventKey = env.AXON_PIXEL_KEY;
  window.axon = stub;

  const firstScript = document.getElementsByTagName("script")[0];
  for (const src of sources) {
    const script = document.createElement("script");
    script.async = true;
    script.src = src;
    firstScript?.parentNode?.insertBefore(script, firstScript);
  }

  window.axon("init");
}

/**
 * Fire a typed AppLovin event (no-op until the pixel is loaded). `options`
 * carries the optional dedup id, which AppLovin reads as the 4th positional
 * `track` argument to merge a browser event with the server-side (S2S) event of
 * the same id (5-minute window).
 */
export function axonTrack<E extends keyof AxonEventMap>(
  event: E,
  payload?: AxonEventMap[E],
  options?: { dedupe_id: string }
): void {
  if (typeof window === "undefined" || !window.axon) return;
  if (payload === undefined) window.axon("track", event);
  else if (options) window.axon("track", event, payload, options);
  else window.axon("track", event, payload);
}

// ─── Conversion helpers ─────────────────────────────────────────────────────

export function axonPageView(userData?: AxonUserData): void {
  axonTrack("page_view", userData ? { user_data: userData } : undefined);
}

export function axonSignUp(method?: string, userData?: AxonUserData): void {
  axonTrack("sign_up", { method, user_data: userData });
}

export function axonLogin(userData?: AxonUserData): void {
  axonTrack("login", { user_data: userData });
}

export function axonViewItem(params: {
  items: AxonItem[];
  currency?: string;
  value?: number;
  userData?: AxonUserData;
}): void {
  axonTrack("view_item", {
    items: params.items,
    currency: params.currency,
    value: params.value,
    user_data: params.userData,
  });
}

export function axonBeginCheckout(params: {
  items: AxonItem[];
  currency: string;
  value: number;
  userData?: AxonUserData;
}): void {
  axonTrack("begin_checkout", {
    items: params.items,
    currency: params.currency,
    value: params.value,
    user_data: params.userData,
  });
}

export function axonPurchase(params: {
  transactionId: string;
  value: number;
  currency: string;
  items: AxonItem[];
  userData?: AxonUserData;
  /**
   * Optional dedup id — pass the order id so AppLovin merges this browser
   * purchase with the server-side S2S purchase report carrying the same id
   * (5-minute window), instead of double-counting the conversion.
   */
  dedupeId?: string;
}): void {
  axonTrack(
    "purchase",
    {
      transaction_id: params.transactionId,
      value: params.value,
      currency: params.currency,
      items: params.items,
      // FizzDragon sells digital credits/membership — no physical fulfilment.
      shipping: 0,
      tax: 0,
      user_data: params.userData,
    },
    params.dedupeId ? { dedupe_id: params.dedupeId } : undefined
  );
}

// ─── Server-side attribution + browser/S2S dedup ────────────────────────────

/**
 * The AppLovin click id (`aleid`) for the current visitor, sent to the server as
 * checkout attribution so the post-payment S2S conversion can be matched. Per
 * AppLovin docs the id arrives as the `?aleid` URL param on the ad click and is
 * persisted by the pixel in the `_axeid` cookie — read the param first, then the
 * cookie. Returns undefined when neither is present or the pixel is disabled
 * (CN / unset key). Best-effort: never throws.
 */
export function axonAleid(): string | undefined {
  if (typeof window === "undefined" || !ENABLED) return undefined;
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("aleid");
    if (fromUrl && fromUrl.trim()) return fromUrl.trim();
    const match = document.cookie.match(/(?:^|;\s*)_axeid=([^;]+)/);
    if (match?.[1]) {
      const value = decodeURIComponent(match[1]).trim();
      if (value) return value;
    }
  } catch {
    // Best-effort attribution — ignore parse/cookie errors.
  }
  return undefined;
}

/** What we stash at checkout to fire the browser `purchase` event on return. */
interface PendingAxonPurchase {
  transactionId: string;
  value: number;
  currency: string;
  items: AxonItem[];
}

/**
 * Persist the data needed to fire the browser `purchase` event after the
 * provider redirect returns — stored in sessionStorage so it survives the
 * full-page round-trip. No-op when the pixel is disabled. Best-effort.
 */
export function axonStashPendingPurchase(key: string, purchase: PendingAxonPurchase): void {
  if (typeof window === "undefined" || !ENABLED) return;
  try {
    window.sessionStorage?.setItem(key, JSON.stringify(purchase));
  } catch {
    // sessionStorage can throw (private mode / quota) — tracking is best-effort.
  }
}

/**
 * Fire the browser `purchase` event for a stashed pending purchase (if any) and
 * clear it. The order id is passed as `dedupeId` so AppLovin merges this with the
 * server-side S2S purchase report carrying the same id. No-op when the pixel is
 * disabled or nothing is pending. Best-effort: never throws.
 */
export function axonFlushPendingPurchase(key: string): void {
  if (typeof window === "undefined") return;
  let raw: string | null = null;
  try {
    raw = window.sessionStorage?.getItem(key) ?? null;
    if (raw) window.sessionStorage?.removeItem(key);
  } catch {
    return;
  }
  if (!raw) return;
  let pending: PendingAxonPurchase;
  try {
    pending = JSON.parse(raw) as PendingAxonPurchase;
  } catch {
    return;
  }
  if (!pending || typeof pending.transactionId !== "string") return;
  axonPurchase({
    transactionId: pending.transactionId,
    value: pending.value,
    currency: pending.currency,
    items: Array.isArray(pending.items) ? pending.items : [],
    dedupeId: pending.transactionId,
  });
}
