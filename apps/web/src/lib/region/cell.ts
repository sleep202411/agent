/**
 * Build-time cell identifier.
 *
 * A "cell" is a fully self-contained deployment of the platform with its
 * own data plane (DB, object storage, realtime, secrets). We run exactly
 * two cells in production:
 *
 *   - "com" — Azure Singapore, serves all non-China traffic (US/EU/JP/...)
 *   - "cn"  — Alibaba Mainland, serves China traffic only
 *
 * The cells are intentionally **isolated** — no shared data, no
 * cross-cell sync. PIPL + 网络安全法 mandate this for the cn side; the
 * com side is unitary even across countries because cross-region
 * isolation isn't a legal requirement outside China.
 *
 * Differences *within* the com cell (e.g., GDPR cookie banner for EU
 * users, Stripe-vs-local-payment for US users) are handled per-request
 * via the Country layer (see `country.ts`), not via additional cells.
 *
 * "global" is an explicit international deployment alias; missing configuration fails.
 */

export const CELLS = ["com", "cn", "global"] as const;
export type Cell = (typeof CELLS)[number];

export const CURRENT_CELL: Cell = (() => {
  const raw = process.env.NEXT_PUBLIC_SITE_REGION;
  if (raw === "com" || raw === "cn") return raw;
  if (raw === "global") return "global";
  throw new Error("NEXT_PUBLIC_SITE_REGION must be cn, com or global");
})();

// ─── Currency policy ─────────────────────────────────────
//
// Mirrors `apps/server/src/crews/currency.ts` — the server is the
// last word, but exposing the same policy here lets dialogs hide
// disabled options pre-emptively (e.g. CN cell shows CNY only, no
// "currency picker" rendered at all).

import { type CurrencyCode } from "@repo/shared/crew";

/** Whitelist of currencies allowed in the current cell. */
export function allowedCurrenciesForCell(): readonly CurrencyCode[] {
  if (CURRENT_CELL === "cn") return ["CNY"];
  return ["USD"];
}

/** Default currency to pre-fill new forms with. */
export function defaultCurrencyForCell(): CurrencyCode {
  return CURRENT_CELL === "cn" ? "CNY" : "USD";
}

// ─── FizzStudio entry routing ──────────────────────────

import { env } from "@/src/env";
import { studioOrigin } from "@/src/lib/studio-origin";

export function getStudioHref(locale: string): string {
  return `${studioOrigin(env.STUDIO_HOST)}/${locale}`;
}
