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

/** Fire a typed AppLovin event (no-op until the pixel is loaded). */
export function axonTrack<E extends keyof AxonEventMap>(event: E, payload?: AxonEventMap[E]): void {
  if (typeof window === "undefined" || !window.axon) return;
  if (payload === undefined) window.axon("track", event);
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

export function axonPurchase(params: {
  transactionId: string;
  value: number;
  currency: string;
  items: AxonItem[];
  userData?: AxonUserData;
}): void {
  axonTrack("purchase", {
    transaction_id: params.transactionId,
    value: params.value,
    currency: params.currency,
    items: params.items,
    // FizzDragon sells digital credits/membership — no physical fulfilment.
    shipping: 0,
    tax: 0,
    user_data: params.userData,
  });
}
